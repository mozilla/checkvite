import asyncio
from collections import OrderedDict

from datasets import (
    load_dataset,
    Dataset,
    load_from_disk,
    Features,
    Value,
    ClassLabel,
    Image,
    Sequence,
)

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
        "rejection_reasons": Sequence(Value("string")),
    }
)


class Database:
    def __init__(self):
        print("Loading dataset...")
        try:
            ds = load_from_disk("./saved_dataset")
            print("Dataset loaded from disk.")
        except Exception as e:
            print(e)
            ds = load_dataset("tarekziade/adversarial", split="train")
            print("Original dataset loaded from HF.")

        self.data_dict = OrderedDict()
        for example in ds:
            self.data_dict[example["image_id"]] = example

        self.image_ids = list(self.data_dict.keys())
        self.dirty = False

    def save(self):
        ds = Dataset.from_list(list(self.data_dict.values()))
        ds.cast(features)
        ds.save_to_disk("./saved_dataset")

    def __len__(self):
        return len(self.data_dict)

    @property
    def verified(self):
        return sum(1 for item in self.data_dict.values() if item.get("verified") == 1)

    @property
    def need_training(self):
        return sum(
            1 for item in self.data_dict.values() if item.get("need_training") == 1
        )

    @property
    def to_verify(self):
        return len(self.data_dict) - self.verified

    def __getitem__(self, key):
        return self.data_dict[key]

    def __setitem__(self, key, value):
        self.data_dict[key] = value
        self.dirty = True

    def get_images(self, verified=False, need_training=False):
        images = list(self.data_dict.values())
        images = list(filter(lambda x: x["verified"] == verified, images))
        images = list(filter(lambda x: x["need_training"] == need_training, images))
        return images

    def add_image(self, **fields):
        new_image_id = max(self.image_ids) + 1 if self.image_ids else 1
        fields["image_id"] = new_image_id
        self.data_dict.update({new_image_id: fields})
        self.data_dict.move_to_end(new_image_id, last=False)
        self.image_ids.insert(0, new_image_id)
        self.dirty = True
        return new_image_id

    def update_image(self, image_id, **fields):
        self.data_dict[image_id].update(fields)
        self.dirty = True

    async def sync(self):
        while True:
            await asyncio.sleep(60)
            if self.dirty:
                print("Saving...")
                self.save()
                self.dirty = False
