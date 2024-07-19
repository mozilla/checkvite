import os
from datasets import load_dataset
from io import BytesIO
import base64
import json
import csv

from transformers import pipeline

from openai import OpenAI

api_key = os.environ["OPENAI_API_KEY"]
client = OpenAI(api_key=api_key)


def get_prompt(alt_text, gpt4_text):
    return f"""\
Look at the image and detect relevant objects from the scene.

Compare the following alt texts with the detected objects:

Small model's alt text: {alt_text}
GPT-4's alt text: {gpt4_text}

Evaluate the relevance and accuracy of the small model's alt text based on the detected objects and attributes.
Provide a relevance score (0-100) and explain the reasoning. The small model tries to describe only
the most important aspects of the image in one sentence, and its output may be slightly edited by the user afterwards.
We want to make sure the result is not assumptive, misleading or plain wrong.

You will return a JSON mapping with the following keys: 'accuracy', 'reasoning' for the small model relevance.
"""


def measure_accuracy(image, alt_text, gpt4_text):
    buffered = BytesIO()
    image.save(buffered, format="JPEG")
    img_byte = buffered.getvalue()
    img_base64 = base64.b64encode(img_byte)
    encoded_image = img_base64.decode("utf-8")

    messages = [
        {
            "role": "system",
            "content": "You are a helpful assistant designed to output JSON.",
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": get_prompt(alt_text, gpt4_text)},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpg;base64,{encoded_image}"},
                },
            ],
        },
    ]

    for i in range(3):
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                response_format={"type": "json_object"},
                messages=messages,
                temperature=0.0,
            )

            res = json.loads(response.choices[0].message.content)
            return res
        except Exception as e:
            print(f"Failed on attempt {i+1}/3")
            print(image)
            if i == 2:
                raise
            time.sleep(1)


csv_file = "results.csv"
csv_columns = ["image_id", "alt_text", "gpt4_alt_text", "accuracy", "reasoning"]

dataset = load_dataset("tarekziade/golden")
model = pipeline(
    "image-to-text",
    model="mozilla/distilvit",
)

with open(csv_file, "w", newline="") as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=csv_columns)
    writer.writeheader()

total = 0
total_accuracy = 0

for item in dataset["train"]:
    image = item["image"]
    gpt4_alt_text = item["alt_text"]
    alt_text = model(image)[0]["generated_text"]
    image_id = item["image_id"]
    accuracy = measure_accuracy(image, alt_text, gpt4_alt_text)
    total_accuracy += accuracy["accuracy"]
    total += 1
    with open(csv_file, "a", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=csv_columns)
        writer.writerow(
            {
                "image_id": image_id,
                "alt_text": alt_text,
                "gpt4_alt_text": gpt4_alt_text,
                "accuracy": accuracy["accuracy"],
                "reasoning": accuracy["reasoning"],
            }
        )
    print(
        f"{image_id} | {alt_text} | {gpt4_alt_text} | {accuracy['accuracy']} | {accuracy['reasoning']}"
    )

print()
print()
print(f"Average accuracy: {total_accuracy/total}")
