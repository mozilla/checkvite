from io import BytesIO
import os
import asyncio
from aiohttp import web
from PIL import Image as PILImage
import io
from collections import OrderedDict
import argparse


from aiohttp_session import setup, get_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from aiohttp import web
import jinja2
import aiohttp_jinja2
from datasets import (
    load_dataset,
    Dataset,
    load_from_disk,
    Features,
    Value,
    ClassLabel,
    Image,
)
from transformers import pipeline

from checkvite.db import ImageCaptionDataset, ImageCaptionDataStore


SECRET_KEY = "nYzdi-LJ4aqGqvCF28Yt2kVpWiGrWniBFLAGLPtRcx4="
HERE = os.path.dirname(__file__)


features = Features(
    {
        "dataset": Value("string"),
        "image_id": Value("int64"),
        "image": Image(),
        "alt_text": Value("string"),
        "license": Value("string"),
        "source": Value("string"),
        "inclusive_alt_text": Value("string"),
        "need_training": ClassLabel(names=["no", "yes"]),
        "verified": ClassLabel(names=["no", "yes"]),
    }
)


print("Loading dataset...")
try:
    DS = load_from_disk("./saved_dataset")
    print("Dataset loaded from disk.")
except Exception as e:
    print(e)
    DS = load_dataset("tarekziade/adversarial", split="train")
    print("Original dataset loaded from HF.")


BY_ID = OrderedDict()
for example in DS:
    BY_ID[example["image_id"]] = example


IMAGE_IDS = list(BY_ID.keys())

routes = web.RouteTableDef()


# captioners = {
#    "large": pipeline("image-to-text", model="microsoft/git-large"),
#    "pdf": pipeline(
#        "image-to-text", model="tarekziade/vit-base-patch16-224-in21k-distilgpt2"
#    ),
# }
captioners = {}


TO_BE_SAVED = False


def save_to_disk():
    global TO_BE_SAVED
    TO_BE_SAVED = True


async def _do_save():
    print("Saving co routine started...")
    global TO_BE_SAVED
    while True:
        await asyncio.sleep(60)
        if TO_BE_SAVED:
            print("Saving...")
            ds = Dataset.from_list(list(BY_ID.values()))
            ds.cast(features)
            ds.save_to_disk("./saved_dataset")
            TO_BE_SAVED = False


@routes.get("/stats")
async def stats_handler(request):
    need_training_count = sum(
        1 for item in BY_ID.values() if item.get("need_training") == 1
    )
    verified_count = sum(1 for item in BY_ID.values() if item.get("verified") == 1)
    total_count = len(BY_ID)
    to_verify_count = total_count - verified_count

    # Creating a JSON response object with the counts
    response_data = {
        "need_training": need_training_count,
        "verified": verified_count,
        "to_verify": to_verify_count,
    }
    # Return the JSON response
    return web.json_response(response_data)


@routes.get("/images/{image_id}.jpg")
async def get_image(request):
    image_id = int(request.match_info["image_id"])
    image = BY_ID[image_id]["image"]
    stream = BytesIO()
    image.save(stream, "JPEG")
    return web.Response(body=stream.getvalue(), content_type="image/jpeg")


@routes.get("/infere/{captioner}/{image_id}")
async def infere(request):
    captioner = request.match_info["captioner"]
    image_id = int(request.match_info["image_id"])
    image = BY_ID[image_id]["image"]
    loop = request.app.loop
    caption = await loop.run_in_executor(None, captioners[captioner], image)
    caption = caption[0]["generated_text"]
    return web.json_response({"text": caption})


@routes.get("/get_images")
async def get_random_images(request):
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

    images = list(BY_ID.values())
    # images.sort(key=lambda x: x["image_id"])
    images = list(filter(lambda x: x["verified"] == verified, images))
    images = list(filter(lambda x: x["need_training"] == need_training, images))

    images = list(
        map(
            lambda x: {
                "image_id": x["image_id"],
                "alt_text": x["alt_text"],
                "image_url": f"/images/{x['image_id']}.jpg",
            },
            images,
        )
    )

    start = (batch - 1) * 9
    end = start + 9
    picked = images[start:end]

    return web.json_response(picked)


@routes.get("/")
@aiohttp_jinja2.template("index.html")
async def index(request):
    session = await get_session(request)
    tab = request.query.get("tab", "to_verify")
    batch = request.query.get("batch", 1)

    return {
        "batch": int(batch),
        "message": session.pop("message", ""),
        "total_images": len(DS),
        "tab": tab,
    }


@routes.post("/train")
async def handle_train(request):
    data = await request.post()
    session = await get_session(request)
    image_id = int(data["image_id"])

    row = BY_ID[image_id]
    row["inclusive_alt_text"] = data["caption"]

    action = "train" if "train" in data.keys() else "discard"
    if action == "train":
        row["inclusive_alt_text"] = data["caption"]
        row["need_training"] = 1
        row["verified"] = 0
        session["message"] = f"Training with caption: {data['caption']}"
    else:
        row["need_training"] = 0
        row["verified"] = 1
        session["message"] = "Caption validated"

    BY_ID[image_id] = row
    save_to_disk()
    tab = request.query.get("tab", "to_verify")
    batch = request.query.get("batch", 1)

    raise web.HTTPFound(f"/?tab={tab}&batch={batch}")  # Redirect to the root


@routes.post("/upload")
async def handle_upload(request):
    reader = await request.multipart()
    image_data = await reader.next()
    pil_image = PILImage.open(io.BytesIO(await image_data.read()))
    new_image_id = max(IMAGE_IDS) + 1 if IMAGE_IDS else 1

    form_data = {}
    field_names = ["alt_text", "license", "source"]
    for name in field_names:
        field = await reader.next()
        form_data[name] = await field.text()

    entry = {
        "image_id": new_image_id,
        "image": pil_image,
        "alt_text": form_data["alt_text"],
        "license": form_data["license"],
        "source": form_data["source"],
        "inclusive_alt_text": "",
        "need_training": 0,
        "verified": 0,
        "dataset": "custom",
    }
    BY_ID.update({new_image_id: entry})
    BY_ID.move_to_end(new_image_id, last=False)

    # Update IMAGE_IDS list
    IMAGE_IDS.insert(0, new_image_id)
    save_to_disk()
    raise web.HTTPFound(f"/?tab=to_verify&batch=1")  # Redirect to the root


async def start_app(app):
    app["data_saver"] = asyncio.create_task(_do_save())


async def cleanup_app(app):
    app["data_saver"].cancel()
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
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--local", action="store_true", help="Set the mode to local.", default=False
    )
    args = parser.parse_args()
    if args.local:
        web.run_app(app)
    else:
        web.run_app(app, path=os.path.join(os.path.dirname(__file__), "aiohttp.socket"))


if __name__ == "__main__":
    main()
