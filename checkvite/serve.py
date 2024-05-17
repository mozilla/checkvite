from io import BytesIO
import os
import random

from aiohttp_session import setup, get_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from aiohttp import web
import jinja2
import aiohttp_jinja2
from datasets import load_dataset
from transformers import pipeline

from checkvite.db import ImageCaptionDataset, ImageCaptionDataStore


SECRET_KEY = "nYzdi-LJ4aqGqvCF28Yt2kVpWiGrWniBFLAGLPtRcx4="
HERE = os.path.dirname(__file__)


# Load datasets containing images
print("Loading datasets...")
dataset_names = ["lmms-lab/COCO-Caption"]
datasets = {name: load_dataset(name, split="val") for name in dataset_names}
datasets["tarekziade/adversarial"] = load_dataset(
    "tarekziade/adversarial", split="train"
)


print("Datasets loaded.")


routes = web.RouteTableDef()

captioners = {
    "large": pipeline("image-to-text", model="microsoft/git-large"),
    "pdf": pipeline(
        "image-to-text", model="tarekziade/vit-base-patch16-224-in21k-distilgpt2"
    ),
}


@routes.get("/images/{organization}/{dataset}/image{image_id}.jpg")
async def get_image(request):
    org, dataset_name, image_id = (
        request.match_info["organization"],
        request.match_info["dataset"],
        int(request.match_info["image_id"]),
    )

    image = datasets[f"{org}/{dataset_name}"][image_id]["image"]

    stream = BytesIO()
    image.save(stream, "JPEG")

    return web.Response(body=stream.getvalue(), content_type="image/jpeg")


@routes.get("/infere/{captioner}/{organization}/{dataset}/{image_id}")
async def infere(request):
    captioner, organization, dataset, image_id = (
        request.match_info["captioner"],
        request.match_info["organization"],
        request.match_info["dataset"],
        int(request.match_info["image_id"]),
    )
    dataset_name = f"{organization}/{dataset}"
    image = datasets[dataset_name][image_id]["image"]
    loop = request.app.loop
    caption = await loop.run_in_executor(None, captioners[captioner], image)
    caption = caption[0]["generated_text"]
    return web.json_response({"text": caption})


@routes.get("/get_adversarial_images")
async def get_random_adv_images(request):
    random_images = []
    count = 0
    picked = []
    while count < 9:
        dataset_name = "tarekziade/adversarial"
        image_id = random.randint(0, len(datasets[dataset_name]) - 1)
        if image_id in picked:
            continue
        picked.append(image_id)

        if app["db"].find(dataset_name, image_id) is not None:
            # this image was already processed
            continue

        info = {
            "image_url": f"/images/{dataset_name}/image" + str(image_id) + ".jpg",
            "caption": datasets[dataset_name][image_id]["alt_text"],
            "dataset": dataset_name,
            "image_id": image_id,
        }
        random_images.append(info)
        count += 1

    return web.json_response(random_images)


@routes.get("/get_images")
async def get_random_images(request):
    random_images = []
    count = 0
    picked = []

    while count < 9:
        dataset_name = random.choice(dataset_names)
        image_id = random.randint(0, len(datasets[dataset_name]) - 1)
        if image_id in picked:
            continue
        picked.append(image_id)

        if app["db"].find(dataset_name, image_id) is not None:
            # this image was already processed
            continue

        info = {
            "image_url": f"/images/{dataset_name}/image" + str(image_id) + ".jpg",
            "caption": datasets[dataset_name][image_id]["answer"][0],
            "dataset": dataset_name,
            "image_id": image_id,
        }
        random_images.append(info)
        count += 1

    return web.json_response(random_images)


@routes.get("/")
@aiohttp_jinja2.template("index.html")
async def index(request):
    session = await get_session(request)
    storage_counters = app["db"].counters()

    return {
        "retrained_images": storage_counters["trained"],
        "to_train_images": storage_counters["to_train"],
        "good_images": storage_counters["valid"],
        "custom_images": storage_counters["custom"],
        "message": session.pop("message", ""),
        "total_images": sum(len(dataset) for dataset in datasets.values()),
    }


@routes.post("/train")
async def handle_train(request):
    data = await request.post()
    session = await get_session(request)

    dataset_name = data["dataset"]
    image_id = int(data["image_id"])
    caption = data["caption"]

    action = "train" if "train" in data.keys() else "discard"
    if action == "train":
        session["message"] = f"Training with caption: {data['caption']}"
        image_url = f"/images/{dataset_name}/image{image_id}.jpg"
        # XXX
        image_url = "http://localhost:8080" + image_url
        app["db"].add(dataset_name, image_id, caption, False, True)
        await app["dataset"].add_entry(
            image_url, caption, origin=dataset_name, origin_id=image_id
        )
    else:
        app["db"].add(dataset_name, image_id, caption, True, False)
        session["message"] = "Caption discarded"

    raise web.HTTPFound("/")  # Redirect to the root


async def start_app(app):
    app["db"] = ImageCaptionDataStore()
    app["dataset"] = ImageCaptionDataset()


async def cleanup_app(app):
    app["db"].close()
    app["dataset"].save_to_disk()


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
