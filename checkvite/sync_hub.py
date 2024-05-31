from datasets import DatasetDict
from checkvite.db import PersistentOrderedDict


DATASET_ID = "tarekziade/adversarial"
# DATASET_ID = "Mozilla/alt-text-validation"

if __name__ == "__main__":
    data_dict = PersistentOrderedDict(
        "alt-text",
        dataset_name="Mozilla/alt-text-validation",
        split="train",
        key_name="image_id",
        read_only=True,
    )

    data_dict.push_to_hub(DATASET_ID)
