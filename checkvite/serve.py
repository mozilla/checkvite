from io import BytesIO
import os
import asyncio
import argparse
import json
import hashlib

from PIL import Image as PILImage
from aiohttp_session import setup, get_session, new_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from aiohttp import web
import aiohttp_jinja2
import jinja2

from checkvite.db import Database

SECRET_KEY = "nYzdi-LJ4aqGqvCF28Yt2kVpWiGrWniBFLAGLPtRcx4="
HERE = os.path.dirname(__file__)
db = Database()
routes = web.RouteTableDef()
PRODUCTION = False
USERS_FILE = os.path.join(HERE, "users.json")


class UserNotFoundError(Exception):
    pass


def hash_password(password):
    return hashlib.sha512(password.encode()).hexdigest()


def load_users():
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, "r") as f:
            return {k: User(k, v) for k, v in json.load(f).items()}
    return {}


class User:
    def __init__(self, username, data):
        self.username = username
        self.hash_password = data["password"]
        self.data_split = data["data_split"]

    def check_password(self, password):
        return self.hash_password == hash_password(password)

    def get_data_split(self):
        return self.data_split


users = load_users()


def get_user(username):
    for user in users.values():
        if user.username == username:
            return user
    raise UserNotFoundError(username)


@routes.get("/login")
@aiohttp_jinja2.template("login.html")
async def login(request):
    session = await get_session(request)
    return {
        "message": session.pop("message", ""),
        "production": PRODUCTION,
    }


@routes.post("/login")
async def handle_login(request):
    data = await request.post()
    username = data.get("username")
    password = data.get("password")
    session = await new_session(request)

    if username in users and users[username].check_password(password):
        session["username"] = username
        raise web.HTTPFound("/")
    else:
        session["message"] = "Invalid username or password."
        raise web.HTTPFound("/login")


@routes.get("/logout")
async def handle_logout(request):
    session = await get_session(request)
    session.invalidate()
    raise web.HTTPFound("/")


@web.middleware
async def auth_middleware(request, handler):
    session = await get_session(request)
    request["user"] = session.get("username")
    return await handler(request)


@routes.get("/stats")
async def stats_handler(request):
    session = await get_session(request)
    username = session.get("username", None)

    response_data = {
        "need_training": db.need_training,
        "verified": db.verified,
        "to_verify": db.to_verify,
        "acceptance_rate": "%.2f"
        % (db.verified / (db.verified + db.need_training) * 100),
        "u_need_training": 0,
        "u_verified": 0,
        "u_to_verify": 0,
    }

    if username is not None:
        user = get_user(username)
        response_data.update(db.get_split_stats(user.get_data_split()))

    response_data["rejection_reasons"] = db.get_rejection_stats()
    return web.json_response(response_data)


@routes.get("/images/{image_id}.png")
async def get_image(request):
    image_id = int(request.match_info["image_id"])
    entry = db[image_id]
    image_path = entry["image"]
    image = PILImage.open(image_path)
    stream = BytesIO()
    image.save(stream, "PNG")
    return web.Response(body=stream.getvalue(), content_type="image/png")


@routes.get("/get_image")
async def get_single_image(request):
    tab = request.query.get("tab", "to_verify")
    if tab == "to_verify":
        verified = 0
        need_training = 0
    elif tab == "verified":
        verified = 1
        need_training = 0
    else:
        verified = 0
        need_training = 1

    batch = int(request.query.get("batch", 1))
    index = int(request.query.get("index", 0))
    index = (batch - 1) * 9 + index

    def _transform(entry):
        return {
            "image_id": entry["image_id"],
            "alt_text": entry["alt_text"],
            "image_url": f"/images/{entry['image_id']}.png",
            "inclusive_alt_text": entry["inclusive_alt_text"],
        }

    image = db.get_image(
        verified=verified,
        need_training=need_training,
        index=index,
        transform=_transform,
    )

    return web.json_response(image)


@routes.get("/get_images")
async def get_random_images(request):
    session = await get_session(request)
    username = session.get("username", None)

    tab = request.query.get("tab", "to_verify")

    if tab == "to_verify":
        verified = 0
        need_training = 0
    elif tab == "verified":
        verified = 1
        need_training = 0
    else:
        verified = 0
        need_training = 1

    batch = int(request.query.get("batch", 1))
    start = (batch - 1) * 9

    def _transform(entry):
        return {
            "image_id": entry["image_id"],
            "alt_text": entry["alt_text"],
            "image_url": f"/images/{entry['image_id']}.png",
            "inclusive_alt_text": entry["inclusive_alt_text"],
        }

    if username and username != "admin":
        data_split = get_user(username).get_data_split()
    else:
        data_split = None

    images = db.get_images(
        verified=verified,
        need_training=need_training,
        start=start,
        transform=_transform,
        split=data_split,
    )

    return web.json_response(list(images))


@routes.get("/")
@aiohttp_jinja2.template("index.html")
async def index(request):
    session = await get_session(request)
    tab = request.query.get("tab", "to_verify")
    batch = request.query.get("batch", 1)

    return {
        "batch": int(batch),
        "message": session.pop("message", ""),
        "tab": tab,
        "production": PRODUCTION,
        "user": session.get("username", None),
    }


@routes.post("/train")
async def handle_train(request):
    session = await get_session(request)
    username = session.get("username")

    if not username:
        raise web.HTTPFound("/login")

    data = await request.post()
    image_id = int(data["image_id"])

    action = data.get("action", "discard")

    fields = {"inclusive_alt_text": data.get("caption", ""), "verified_by": username}

    if action == "train":
        fields["verified"] = 0
        fields["need_training"] = 1
        fields["rejection_reasons"] = data.getall("rejection_reason", [])
        session["message"] = "Added for training."
    else:
        fields["need_training"] = 0
        fields["verified"] = 1
        fields["rejection_reasons"] = []
        session["message"] = "Caption validated."

    db.update_image(image_id, **fields)
    tab = request.query.get("tab", "to_verify")
    batch = request.query.get("batch", 1)
    raise web.HTTPFound(f"/?tab={tab}&batch={batch}")


@routes.post("/upload")
async def handle_upload(request):
    session = await get_session(request)
    if not session.get("username"):
        raise web.HTTPFound("/login")

    reader = await request.multipart()
    image_data = await reader.next()
    pil_image = PILImage.open(BytesIO(await image_data.read()))
    pil_image = pil_image.convert("RGB")

    form_data = {}
    field_names = ["alt_text", "license", "source"]
    for name in field_names:
        field = await reader.next()
        form_data[name] = await field.text()

    entry = {
        "image": pil_image,
        "alt_text": form_data["alt_text"],
        "license": form_data["license"],
        "source": form_data["source"],
        "inclusive_alt_text": "",
        "need_training": 0,
        "verified": 0,
        "dataset": "custom",
        "rejection_reasons": [],
        "added_by": session.get("username"),
    }
    db.add_image(**entry)
    raise web.HTTPFound(f"/?tab=to_verify&batch=1")


async def start_app(app):
    app["data_saver"] = asyncio.create_task(db.sync())


async def cleanup_app(app):
    app["data_saver"].cancel()
    db.save()
    await app["data_saver"]


app = web.Application()
app.on_startup.append(start_app)
app.on_cleanup.append(cleanup_app)
setup(app, EncryptedCookieStorage(SECRET_KEY))
app.add_routes(routes)
app.add_routes(
    [
        web.static("/static", os.path.join(HERE, "static")),
    ]
)
aiohttp_jinja2.setup(
    app,
    loader=jinja2.FileSystemLoader(os.path.join(HERE, "templates")),
)


def main():
    global PRODUCTION
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--local", action="store_true", help="Set the mode to local.", default=False
    )
    args = parser.parse_args()
    if args.local:
        PRODUCTION = 0
        web.run_app(app)
    else:
        PRODUCTION = 1
        web.run_app(app, path=os.path.join(os.path.dirname(__file__), "aiohttp.socket"))


if __name__ == "__main__":
    main()
