import { pipeline } from "https://cdn.jsdelivr.net/npm/@xenova/transformers";

function blurTabContents() {
  const tabContents = document.querySelectorAll(".tabcontent");
  tabContents.forEach((tab) => {
    // Create and style the overlay
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
    overlay.style.alignItems = "center";
    overlay.style.fontSize = "20px";
    overlay.style.zIndex = "1000";

    // Add the overlay to the tab
    tab.style.position = "relative";
    tab.appendChild(overlay);

    // Apply the blur effect
    tab.style.filter = "blur(5px)";
  });
}

function clearBlurOnTabContents() {
  const tabContents = document.querySelectorAll(".tabcontent");
  tabContents.forEach((tab) => {
    // Remove the blur effect
    tab.style.filter = "none";

    // Remove the loading overlay
    if (
      tab.lastElementChild &&
      tab.lastElementChild.innerText === "Loading..."
    ) {
      tab.removeChild(tab.lastElementChild);
    }
  });
}

blurTabContents();

const pcaptioner = await pipeline(
  "image-to-text",
  "tarekziade/vit-base-patch16-224-in21k-distilgpt2",
);

async function fetchCaption(image_id) {
  console.log("fetchCaption: ", image_id);
  const url = `/images/${image_id}.jpg`;
  const res = await pcaptioner(url);
  console.log("fetchCaption: ", res[0].generated_text);
  return res[0].generated_text;
}

function taggedText(tag, text) {
  const captionDiv = document.createElement("div");
  captionDiv.innerHTML = `<span class='tag'>${tag}</span> ${text}`;
  return captionDiv;
}

function displayCaption(captioner, image_id, idx, class_prefix = "") {
  var div = document.createElement("div");
  div.id = `${class_prefix}caption${captioner}${image_id}`;
  var button = document.createElement("button");
  button.innerHTML = "🪄";
  button.className = "button";
  button.style.backgroundColor = "#f3f3f6";

  button.addEventListener("click", function(event) {
    event.target.innerHTML = '<div class="loader"></div>';

    fetchCaption(image_id).then((caption) => {
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
  const response = await fetch("/get_images");
  const data = await response.json();

  // Create an array to hold promises that resolve when each image loads
  const loadPromises = [];

  data.forEach((imageData, index) => {
    if (index >= 9) return; // Only process the first 9 images

    const container = document.getElementById(`image${index + 1}`);
    const imageBlock = document.createElement("div");
    imageBlock.className = "image-block";

    // Create an image element
    const img = document.createElement("img");
    img.src = imageData.image_url;
    img.className = "image";

    // Create a promise that resolves when the image is loaded
    const imageLoadPromise = new Promise((resolve) => {
      img.onload = () => {
        resolve();
      };
    });
    loadPromises.push(imageLoadPromise);

    // Create a div element to hold the captions after images have loaded
    const captionDiv = document.createElement("div");
    captionDiv.className = "caption-container";

    const humanCaption = taggedText("Human", imageData.alt_text);
    captionDiv.appendChild(humanCaption);

    imageBlock.appendChild(captionDiv);
    container.insertBefore(imageBlock, container.firstChild);

    container.insertBefore(img, container.firstChild);

    document.getElementById(`image_id${index + 1}`).value = imageData.image_id;
  });

  // Wait for all images to load
  await Promise.all(loadPromises);

  // After all images have loaded, start loading captions
  data.forEach((imageData, index) => {
    if (index >= 9) return;

    const captionContainer = document
      .getElementById(`image${index + 1}`)
      .querySelector(".caption-container");

    /*
      captionContainer.appendChild(
        displayCaption("large", imageData.image_id),
      );
      */

    captionContainer.appendChild(
      displayCaption("pdf", imageData.image_id, index + 1),
    );
  });
}

async function fetchNeedTrainingImages() {
  const response = await fetch("/get_images?need_training=true");
  const data = await response.json();

  // Create an array to hold promises that resolve when each image loads
  const loadPromises = [];

  data.forEach((imageData, index) => {
    if (index >= 9) return; // Only process the first 9 images

    const container = document.getElementById(`t_image${index + 1}`);
    const imageBlock = document.createElement("div");
    imageBlock.className = "image-block";

    // Create an image element
    const img = document.createElement("img");
    img.src = imageData.image_url;
    img.className = "image";

    // Create a promise that resolves when the image is loaded
    const imageLoadPromise = new Promise((resolve) => {
      img.onload = () => {
        resolve();
      };
    });
    loadPromises.push(imageLoadPromise);

    // Create a div element to hold the captions after images have loaded
    const captionDiv = document.createElement("div");
    captionDiv.className = "caption-container";

    const humanCaption = taggedText("Human", imageData.alt_text);
    captionDiv.appendChild(humanCaption);

    imageBlock.appendChild(captionDiv);
    container.insertBefore(imageBlock, container.firstChild);

    container.insertBefore(img, container.firstChild);

    document.getElementById(`t_image_id${index + 1}`).value =
      imageData.image_id;
  });

  // Wait for all images to load
  await Promise.all(loadPromises);

  // After all images have loaded, start loading captions
  data.forEach((imageData, index) => {
    if (index >= 9) return;

    const captionContainer = document
      .getElementById(`t_image${index + 1}`)
      .querySelector(".caption-container");

    /*
      captionContainer.appendChild(
        displayCaption("large", imageData.image_id),
      );
      */

    captionContainer.appendChild(
      displayCaption("pdf", imageData.image_id, index + 1, "a_"),
    );
  });
}

async function fetchVerifiedImages() {
  const response = await fetch("/get_images?verified=true");
  const data = await response.json();

  // Create an array to hold promises that resolve when each image loads
  const loadPromises = [];

  data.forEach((imageData, index) => {
    if (index >= 9) return; // Only process the first 9 images

    const container = document.getElementById(`a_image${index + 1}`);
    const imageBlock = document.createElement("div");
    imageBlock.className = "image-block";

    // Create an image element
    const img = document.createElement("img");
    img.src = imageData.image_url;
    img.className = "image";

    // Create a promise that resolves when the image is loaded
    const imageLoadPromise = new Promise((resolve) => {
      img.onload = () => {
        resolve();
      };
    });
    loadPromises.push(imageLoadPromise);

    // Create a div element to hold the captions after images have loaded
    const captionDiv = document.createElement("div");
    captionDiv.className = "caption-container";

    const humanCaption = taggedText("Human", imageData.alt_text);
    captionDiv.appendChild(humanCaption);

    imageBlock.appendChild(captionDiv);
    container.insertBefore(imageBlock, container.firstChild);

    container.insertBefore(img, container.firstChild);

    document.getElementById(`a_image_id${index + 1}`).value =
      imageData.image_id;
  });

  // Wait for all images to load
  await Promise.all(loadPromises);

  // After all images have loaded, start loading captions
  data.forEach((imageData, index) => {
    if (index >= 9) return;

    const captionContainer = document
      .getElementById(`a_image${index + 1}`)
      .querySelector(".caption-container");

    /*
      captionContainer.appendChild(
        displayCaption("large", imageData.image_id),
      );
      */

    captionContainer.appendChild(
      displayCaption("pdf", imageData.image_id, index + 1, "a_"),
    );
  });
}

fetchImages();
fetchVerifiedImages();
fetchNeedTrainingImages();
clearBlurOnTabContents();

function openTab(evt, tabName) {
  console.log("openTab: ", tabName);

  var i, tabcontent, tablinks;
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }

  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }

  document.getElementById(tabName).style.display = "block";
  evt.currentTarget.className += " active";
}

document
  .getElementById("tab_to_verify")
  .addEventListener("click", function(event) {
    openTab(event, "to_verify");
  });

document
  .getElementById("tab_verified")
  .addEventListener("click", function(event) {
    openTab(event, "verified");
  });

document
  .getElementById("tab_to_train")
  .addEventListener("click", function(event) {
    openTab(event, "to_train");
  });

document
  .getElementById("tab_stats")
  .addEventListener("click", function(event) {
    openTab(event, "stats");
  });
