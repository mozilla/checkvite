import {
  env,
  pipeline,
} from "https://cdn.jsdelivr.net/npm/@xenova/transformers";

//env.remoteHost = "https://model-hub.mozilla.org/";

let url = new URL(window.location);
let params = new URLSearchParams(url.search);
let currentTab = params.get("tab") || "to_verify";
let batch = parseInt(params.get("batch") || 1);
let start = 1 + (batch - 1) * 9;
let mozillaCaptioner = null;
let baseLineCaptioner = null;

function blurTabContents(message) {
  const tabContents = document.querySelectorAll(".tabcontent");
  tabContents.forEach((tab) => {
    const container = document.createElement("div");
    container.className = "loader-container";

    // Create the loader div
    const loader = document.createElement("div");
    loader.className = "loader";

    // Create the text div
    const text = document.createElement("div");
    text.className = "loading-text";
    text.textContent = message;

    // Append the loader and text to the container
    container.appendChild(loader);
    container.appendChild(text);

    tab.style.position = "relative";
    tab.appendChild(container);
  });
}

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

async function fetchCaption(captioner, image_id) {
  const url = `/images/${image_id}.png`;
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

async function updateProgressBar() {
  try {
    // Fetch the data from the server; assuming the endpoint is '/stats'
    const response = await fetch("/stats");
    const data = await response.json();

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

function hideNavigationButtons() {
  document.getElementById("backward").style.display = "none";
  document.getElementById("forward").style.display = "none";
}

// Function to show navigation buttons
function showNavigationButtons() {
  document.getElementById("backward").style.display = "inline-block";
  document.getElementById("forward").style.display = "inline-block";
  document.getElementById("backward").addEventListener("click", function() {
    changeBatch(-1);
  });
  document.getElementById("forward").addEventListener("click", function() {
    changeBatch(1);
  });
}

async function openTab(_evt, tabName) {
  if (currentTab === tabName) return;

  // Update the current tab
  currentTab = tabName;

  // Update the URL parameters without reloading the page
  var url = new URL(window.location);
  var params = new URLSearchParams(url.search);
  params.set("tab", tabName);
  params.set("batch", "1"); // changing the tab resets the batch to 1
  url.search = params.toString();
  history.pushState({}, "", url.toString());

  await loadTab(tabName);
}

async function loadTab(tabName) {
  document.querySelectorAll('a[id^="tab_"]').forEach((tab) => {
    if (tab.id === `tab_${tabName}`) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  if (tabName === "stats") {
    injectStatsContent();

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
    hideNavigationButtons();
  } else if (tabName === "help") {
    injectHelp();

    hideNavigationButtons();
  } else {
    await fetchImages();
    showNavigationButtons();
  }
}

async function initPage() {
  const tabs = ["to_verify", "verified", "to_train", "stats", "help"];

  tabs.forEach((tab) => {
    document
      .getElementById(`tab_${tab}`)
      .addEventListener("click", (event) => openTab(event, tab));
  });

  // Loading model if needed.
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
    //alert('Form submitted successfully!');
    form.closest(".col-4").remove();
    reorganizeGrid(batch);
  } else {
    alert("Form submission failed.");
  }
}

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

async function fetchImages() {
  const response = await fetch(`/get_images?batch=${batch}&tab=${currentTab}`);
  const data = await response.json();

  const newContainer = document.createElement("div");
  newContainer.id = "images";

  data.forEach(async (imageData, index) => {
    if (index >= 9) return; // Only process the first 9 images
    const imageBlock = createImageBlock(imageData, start + index, currentTab);
    const img = imageBlock.querySelector("img");
    img.onload = () => {
      if (index % 3 === 0) {
        const newRow = document.createElement("div");
        newRow.className = "row";
        newContainer.appendChild(newRow);
      }
      newContainer.lastChild.appendChild(imageBlock);

      // Set the value of the hidden input
      document.getElementById(`image_id${start + index}`).value =
        imageData.image_id;

      prependCaptions(start + index, imageData);

      // Attach submit event listener to the new form
      imageBlock
        .querySelector("form.train-form")
        .addEventListener("submit", submitForm);
    };
  });

  // Replace the old container with the new one
  const oldContainer = document.getElementById("images");
  oldContainer.replaceWith(newContainer);
}

function createImageBlock(imageData, index, tab) {
  const imageBlock = document.createElement("div");
  imageBlock.className = "image-block col-4";
  imageBlock.id = `image${index}`;

  const img = document.createElement("img");
  img.src = imageData.image_url;
  img.className = "image";

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

  // Add footer with buttons
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

function injectStatsContent() {
  const container = document.getElementById("images");
  container.innerHTML = `
    <div class="card" style="margin-top: 15px; margin-bottom: 15px">
      <header>
        <h3>Training Stats</h3>
      </header>
      <div class="progress-bar">
        <div
          class="segment accurate"
          data-tooltip="Acceptable"
          style="width: 30%"
        >
          30%
        </div>
        <div
          class="segment biased"
          data-tooltip="Inacceptable"
          style="width: 20%"
        >
          20%
        </div>
        <div
          class="segment not-checked"
          data-tooltip="Not checked yet"
          style="width: 50%"
        >
          50%
        </div>
      </div>
      <h3>Add a new image</h3>
      <form action="/upload" method="post" enctype="multipart/form-data">
        <label for="image">Image:</label>
        <input type="file" id="image" name="image" required /><br /><br />
        <label for="alt_text">Alt Text:</label>
        <input
          type="text"
          id="alt_text"
          name="alt_text"
          placeholder="Enter alt text for the image"
          required
        /><br /><br />
        <label for="license">License:</label>
        <input
          type="text"
          id="license"
          name="license"
          value="APLv2"
          required
        /><br /><br />
        <label for="source">Source:</label>
        <input
          type="text"
          id="source"
          name="source"
          value="N/A"
          required
        /><br /><br />
        <button type="submit">Upload</button>
      </form>
    </div>
  `;
}

function injectHelp() {
  const container = document.getElementById("images");
  container.innerHTML = `
        <div class="card" style="margin-top: 15px; margin-bottom: 15px">
          <header>
            <h2>Guidelines to curate the dataset</h2>
          </header>

    <p>Make sure you are on the <a href="/?tab=to_verify&batch=1">To Verify</a> tab of the site.</p>
    <p>For each image, you will be evaluating the "Firefox" alt text as compared to alt text provided by a human (“Human”) and text provided by another model (“Baseline”).
    If the “Firefox” alt text fits our defined criteria for "Acceptable" (see below), click "Accept" without filling out any other fields.
    Click on the wand to generate the text.
    If it fits the criteria below for “Unacceptable,” write an improved alt text description, select all applicable reasons for rejection, and then click Reject & Retrain.</p>

    <h3>Acceptable vs. Unacceptable Alt Text</h3>
    <p>We will be evaluating this model from the perspective of a content creator,</p>
    <ul>
     <li><strong>Acceptable</strong> I would use this description with no or minimal editing (adding or changing just a few words).</li>

      <li><strong>Unacceptable</strong> I would rewrite this description significantly or entirely.</li>
    </ul>

    <h3>Reasons for Rejection</h3>
    <p>If the description is unacceptable, please select each applicable reason, as defined below:</p>
    <ul>
        <li><strong>Inaccurate:</strong>
            <ul>
                <li>The content misidentifies people or objects from the image or contains false information.</li>
                <li>The model inaccurately counts the number of people or objects. Instead of specific numbers, it should use general terms like “some” or “group”.</li>
            </ul>
        </li>
        <li><strong>Assumptive:</strong> The model shouldn’t assume identity or culture. This means it should never mention the following, even at the expense of potential relevancy, because only the content creator can properly assess identity characteristics:
            <ul>
                <li>Gender: Should use “person” or “kid”/“child” instead</li>
                <li>Race or nationality</li>
                <li>Health or disability status</li>
                <li>Historical, religious, or cultural context</li>
            </ul>
        </li>
        <li><strong>Difficult to read:</strong>
            <ul>
                <li>Contains grammatical errors</li>
                <li>Meaning is unclear</li>
                <li>Uses overly complex words and sentence constructions</li>
            </ul>
        </li>
        <li><strong>Not concise:</strong> The description is not a concise description of the image’s purpose
            <ul>
                <li>It is too long, wordy, or repetitive</li>
                <li>It includes superfluous words like “image,” “icon”, or “picture”</li>
            </ul>
        </li>
        <li><strong>Lacks details:</strong> Does not include the relevant, appropriate details that help readers gain a basic understanding of what the image depicts.</li>
        <li><strong>Wrong tone:</strong> The tone of the writing is not neutral and conversational
            <ul>
                <li>Inflects strong emotions</li>
                <li>Sentence structures sound unnatural or overly formal when read aloud</li>
            </ul>
        </li>
    </ul>
          </div>
  `;
}

initPage();
