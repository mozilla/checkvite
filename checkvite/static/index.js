import { pipeline } from "https://cdn.jsdelivr.net/npm/@xenova/transformers";

const url = new URL(window.location);
const params = new URLSearchParams(url.search);
const currentTab = params.get("tab") || "to_verify";
let batch = parseInt(params.get("batch") || 1);
let start = 1 + (batch - 1) * 9;
let mozillaCaptioner;
let baseLineCaptioner;

function blurTabContents() {
  const tabContents = document.querySelectorAll(".tabcontent");
  tabContents.forEach((tab) => {
    const overlay = document.createElement("div");
    overlay.innerText = "Loading...";
    overlay.style.position = "absolute";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(255, 255, 255, 0.5)";
    overlay.style.display = "flex";
    overlay.style.justifyContent = "center";
    overlay.style.alignItems = "flex-start"; // Changed from center to flex-start
    overlay.style.paddingTop = "350px"; // Added padding-top of 50px
    overlay.style.fontSize = "30px";
    overlay.style.zIndex = "1000";
    overlay.style.animation = "spin 2s linear infinite";
    overlay.style.transformOrigin = "center";

    tab.style.position = "relative";
    tab.appendChild(overlay);
  });
}

function clearBlurOnTabContents() {
  const tabContents = document.querySelectorAll(".tabcontent");
  tabContents.forEach((tab) => {
    tab.style.filter = "none";
    if (
      tab.lastElementChild &&
      tab.lastElementChild.innerText === "Loading..."
    ) {
      tab.removeChild(tab.lastElementChild);
    }
  });
}

async function fetchCaption(captioner, image_id) {
  const url = `/images/${image_id}.jpg`;
  let pipeline;
  if (captioner === "Firefox") {
    pipeline = mozillaCaptioner;
  } else {
    pipeline = baseLineCaptioner;
  }
  let res = await pipeline(url);
  res = res[0].generated_text;

  // hack until we fix the model for that bug
  if (captioner === "Firefox" && res === "T") {
    res = "The image seems to be a textual document.";
  }
  return res;
}

function taggedText(tag, text) {
  const captionDiv = document.createElement("div");
  captionDiv.innerHTML = `<span class='tag'>${tag}</span> ${text}`;
  return captionDiv;
}

function displayCaption(captioner, image_id, class_prefix = "") {
  var div = document.createElement("div");
  div.id = `${class_prefix}caption${captioner}${image_id}`;
  var button = document.createElement("button");
  button.innerHTML = "🪄";
  button.className = "button";
  button.style.backgroundColor = "#f3f3f6";

  button.addEventListener("click", function(event) {
    event.target.innerHTML = '<div class="loader"></div>';

    fetchCaption(captioner, image_id).then((caption) => {
      const captionDiv = document.getElementById(
        `${class_prefix}caption${captioner}${image_id}`,
      );
      const captionTextNode = document.createTextNode(caption);
      const newText = document.createElement("span");
      newText.appendChild(captionTextNode);
      captionDiv.replaceChild(newText, event.target);
    });
  });

  div.innerHTML = `<span class='tag'>${captioner}</span>`;
  div.appendChild(button);

  return div;
}

async function fetchImages() {
  const response = await fetch(`/get_images?batch=${batch}&tab=${currentTab}`);
  const data = await response.json();

  const loadPromises = [];

  data.forEach((imageData, index) => {
    if (index >= 9) return; // Only process the first 9 images
    console.log(start);
    console.log(index);

    const container = document.getElementById(`image${start + index}`);
    console.log(container);

    const imageBlock = document.createElement("div");
    imageBlock.className = "image-block";
    const img = document.createElement("img");
    img.src = imageData.image_url;
    img.className = "image";

    const imageLoadPromise = new Promise((resolve) => {
      img.onload = () => {
        resolve();
      };
    });
    loadPromises.push(imageLoadPromise);
    const captionDiv = document.createElement("div");
    captionDiv.className = "caption-container";

    const humanCaption = taggedText("Human text", imageData.alt_text);
    captionDiv.appendChild(humanCaption);
    console.log(imageData);

    if (currentTab === "to_train") {
      const trainCaption = taggedText(
        "Text for training",
        imageData.inclusive_alt_text,
      );
      captionDiv.appendChild(trainCaption);
    }

    imageBlock.appendChild(captionDiv);
    container.insertBefore(imageBlock, container.firstChild);
    container.insertBefore(img, container.firstChild);
    container.style.display = "block";

    if (currentTab != "to_train") {
      document.getElementById(`image_id${start + index}`).value =
        imageData.image_id;
    }
  });

  await Promise.all(loadPromises);

  data.forEach((imageData, index) => {
    if (index >= 9) return;

    const captionContainer = document
      .getElementById(`image${start + index}`)
      .querySelector(".caption-container");

    captionContainer.prepend(
      displayCaption("Baseline model", imageData.image_id),
    );

    captionContainer.prepend(displayCaption("Firefox", imageData.image_id));
  });
}

function openTab(_evt, tabName) {
  if (currentTab === tabName) return;

  var url = new URL(window.location);
  var params = new URLSearchParams(url.search);
  var batch = parseInt(params.get("batch") || 1);
  params.set("tab", tabName);
  params.set("batch", "1"); // changing the tab resets the batch to 1
  url.search = params.toString();
  window.location.href = url.toString();
}

async function updateProgressBar() {
  try {
    // Fetch the data from the server; assuming the endpoint is '/stats'
    const response = await fetch("/stats");
    const data = await response.json();
    console.log(data);

    // Extract values from the JSON response
    const { verified, need_training, to_verify } = data;

    // Calculate total to compute percentages
    let total = verified + need_training + to_verify;

    // Find segments
    let accurateSegment = document.querySelector(".segment.accurate");
    let biasedSegment = document.querySelector(".segment.biased");
    let notCheckedSegment = document.querySelector(".segment.not-checked");

    let accuratePercent = (verified / total) * 100 || 0;
    let biasedPercent = (need_training / total) * 100 || 0;
    let notCheckedPercent = (to_verify / total) * 100 || 0;

    // Update segments with new data
    accurateSegment.style.width = `${accuratePercent}%`;
    accurateSegment.textContent = `${verified}`;
    biasedSegment.style.width = `${biasedPercent}%`;
    biasedSegment.textContent = `${need_training}`;
    notCheckedSegment.style.width = `${notCheckedPercent}%`;
    notCheckedSegment.textContent = `${to_verify}`;
  } catch (error) {
    console.error("Failed to fetch stats: ", error);
    // Optionally handle errors, e.g., show an error message on the UI
  }
}

function updateImageDisplay() {
  const preview = document.getElementById("imagePreview");
  const file = document.getElementById("image").files[0];
  if (file) {
    preview.src = URL.createObjectURL(file);
    preview.onload = function() {
      URL.revokeObjectURL(preview.src); // Free up memory
    };
  }
}

function changeBatch(direction) {
  var url = new URL(window.location);
  var params = new URLSearchParams(url.search);

  var tab = params.get("tab") || "to_verify";
  var batch = parseInt(params.get("batch") || 1);
  batch += direction;
  if (batch < 1) {
    batch = 1;
  }

  params.set("tab", tab);
  params.set("batch", batch);

  url.search = params.toString();
  window.location.href = url.toString();
}

async function initPage() {
  blurTabContents();
  const tabs = ["to_verify", "verified", "to_train", "stats", "help"];

  tabs.forEach((tab) => {
    document
      .getElementById(`tab_${tab}`)
      .addEventListener("click", (event) => openTab(event, tab));
  });

  if (currentTab === "stats") {
    const imageInput = document.getElementById("image");
    const imagePreview = document.getElementById("imagePreview");

    imageInput.addEventListener("change", function() {
      const file = this.files[0];
      if (file) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.style.display = "block"; // Make sure to show the image element
        imagePreview.onload = function() {
          URL.revokeObjectURL(imagePreview.src); // Free up memory
        };
      }
    });

    updateProgressBar();
  } else if (currentTab === "help") {
    // Do nothing
  } else {
    mozillaCaptioner = await pipeline(
      "image-to-text",
      "tarekziade/vit-base-patch16-224-in21k-distilgpt2",
    );
    baseLineCaptioner = await pipeline(
      "image-to-text",
      "Xenova/vit-gpt2-image-captioning",
    );

    fetchImages();

    document.getElementById("backward").addEventListener("click", function() {
      changeBatch(-1);
    });
    document.getElementById("forward").addEventListener("click", function() {
      changeBatch(1);
    });
  }

  clearBlurOnTabContents();
}

initPage();
