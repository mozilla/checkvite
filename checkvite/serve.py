from io import BytesIO
import os
import asyncio

from aiohttp_session import setup, get_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from aiohttp import web
import jinja2
import aiohttp_jinja2
from datasets import (
    load_dataset,
    Dataset,
    DatasetDict,
    Features,
    Value,
    ClassLabel,
    Image,
)
from transformers import pipeline

from checkvite.db import ImageCaptionDataset, ImageCaptionDataStore


SECRET_KEY = "nYzdi-LJ4aqGqvCF28Yt2kVpWiGrWniBFLAGLPtRcx4="
HERE = os.path.dirname(__file__)


print("Loading dataset...")

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


try:
    DS = load_dataset("./saved_dataset")
except Exception:
    DS = load_dataset("tarekziade/adversarial", split="train")

print("Datasets loaded.")


BY_ID = {}
for example in DS:
    BY_ID[example["image_id"]] = example


IMAGE_IDS = list(BY_ID.keys())

routes = web.RouteTableDef()

captioners = {
    "large": pipeline("image-to-text", model="microsoft/git-large"),
    "pdf": pipeline(
        "image-to-text", model="tarekziade/vit-base-patch16-224-in21k-distilgpt2"
    ),
}


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
    if request.query.get("verified") is not None:
        verified = 1
    else:
        verified = 0

    if request.query.get("need_training") is not None:
        need_training = 1
    else:
        need_training = 0

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

    picked = images[:9]

    return web.json_response(picked)


@routes.get("/")
@aiohttp_jinja2.template("index.html")
async def index(request):
    session = await get_session(request)

    return {
        "retrained_images": 0,
        "to_train_images": 0,
        "good_images": 0,
        "custom_images": 0,
        "message": session.pop("message", ""),
        "total_images": len(DS),
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
    raise web.HTTPFound("/")  # Redirect to the root


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
    web.run_app(app)


if __name__ == "__main__":
    main()
