from io import BytesIO
from aiohttp import web
import os
import random

import jinja2
import aiohttp_jinja2
from datasets import load_dataset
from transformers import pipeline


HERE = os.path.dirname(__file__)


# Load datasets containing images
print("Loading datasets...")
dataset_names = ["lmms-lab/COCO-Caption"]
datasets = {name: load_dataset(name, split="val") for name in dataset_names}
print("Datasets loaded.")


routes = web.RouteTableDef()

captioners = {
    "large": pipeline("image-to-text", model="microsoft/git-large"),
    "pdf": pipeline("image-to-text", model="tarekziade/distilvit-flickr"),
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


@routes.get("/get_images")
async def get_random_images(request):
    random_images = []

    for _ in range(9):
        dataset_name = random.choice(dataset_names)
        image_id = random.randint(0, len(datasets[dataset_name]) - 1)
        info = {
            "image_url": f"/images/{dataset_name}/image" + str(image_id) + ".jpg",
            "caption": datasets[dataset_name][image_id]["answer"][0],
            "dataset": dataset_name,
            "image_id": image_id,
        }
        random_images.append(info)

    return web.json_response(random_images)


@routes.get("/")
@aiohttp_jinja2.template("index.html")
async def index(request):
    return {
        "retrained_images": 0,
        "good_images": 0,
        "custom_images": 0,
        "total_images": sum(len(dataset) for dataset in datasets.values()),
    }


app = web.Application()
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


# Run the web application
if __name__ == "__main__":
    web.run_app(app)
