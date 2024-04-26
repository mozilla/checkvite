import os
import shutil
import io

from PIL import Image
import asyncio
import aiohttp
from datasets import (
    Dataset,
    Image as ImageFeature,
    Features,
    Value,
    load_from_disk,
    concatenate_datasets,
)

HERE = os.path.dirname(__file__)
DEFAULT_DS_PATH = os.path.join(HERE, "pdfjs")


FEATURES = Features(
    {
        "image": ImageFeature(),
        "caption": Value("string"),
        "origin": Value("string"),
        "origin_split": Value("string"),
        "origin_id": Value("string"),
    }
)

EMPTY_DATA = {
    "image": [],
    "caption": [],
    "origin": [],
    "origin_split": [],
    "origin_id": [],
}


class ImageCaptionDataset:
    def __init__(self, dataset_path=DEFAULT_DS_PATH):
        self.dataset_path = dataset_path
        if os.path.exists(dataset_path):
            self.dataset = load_from_disk(dataset_path)
        else:
            self.dataset = Dataset.from_dict(EMPTY_DATA, FEATURES)

    def _empty_ds(self):
        return Dataset.from_dict(EMPTY_DATA, FEATURES)

    async def get_image(self, url):
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise Exception(f"Failed to download image: {response.status}")
                return await response.read()

    async def add_entry(
        self,
        image_file_or_url,
        caption,
        origin="custom",
        origin_split="train",
        origin_id=-1,
    ):
        if os.path.exists(image_file_or_url):
            with open(image_file_or_url, "rb") as image_file:
                image_bytes = image_file.read()
        else:
            image_bytes = await self.get_image(image_file_or_url)

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        data = {
            "image": [image],
            "caption": [caption],
            "origin": [origin],
            "origin_split": [origin_split],
            "origin_id": [origin_id],
        }
        new = Dataset.from_dict(data, features=FEATURES)

        self.dataset = concatenate_datasets([self.dataset, new])
        return len(self.dataset) - 1

    def get_entry(self, index):
        entry = self.dataset[index]
        return entry

    def save_to_disk(self):
        self.dataset.save_to_disk(self.dataset_path + ".tmp")
        if os.path.exists(self.dataset_path):
            shutil.rmtree(self.dataset_path, ignore_errors=True)
        os.rename(self.dataset_path + ".tmp", self.dataset_path)

    def push_to_hub(self):
        self.dataset.push_to_hub("tarekziade/test3")


if __name__ == "__main__":
    image_list = [
        {
            "url": "https://upload.wikimedia.org/wikipedia/commons/a/a3/Eq_it-na_pizza-margherita_sep2005_sml.jpg",
            "caption": "A classic pizza Margherita.",
        },
        {
            "url": "https://upload.wikimedia.org/wikipedia/commons/4/4e/Pleiades_large.jpg",
            "caption": "The Pleiades star cluster, a beautiful astronomical sight.",
        },
        {
            "url": "https://upload.wikimedia.org/wikipedia/commons/2/2f/Culinary_fruits_front_view.jpg",
            "caption": "An assortment of colorful culinary fruits.",
        },
        {
            "url": "https://upload.wikimedia.org/wikipedia/commons/d/d9/Collage_of_Nine_Dogs.jpg",
            "caption": "A collage featuring nine different dog breeds.",
        },
        {
            "url": "https://upload.wikimedia.org/wikipedia/commons/a/a5/Flower_poster_2.jpg",
            "caption": "A poster featuring a variety of colorful flowers.",
        },
        {
            "url": "https://upload.wikimedia.org/wikipedia/commons/6/6d/Good_Food_Display_-_NCI_Visuals_Online.jpg",
            "caption": "A display of wholesome, delicious food options.",
        },
    ]

    async def example():
        ds = ImageCaptionDataset()
        for entry in image_list:
            print(entry["url"])
            await ds.add_entry(entry["url"], entry["caption"])

        ds.save_to_disk()
        ds.push_to_hub()

    asyncio.run(example())
