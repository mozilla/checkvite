import os
import asyncio
import itertools
from collections import OrderedDict
import sqlite3
import time
import json
from datetime import datetime
import pandas as pd

from tqdm import tqdm
from PIL import Image
from datasets import load_dataset, Dataset, DatasetDict
from datasets import (
    load_dataset,
    Dataset,
    Features,
    Value,
    ClassLabel,
    Image as DImage,
    Sequence,
)


class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, pd.Timestamp):
            return obj.isoformat()
        return super().default(obj)


features = Features(
    {
        "dataset": Value("string"),
        "image_id": Value("int64"),
        "image": DImage(),
        "alt_text": Value("string"),
        "license": Value("string"),
        "source": Value("string"),
        "inclusive_alt_text": Value("string"),
        "need_training": ClassLabel(names=["no", "yes"]),
        "verified": ClassLabel(names=["no", "yes"]),
        "rejection_reasons": Sequence(Value("string")),
        "added_by": Value("string"),
        "verified_by": Value("string"),
        "modified_date": Value("timestamp[ns]"),
        "nsfw": ClassLabel(names=["no", "yes"]),
        "golden": ClassLabel(names=["no", "yes"]),
    }
)


class PersistentOrderedDict(OrderedDict):
    def __init__(
        self,
        filename,
        image_dir="images",
        dataset_name=None,
        key_name=None,
        split="train",
        read_only=False,
        *args,
        **kwargs,
    ):
        self.filename = filename
        self.db_file = self.filename + ".db"
        self.last_local_update = 0
        self.last_push = 0
        self.image_dir = image_dir
        os.makedirs(self.image_dir, exist_ok=True)
        need_creation = not os.path.exists(self.db_file)
        self.read_only = read_only
        self.conn = sqlite3.connect(self.db_file, check_same_thread=False)
        self.cursor = self.conn.cursor()
        if need_creation:
            self._create_tables()
        super().__init__(*args, **kwargs)
        if need_creation:
            if dataset_name and key_name:
                self.load_from_ds(dataset_name, key_name, split)
        else:
            self._load_from_db()
        self._load_timestamps()

    def _create_tables(self):
        self.cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS data (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """
        )
        self.cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS timestamps (
                name TEXT PRIMARY KEY,
                timestamp REAL
            )
        """
        )
        self.conn.commit()

    def _load_from_db(self):
        self.cursor.execute("SELECT key, value FROM data")
        rows = self.cursor.fetchall()
        for key, value in rows:
            super().__setitem__(key, json.loads(value))

    def _convert_image_to_path(self, key, item):
        if "image" in item and isinstance(item["image"], Image.Image):
            image_path = os.path.join(self.image_dir, f"{key}.png")
            item["image"].save(image_path, format="PNG")
            item["image"] = image_path
        return item

    def __getitem__(self, key):
        return super().__getitem__(str(key))

    def _convert_image_from_path(self, item):
        if (
            "image" in item
            and isinstance(item["image"], str)
            and os.path.exists(item["image"])
        ):
            item["image"] = Image.open(item["image"])
        return item

    def __setitem__(self, key, value):
        if self.read_only:
            raise ValueError("Cannot set item in read-only mode")
        key = str(key)
        value = self._convert_image_to_path(key, value)
        value["modified_date"] = datetime.now().isoformat()
        super().__setitem__(key, value)
        self.cursor.execute(
            "REPLACE INTO data (key, value) VALUES (?, ?)",
            (key, json.dumps(value, cls=CustomJSONEncoder)),
        )
        self.conn.commit()
        self._update_local_timestamp()

    def __delitem__(self, key):
        if self.read_only:
            raise ValueError("Cannot delete item in read-only mode")
        super().__delitem__(key)
        if os.path.exists(os.path.join(self.image_dir, f"{key}.png")):
            os.remove(os.path.join(self.image_dir, f"{key}.png"))
        self.cursor.execute("DELETE FROM data WHERE key = ?", (key,))
        self.conn.commit()
        self._update_local_timestamp()

    def clear(self):
        if self.read_only:
            raise ValueError("Cannot clear items in read-only mode")
        super().clear()
        for filename in os.listdir(self.image_dir):
            file_path = os.path.join(self.image_dir, filename)
            if os.path.isfile(file_path):
                os.remove(file_path)
        self.cursor.execute("DELETE FROM data")
        self.conn.commit()
        self._update_local_timestamp()

    def update(self, *args, **kwargs):
        if self.read_only:
            raise ValueError("Cannot update items in read-only mode")
        for key, value in dict(*args, **kwargs).items():
            self.__setitem__(key, value)

    def load_from_ds(self, dataset_name, key_name, split="train"):
        dataset = load_dataset(dataset_name, split=split)
        for item in tqdm(dataset, desc="Loading dataset"):
            key = item[key_name]
            item = self._convert_image_to_path(key, item)
            super().__setitem__(str(key), item)
        self.cursor.executemany(
            "REPLACE INTO data (key, value) VALUES (?, ?)",
            [
                (str(key), json.dumps(self[key], cls=CustomJSONEncoder))
                for key in self.keys()
            ],
        )
        self.conn.commit()
        self._update_local_timestamp()

    def to_dataset(self):
        full_data = {}
        for key, value in self.items():
            full_data[key] = self._convert_image_from_path(value.copy())
        return Dataset.from_list(list(full_data.values()), features)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.conn.close()

    def sync(self):
        self.conn.commit()
        self._save_timestamps()

    def _load_timestamps(self):
        self.cursor.execute("SELECT name, timestamp FROM timestamps")
        rows = self.cursor.fetchall()
        for name, timestamp in rows:
            if name == "last_local_update":
                self.last_local_update = timestamp
            elif name == "last_push":
                self.last_push = timestamp

    def _save_timestamps(self):
        self.cursor.execute(
            "REPLACE INTO timestamps (name, timestamp) VALUES (?, ?)",
            ("last_local_update", self.last_local_update),
        )
        self.cursor.execute(
            "REPLACE INTO timestamps (name, timestamp) VALUES (?, ?)",
            ("last_push", self.last_push),
        )
        self.conn.commit()

    def _update_local_timestamp(self):
        self.last_local_update = time.time()
        self._save_timestamps()

    def push_to_hub(self, hub_dataset_id, force=False):
        if force or self.last_local_update > self.last_push:
            ds_dict = DatasetDict({"train": self.to_dataset()})
            ds_dict.push_to_hub(hub_dataset_id)
            self.last_push = time.time()
            self._save_timestamps()
        else:
            print("No changes detected since the last push.")
        self.conn.commit()


class Database:
    def __init__(self):
        print("Loading dataset...")
        self.data_dict = PersistentOrderedDict(
            "alt-text",
            dataset_name="Mozilla/alt-text-validation",
            split="train",
            key_name="image_id",
        )
        self.image_ids = list(self.data_dict.keys())
        self.dirty = False

    def save(self):
        print("Saving")
        self.data_dict.sync()

    def __len__(self):
        return len(self.data_dict)

    @property
    def size(self):
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
        return len(self.data_dict) - (self.verified + self.need_training)

    def get_rejection_stats(self):
        rejection_stats = {}
        for entry in self.data_dict.values():
            for reason in entry.get("rejection_reasons", []):
                if reason in rejection_stats:
                    rejection_stats[reason] += 1
                else:
                    rejection_stats[reason] = 1
        return rejection_stats

    def get_user_stats(self, split, username):
        items = self._get_sorted(split, username)

        verified = sum(1 for item in items if item.get("verified") == 1)
        need_training = sum(1 for item in items if item.get("need_training") == 1)
        return {
            "u_need_training": need_training,
            "u_verified": verified,
            "u_to_verify": len(items) - (verified + need_training),
        }

    def _get_sorted(self, split=None, username=None):
        def sort_key(entry):
            modified_date = entry.get("modified_date")

            if modified_date is not None:
                date = pd.Timestamp(modified_date).timestamp()
            else:
                date = pd.Timestamp(0).timestamp()

            # XXX we can sort by date because it break the users split order
            return -entry["image_id"]

        all_entries = list(sorted(self.data_dict.values(), key=sort_key))

        if split is not None:
            user_entries = all_entries[split[0] : split[1]]
        else:
            user_entries = all_entries

        current_ids = [v["image_id"] for v in user_entries]

        # added images that were added by the user
        if username is not None and username != "admin":
            for entry in all_entries:
                if (
                    entry["image_id"] not in current_ids
                    and entry["added_by"] == username
                ):
                    user_entries.append(entry)
                    current_ids.append(entry["image_id"])

        # sort again
        return list(sorted(user_entries, key=sort_key))

    def __getitem__(self, key):
        return self.data_dict[key]

    def __setitem__(self, key, value):
        self.data_dict[key] = value
        self.dirty = True

    def get_full_image(self, image_id):
        entry = self.data_dict[image_id]
        entry["image"] = self.data_dict.get_image(image_id)
        return entry

    def get_image(
        self,
        verified=False,
        need_training=False,
        index=0,
        transform=None,
        split=None,
        username=None,
    ):
        return list(
            self.get_images(
                verified, need_training, index, 1, transform, split, username
            )
        )[0]

    def get_images(
        self,
        verified=None,
        need_training=None,
        start=0,
        amount=9,
        transform=None,
        split=None,
        username=None,
    ):
        entries = self._get_sorted(split, username)

        if verified is not None:
            entries = [entry for entry in entries if entry["verified"] == verified]

        if need_training is not None:
            entries = [
                entry for entry in entries if entry["need_training"] == need_training
            ]

        for entry in itertools.islice(entries, start, start + amount):
            if transform is not None:
                entry = transform(entry)
            yield entry

    def add_image(self, **fields):
        new_image_id = str(
            max([int(id) for id in self.image_ids]) + 1 if self.image_ids else 1
        )
        fields["image_id"] = int(new_image_id)
        self.data_dict.update({new_image_id: fields})
        self.data_dict.move_to_end(new_image_id, last=False)
        self.image_ids.insert(0, new_image_id)
        self.dirty = True
        return new_image_id

    def update_image(self, image_id, **fields):
        existing = self.data_dict[image_id]
        existing.update(fields)
        # make sure we trigger the setter
        self.data_dict[image_id] = existing

        print(f"Updated image {self.data_dict[image_id]}")

        self.dirty = True

    async def sync(self):
        while True:
            await asyncio.sleep(5)
            if self.dirty:
                # with concurrent.futures.ThreadPoolExecutor() as pool:
                #    loop = asyncio.get_running_loop()
                #    await loop.run_in_executor(pool, self.save)
                self.save()
                self.dirty = False
