import os
import requests
from datasets import (
    load_dataset,
    Dataset,
    Features,
    Value,
    Image as DImage,
    load_from_disk,
    Sequence,
    concatenate_datasets,
)
from PIL import Image
from io import BytesIO
from tqdm import tqdm
import pandas as pd

# Load the dataset from Hugging Face
dataset = load_dataset("mozilla/alt-text-validation")

# Define the Pexels API key and endpoint
PEXELS_API_KEY = os.environ["PEXELS_API_KEY"]
PEXELS_API_URL = "https://api.pexels.com/v1/curated"

per_page = 80  # Max per page limit for Pexels API


def resize_image(img):
    max_size = 700
    width, height = img.size
    if width > max_size or height > max_size:
        if width > height:
            new_width = max_size
            new_height = int(max_size * height / width)
        else:
            new_height = max_size
            new_width = int(max_size * width / height)
        img = img.resize((new_width, new_height), Image.LANCZOS)
    return img


def fetch_images_from_pexels(api_key, per_page, total_images=500):
    headers = {"Authorization": api_key}
    images = []
    page = 1
    while len(images) < total_images:
        response = requests.get(
            PEXELS_API_URL,
            headers=headers,
            params={"per_page": per_page, "page": page},
        )
        response_json = response.json()
        images.extend(response_json["photos"])
        if not response_json["photos"]:
            break  # Exit if no more photos are available
        page += 1
    return images[:total_images]


# Fetch images
images = fetch_images_from_pexels(PEXELS_API_KEY, per_page)

# Prepare data for new entries
new_entries = []
image_id_start = 500


for idx, image in enumerate(tqdm(images, desc="Processing images")):
    image_id = image_id_start + idx
    image_url = image["src"]["original"]
    response = requests.get(image_url)
    pil_image = resize_image(Image.open(BytesIO(response.content)).convert("RGB"))
    byte_arr = BytesIO()
    pil_image.save(byte_arr, format="JPEG")

    alt_text = image["alt"]
    new_entry = {
        "dataset": "Pexels",
        "image_id": image_id,
        "image": byte_arr.getvalue(),
        "alt_text": alt_text,
        "license": "public domain",
        "source": image["photographer_url"],
        "inclusive_alt_text": "",
        "need_training": 0,
        "verified": 0,
        "rejection_reasons": [],
    }
    new_entries.append(new_entry)

# Create a new dataset with the new entries
features = Features(
    {
        "dataset": Value("string"),
        "image_id": Value("int64"),
        "image": DImage(),
        "alt_text": Value("string"),
        "license": Value("string"),
        "source": Value("string"),
        "inclusive_alt_text": Value("string"),
        "need_training": Value("int64"),
        "verified": Value("int64"),
        "rejection_reasons": Sequence(Value("string")),
    }
)


new_entries_df = pd.DataFrame(new_entries)

new_dataset = Dataset.from_pandas(new_entries_df, features=features)


combined_dataset = concatenate_datasets([new_dataset, dataset["train"]])

# Combine the new dataset with the existing dataset
combined_dataset = combined_dataset.shuffle(seed=42)

# Save or upload the combined dataset as required
combined_dataset.save_to_disk("combined_dataset")

print("Dataset combined and saved successfully.")

# Load your dataset from disk (Arrow format)
dataset = load_from_disk("combined_dataset")

# Define the repository ID
repo_id = "mozilla/alt-text-validation"

# Push the dataset to the Hugging Face Hub
dataset.push_to_hub(repo_id)
