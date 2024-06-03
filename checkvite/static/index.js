import {
  env,
  pipeline,
} from "https://cdn.jsdelivr.net/npm/@xenova/transformers";

if (window.PRODUCTION) {
  console.log("Running in production mode");
  env.localModelPath = "/models/";
  env.allowRemoteModels = false;
  env.backends.onnx.wasm.wasmPaths = "/wasm/";
} else {
  console.log("Running in development mode");
}

let url = new URL(window.location);
let params = new URLSearchParams(url.search);
let currentTab = params.get("tab") || "to_verify";
let currentBatch = parseInt(params.get("batch") || 1);
let start = 1 + (currentBatch - 1) * 9;
let mozillaCaptioner = null;
let baseLineCaptioner = null;
let isBackwardListenerAttached = false;
let isForwardListenerAttached = false;
let statsHTML = null;
let helpHTML = null;

/**
 * Blurs the contents of the current tab with a loading message.
 * @param {string} message - The loading message to display.
 */
function blurTabContents(message) {
  const tabContents = document.querySelectorAll(".tabcontent");
  tabContents.forEach((tab) => {
    const container = document.createElement("div");
    container.className = "loader-container";

    const loader = document.createElement("div");
    loader.className = "loader";

    const text = document.createElement("div");
    text.className = "loading-text";
    text.textContent = message;

    container.appendChild(loader);
    container.appendChild(text);

    tab.style.position = "relative";
    tab.appendChild(container);
  });
}

/**
 * Clears the blur effect and loading message from the tab contents.
 */
function clearBlurOnTabContents() {
  const tabContents = document.querySelectorAll(".tabcontent");
  tabContents.forEach((tab) => {
    tab.style.filter = "none";
    if (
      tab.lastElementChild &&
      tab.lastElementChild.innerText === "Reticulating splines"
    ) {
      tab.removeChild(tab.lastElementChild);
    }
  });
}

/**
 * Converts a canvas element to a Blob object.
 * @param {HTMLCanvasElement} canvas - The canvas element to convert.
 * @returns {Promise<Blob>} A promise that resolves to a Blob object.
 */
function getCanvasBlob(canvas) {
  return new Promise(function(resolve, reject) {
    canvas.toBlob((blob) => {
      resolve(blob);
    });
  });
}

/**
 * Fetches the caption for an image using the specified captioner.
 * @param {string} captioner - The captioner to use ("Firefox" or other).
 * @param {string} image_id - The ID of the image to caption.
 * @returns {Promise<string>} A promise that resolves to the generated caption text.
 */
async function fetchCaption(captioner, image_id) {
  let pipeline;
  if (captioner === "Firefox") {
    pipeline = mozillaCaptioner;
  } else {
    pipeline = baseLineCaptioner;
  }
  const img = document.getElementById(`actual_${image_id}`);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = img.width;
  canvas.height = img.height;
  context.drawImage(img, 0, 0, img.width, img.height);
  const blob = await getCanvasBlob(canvas);
  const blobUrl = URL.createObjectURL(blob);
  let res = await pipeline(blobUrl);
  res = res[0].generated_text;
  return res;
}

/**
 * Creates a div element containing a tagged text.
 * @param {string} tag - The tag to display.
 * @param {string} text - The text to display.
 * @returns {HTMLDivElement} The created div element.
 */
function taggedText(tag, text) {
  const captionDiv = document.createElement("div");
  captionDiv.innerHTML = `<span class='tag'>${tag}</span> ${text}`;
  return captionDiv;
}

/**
 * Displays a caption button for an image.
 * @param {string} captioner - The captioner to use.
 * @param {string} image_id - The ID of the image to caption.
 * @param {string} [class_prefix=""] - An optional prefix for the element IDs.
 * @returns {HTMLDivElement} The created div element containing the button.
 */
function displayCaption(captioner, image_id, class_prefix = "") {
  var div = document.createElement("div");
  div.id = `${class_prefix}caption${captioner}${image_id}`;
  var button = document.createElement("button");
  button.innerHTML = "🪄";
  button.className = "button";
  button.style.backgroundColor = "#f3f3f6";

  button.addEventListener("click", function(event) {
    event.target.innerHTML = '<div class="loader-small"></div>';

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

/**
 * Updates the progress bar based on fetched data.
 * @returns {Promise<void>}
 */
async function updateProgressBar() {
  try {
    const response = await fetch("/stats");
    const data = await response.json();

    const { verified, need_training, to_verify } = data;

    let total = verified + need_training + to_verify;

    let accurateSegment = document.querySelector(".segment.accurate");
    let biasedSegment = document.querySelector(".segment.biased");
    let notCheckedSegment = document.querySelector(".segment.not-checked");

    let accuratePercent = (verified / total) * 100 || 0;
    let biasedPercent = (need_training / total) * 100 || 0;
    let notCheckedPercent = (to_verify / total) * 100 || 0;

    accurateSegment.style.width = `${accuratePercent}%`;
    accurateSegment.textContent = `${verified}`;
    biasedSegment.style.width = `${biasedPercent}%`;
    biasedSegment.textContent = `${need_training}`;
    notCheckedSegment.style.width = `${notCheckedPercent}%`;
    notCheckedSegment.textContent = `${to_verify}`;
  } catch (error) {
    console.error("Failed to fetch stats: ", error);
  }
}

/**
 * Changes the batch of images being displayed.
 * @param {number} direction - The direction to change the batch (-1 for previous, 1 for next).
 * @returns {Promise<void>}
 */
async function changeBatch(direction) {
  let newBatch = currentBatch + direction;
  if (newBatch < 1) {
    newBatch = 1;
  }
  currentBatch = newBatch;
  start = 1 + (currentBatch - 1) * 9;
  updateURL();
  await loadTab(currentTab);
}

/**
 * Hides the navigation buttons and removes their event listeners.
 */
function hideNavigationButtons() {
  const backwardButton = document.getElementById("backward");
  const forwardButton = document.getElementById("forward");

  backwardButton.style.display = "none";
  forwardButton.style.display = "none";

  if (isBackwardListenerAttached) {
    backwardButton.removeEventListener("click", backwardClickHandler);
    isBackwardListenerAttached = false;
  }
  if (isForwardListenerAttached) {
    forwardButton.removeEventListener("click", forwardClickHandler);
    isForwardListenerAttached = false;
  }
}

/**
 * Handles the click event for the backward button.
 * @returns {Promise<void>}
 */
async function backwardClickHandler() {
  await changeBatch(-1);
}

/**
 * Handles the click event for the forward button.
 * @returns {Promise<void>}
 */
async function forwardClickHandler() {
  await changeBatch(1);
}

/**
 * Shows the navigation buttons and attaches their event listeners.
 */
function showNavigationButtons() {
  const backwardButton = document.getElementById("backward");
  const forwardButton = document.getElementById("forward");

  backwardButton.style.display = "inline-block";
  forwardButton.style.display = "inline-block";

  if (backwardButton.style.display !== "none" && !isBackwardListenerAttached) {
    backwardButton.addEventListener("click", backwardClickHandler);
    isBackwardListenerAttached = true;
  }

  if (forwardButton.style.display !== "none" && !isForwardListenerAttached) {
    forwardButton.addEventListener("click", forwardClickHandler);
    isForwardListenerAttached = true;
  }
}

/**
 * Updates the URL with the current tab and batch parameters.
 */
function updateURL() {
  var url = new URL(window.location);
  var params = new URLSearchParams(url.search);
  params.set("tab", currentTab);
  params.set("batch", currentBatch);
  url.search = params.toString();
  history.pushState({}, "", url.toString());
}

/**
 * Opens the specified tab and loads its content.
 * @param {Event} _evt - The event object.
 * @param {string} tabName - The name of the tab to open.
 * @param {number} [batch=1] - The batch number to load.
 * @returns {Promise<void>}
 */
async function openTab(_evt, tabName, batch = 1) {
  if (currentTab === tabName && currentBatch === batch) return;

  currentBatch = batch;
  currentTab = tabName;
  start = 1 + (currentBatch - 1) * 9;
  updateURL();
  await loadTab(tabName);
}

/**
 * Loads the content for the specified tab.
 * @param {string} tabName - The name of the tab to load.
 * @returns {Promise<void>}
 */
async function loadTab(tabName) {
  document.querySelectorAll('a[id^="tab_"]').forEach((tab) => {
    if (tab.id === `tab_${tabName}`) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  if (tabName === "stats") {
    await injectStatsContent();

    const imageInput = document.getElementById("image");
    const imagePreview = document.getElementById("imagePreview");

    imageInput.addEventListener("change", function() {
      const file = this.files[0];
      if (file) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.style.display = "block";
        imagePreview.onload = function() {
          URL.revokeObjectURL(imagePreview.src);
        };
      }
    });

    updateProgressBar();
    hideNavigationButtons();
  } else if (tabName === "help") {
    await injectHelp();

    hideNavigationButtons();
  } else {
    await fetchImages();
    showNavigationButtons();
  }
}

/**
 * Initializes the page and loads the initial content.
 * @returns {Promise<void>}
 */
async function initPage() {
  const tabs = ["to_verify", "verified", "to_train", "stats", "help"];

  tabs.forEach((tab) => {
    document
      .getElementById(`tab_${tab}`)
      .addEventListener("click", (event) => openTab(event, tab));
  });

  if (currentTab != "stats" && currentTab != "help" && !mozillaCaptioner) {
    blurTabContents("Loading models ~ takes a few mins on first load");
    mozillaCaptioner = await pipeline(
      "image-to-text",
      "tarekziade/vit-base-patch16-224-in21k-distilgpt2",
    );
    baseLineCaptioner = await pipeline(
      "image-to-text",
      "Xenova/vit-gpt2-image-captioning",
    );
    clearBlurOnTabContents();
  }

  await loadTab(currentTab);
}

/**
 * Handles the form submission event.
 * @param {Event} event - The form submission event.
 * @returns {Promise<void>}
 */
async function submitForm(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const submitButton = event.submitter;
  if (submitButton && submitButton.name) {
    formData.append("action", submitButton.name);
  }

  const response = await fetch("/train", {
    method: "POST",
    body: formData,
  });
  if (response.ok) {
    form.closest(".col-4").remove();
    reorganizeGrid(currentBatch);
  } else {
    alert("Form submission failed.");
  }
}

/**
 * Reorganizes the grid of images after a form submission.
 * @param {number} batch - The current batch number.
 */
function reorganizeGrid(batch) {
  const container = document.getElementById("images");
  const imageBlocks = Array.from(container.querySelectorAll(".col-4"));
  container.innerHTML = "";

  let row;
  imageBlocks.forEach((block, index) => {
    if (index % 3 === 0) {
      row = document.createElement("div");
      row.className = "row";
      container.appendChild(row);
    }
    row.appendChild(block);
  });

  fetchNewImage(batch, currentTab);
}

/**
 * Fetches a new image to display in the grid.
 * @param {number} batch - The current batch number.
 * @param {string} tab - The current tab name.
 * @returns {Promise<void>}
 */
async function fetchNewImage(batch, tab) {
  try {
    const response = await fetch(
      `/get_image?batch=${batch}&index=9&tab=${tab}`,
    );
    if (response.ok) {
      const newImageData = await response.json();

      const container = document.getElementById("images");
      const newImageBlock = createImageBlock(newImageData, 9, tab);

      const rows = container.querySelectorAll(".row");
      const lastRow = rows[rows.length - 1];

      lastRow.appendChild(newImageBlock);

      newImageBlock
        .querySelector("form.train-form")
        .addEventListener("submit", submitForm);

      renumberImageIDs();
      prependCaptions(9, newImageData);
    } else {
      console.error("Failed to fetch a new image");
    }
  } catch (error) {
    console.error("Error fetching a new image:", error);
  }
}

/**
 * Renumbers the IDs of the image elements in the grid.
 */
function renumberImageIDs() {
  const container = document.getElementById("images");

  const divs = container.querySelectorAll('div[id^="image"]');
  const sortedDivs = Array.from(divs).sort((a, b) => {
    const numA = parseInt(a.id.replace("image", ""), 10);
    const numB = parseInt(b.id.replace("image", ""), 10);
    return numA - numB;
  });
  sortedDivs.forEach((div, index) => {
    div.id = "image" + (index + 1);
  });
}

/**
 * Prepends captions to the specified image element.
 * @param {number} table_idx - The index of the table to update.
 * @param {Object} imageData - The data of the image to caption.
 */
function prependCaptions(table_idx, imageData) {
  const captionContainer = document.querySelector(
    `#image${table_idx} .caption-container`,
  );
  if (captionContainer) {
    captionContainer.prepend(
      displayCaption("Baseline model", imageData.image_id),
    );
    captionContainer.prepend(displayCaption("Firefox", imageData.image_id));
  } else {
    console.error(`Caption container not found for image${table_idx}`);
  }
}

/**
 * Fetches and displays the images for the current tab and batch.
 * @returns {Promise<void>}
 */
async function fetchImages() {
  const response = await fetch(
    `/get_images?batch=${currentBatch}&tab=${currentTab}`,
  );
  const data = await response.json();

  const newContainer = document.createElement("div");
  newContainer.id = "images";
  let newRow;

  data.forEach(async (imageData, index) => {
    if (index >= 9) return;
    const imageBlock = createImageBlock(imageData, start + index, currentTab);
    const img = imageBlock.querySelector("img");

    if (index % 3 === 0) {
      newRow = document.createElement("div");
      newRow.className = "row";
      newContainer.appendChild(newRow);
    }

    img.onload = () => {
      newRow.appendChild(imageBlock);

      document.getElementById(`image_id${start + index}`).value =
        imageData.image_id;

      prependCaptions(start + index, imageData);

      imageBlock
        .querySelector("form.train-form")
        .addEventListener("submit", submitForm);
    };
  });

  const oldContainer = document.getElementById("images");
  oldContainer.replaceWith(newContainer);
}

/**
 * Creates an image block element.
 * @param {Object} imageData - The data of the image to display.
 * @param {number} index - The index of the image.
 * @param {string} tab - The current tab name.
 * @returns {HTMLDivElement} The created image block element.
 */
function createImageBlock(imageData, index, tab) {
  const imageBlock = document.createElement("div");
  imageBlock.className = "image-block col-4";
  imageBlock.id = `image${index}`;

  const img = document.createElement("img");
  img.src = imageData.image_url;
  img.className = "image";
  img.id = `actual_${imageData.image_id}`;

  const captionDiv = document.createElement("div");
  captionDiv.className = "caption-container";

  const humanCaption = taggedText("Human text", imageData.alt_text);
  captionDiv.appendChild(humanCaption);

  if (tab === "to_train") {
    const trainCaption = taggedText(
      "Text for training",
      imageData.inclusive_alt_text,
    );
    captionDiv.appendChild(trainCaption);
  }

  imageBlock.appendChild(captionDiv);
  imageBlock.insertBefore(img, imageBlock.firstChild);

  const form = document.createElement("form");
  form.id = `form${index}`;
  form.className = "train-form";
  form.method = "POST";
  form.enctype = "application/x-www-form-urlencoded";

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.name = "image_id";
  hiddenInput.id = `image_id${index}`;
  hiddenInput.value = imageData.image_id;
  form.appendChild(hiddenInput);

  if (tab !== "to_train") {
    const feedbackHeader = document.createElement("h4");
    feedbackHeader.textContent = "Feedback";
    form.appendChild(feedbackHeader);

    const captionLabel = document.createElement("label");
    captionLabel.htmlFor = `caption${index}`;
    captionLabel.textContent = "Improved alt text";
    form.appendChild(captionLabel);

    const captionInput = document.createElement("input");
    captionInput.type = "text";
    captionInput.name = "caption";
    captionInput.id = `caption${index}`;
    form.appendChild(captionInput);

    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Reasons for rejection";
    fieldset.appendChild(legend);

    const reasons = [
      "inaccurate",
      "assumptive",
      "difficult_to_read",
      "not_concise",
      "lacks_details",
      "wrong_tone",
    ];
    reasons.forEach((reason) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "rejection_reason";
      checkbox.value = reason;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(reason.replace(/_/g, " ")));
      fieldset.appendChild(label);
      fieldset.appendChild(document.createElement("br"));
    });

    form.appendChild(fieldset);
  }

  const footer = document.createElement("footer");
  footer.className = "is-right";

  if (tab !== "verified") {
    const acceptButton = document.createElement("button");
    acceptButton.name = "discard";
    acceptButton.type = "submit";
    acceptButton.id = `success_${index}`;
    acceptButton.className = "button success";
    acceptButton.textContent =
      tab === "to_train" ? "I changed my mind!" : "Accept";
    footer.appendChild(acceptButton);
  }

  if (tab !== "to_train") {
    const rejectButton = document.createElement("button");
    rejectButton.name = "train";
    rejectButton.type = "submit";
    rejectButton.id = `fail_${index}`;
    rejectButton.className = "button error";
    rejectButton.textContent =
      tab === "verified" ? "I changed my mind!" : "Reject & Retrain";
    footer.appendChild(rejectButton);
  }

  form.appendChild(footer);
  imageBlock.appendChild(form);

  return imageBlock;
}

/**
 * Loads content from the specified URL.
 * @param {string} url - The URL to load content from.
 * @returns {Promise<string>} A promise that resolves to the loaded content.
 */
async function loadContent(url) {
  const response = await fetch(url);
  return response.text();
}

/**
 * Injects the stats content into the page.
 * @returns {Promise<void>}
 */
async function injectStatsContent() {
  const container = document.getElementById("images");
  if (!statsHTML) {
    statsHTML = await loadContent("static/stats.html");
  }
  container.innerHTML = statsHTML;
}

/**
 * Injects the help content into the page.
 * @returns {Promise<void>}
 */
async function injectHelp() {
  const container = document.getElementById("images");
  if (!helpHTML) {
    helpHTML = await loadContent("static/help.html");
  }
  container.innerHTML = helpHTML;
}

initPage();
