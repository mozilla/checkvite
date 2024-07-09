import {
  env,
  pipeline,
} from "https://cdn.jsdelivr.net/npm/@xenova/transformers";

import "https://cdn.jsdelivr.net/npm/chart.js";

export class ImageCaptionApp {
  #currentTab;
  #currentBatch;
  #start;
  #mozillaCaptioner;
  #baseLineCaptioner;
  #statsHTML;
  #helpHTML;
  #user;
  #checkUser;
  #batchSize;
  #checkBatchSize;
  #userList;

  constructor() {
    this.#initializeEnvironment();
    this.#initializeState();
  }

  #initializeEnvironment() {
    if (window.PRODUCTION) {
      console.log("Running in production mode");
      env.localModelPath = "/models/";
      env.allowRemoteModels = false;
      env.backends.onnx.wasm.wasmPaths = "/wasm/";
    } else {
      console.log("Running in development mode");
    }
  }

  #initializeState() {
    const url = new URL(window.location);
    const params = new URLSearchParams(url.search);
    this.#currentTab = params.get("tab") || "to_verify";
    this.#batchSize = params.get("batch_size") || 9;
    this.#currentBatch = parseInt(params.get("batch") || 1);
    this.#start = 1 + (this.#currentBatch - 1) * this.#batchSize;
    this.#mozillaCaptioner = null;
    this.#baseLineCaptioner = null;
    this.#statsHTML = null;
    this.#helpHTML = null;
    this.#user = null;
    this.#checkUser = params.get("user_id") || "user1";
    this.#checkBatchSize = params.get("checkBatchSize") || "50";
  }

  async initPage(user, model_id, model_revision, baseline_model_id, user_list) {
    if (user === "None") {
      user = null;
    }
    console.log("Initializing page for user", user);
    this.#user = user;
    this.#userList = user_list;
    const tabs = [
      "to_verify",
      "verified",
      "to_train",
      "stats",
      "help",
      "check",
    ];
    tabs.forEach((tab) => {
      document
        .getElementById(`tab_${tab}`)
        .addEventListener("click", (event) => this.openTab(event, tab));
    });

    if (
      this.#currentTab !== "stats" &&
      this.#currentTab !== "help" &&
      !this.#mozillaCaptioner
    ) {
      this.blurTabContents("Loading models ~ takes a few mins on first load");
      this.#mozillaCaptioner = await pipeline(
        "image-to-text",
        model_id,
        model_revision,
      );
      this.#baseLineCaptioner = await pipeline(
        "image-to-text",
        baseline_model_id,
      );
      this.clearBlurOnTabContents();
    }

    await this.loadTab(this.#currentTab);
  }

  blurTabContents(message) {
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

  clearBlurOnTabContents() {
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

  getCanvasBlob(canvas) {
    return new Promise(function(resolve, reject) {
      canvas.toBlob((blob) => {
        resolve(blob);
      });
    });
  }

  async fetchCaption({
    captioner,
    image_id,
    image_selector = `actual_${image_id}`,
    image_url,
  }) {
    let pipeline;
    let res;
    if (captioner === "Firefox") {
      pipeline = this.#mozillaCaptioner;
    } else {
      pipeline = this.#baseLineCaptioner;
    }
    if (!image_url) {
      const img = document.getElementById(image_selector);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      context.drawImage(img, 0, 0, img.width, img.height);
      const blob = await this.getCanvasBlob(canvas);
      const blobUrl = URL.createObjectURL(blob);
      res = await pipeline(blobUrl);
    } else {
      res = await pipeline(image_url);
    }
    res = res[0].generated_text;
    if (res === "T") {
      res = "Text document.";
    }
    return res;
  }

  taggedText(tag, text) {
    const captionDiv = document.createElement("div");
    captionDiv.innerHTML = `<span class='tag'>${tag}</span> ${text}`;
    return captionDiv;
  }

  displayCaption({
    captioner,
    image_id,
    class_prefix = "",
    create_header = true,
    image_selector = `actual_${image_id}`,
    image_url,
  }) {
    const div = document.createElement("div");
    div.id = `${class_prefix}caption${captioner}${image_id}`;
    const button = document.createElement("button");
    button.innerHTML = "🪄";
    button.className = "button";
    button.style.backgroundColor = "#f3f3f6";

    button.addEventListener("click", (event) => {
      event.target.innerHTML = '<div class="loader-small"></div>';

      this.fetchCaption({
        captioner,
        image_id,
        image_selector,
        image_url,
      }).then((caption) => {
        const captionDiv = document.getElementById(
          `${class_prefix}caption${captioner}${image_id}`,
        );
        const captionTextNode = document.createTextNode(caption);
        const newText = document.createElement("span");
        newText.appendChild(captionTextNode);
        captionDiv.replaceChild(newText, event.target);
      });
    });

    if (create_header) {
      div.innerHTML = `<span class='tag'>${captioner}</span>`;
    }

    div.appendChild(button);
    return div;
  }

  async updateProgressBar() {
    try {
      const response = await fetch("/stats");
      const data = await response.json();
      const {
        verified,
        need_training,
        to_verify,
        acceptance_rate,
        u_verified,
        u_need_training,
        u_to_verify,
        rejection_reasons,
        total,
        total_user,
      } = data;
      // Handle the rejection stats
      const rejectionContainer = document.getElementById("rejectionStats");
      rejectionContainer.innerHTML = ""; // Clear previous contents

      const maxCount = Math.max(...Object.values(rejection_reasons));

      Object.entries(rejection_reasons).forEach(([reason, count]) => {
        const wrapperDiv = document.createElement("div");
        wrapperDiv.style.width = "100%";
        wrapperDiv.style.backgroundColor = "#d3d3d3";
        wrapperDiv.style.margin = "5px 0";
        wrapperDiv.style.position = "relative";
        wrapperDiv.style.height = "30px"; // Added height for better visibility

        const rejectionDiv = document.createElement("div");
        rejectionDiv.style.width = `${(count / maxCount) * 100}%`;
        rejectionDiv.style.height = "100%";
        rejectionDiv.style.backgroundColor = "lightblue";
        rejectionDiv.style.position = "absolute";
        rejectionDiv.style.top = "0";
        rejectionDiv.style.left = "0";

        const textDiv = document.createElement("div");
        textDiv.style.position = "absolute";
        textDiv.style.top = "50%";
        textDiv.style.left = "10px";
        textDiv.style.transform = "translateY(-50%)"; // Center the text vertically
        textDiv.style.whiteSpace = "nowrap";
        textDiv.style.color = "white";
        textDiv.textContent = `${reason}: ${count}`;

        wrapperDiv.appendChild(rejectionDiv);
        wrapperDiv.appendChild(textDiv);
        rejectionContainer.appendChild(wrapperDiv);
      });

      //let total = verified + need_training + to_verify;
      //let u_total = u_verified + u_need_training + u_to_verify;

      document.getElementById("acceptanceRate").textContent =
        `${acceptance_rate}%`;

      // Data for the overall progress chart
      const overallData = {
        labels: ["Accurate", "Biased", "Not Checked"],
        datasets: [
          {
            data: [verified, need_training, to_verify],
            backgroundColor: ["green", "red", "grey"],
          },
        ],
      };

      document.getElementById("numberOfImages").textContent = `Total: ${total}`;
      document.getElementById("numberOfUserImages").textContent =
        `Total: ${total_user}`;

      // Create the overall progress pie chart
      const overallCtx = document
        .getElementById("overallProgressChart")
        .getContext("2d");
      new Chart(overallCtx, {
        type: "pie",
        data: overallData,
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "bottom",
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  let label = context.label || "";
                  if (label) {
                    label += ": ";
                  }
                  label += context.raw;
                  return label;
                },
              },
            },
          },
        },
      });

      if (total_user == 0) {
        document.getElementById("user-progress").style.display = "none";
        return;
      }

      // Data for the user progress chart
      const userData = {
        labels: ["Accurate", "Biased", "Not Checked"],
        datasets: [
          {
            data: [u_verified, u_need_training, u_to_verify],
            backgroundColor: ["green", "red", "grey"],
          },
        ],
      };

      // Create the user progress pie chart
      const userCtx = document
        .getElementById("userProgressChart")
        .getContext("2d");
      new Chart(userCtx, {
        type: "pie",
        data: userData,
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "bottom",
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  let label = context.label || "";
                  if (label) {
                    label += ": ";
                  }
                  label += context.raw;
                  return label;
                },
              },
            },
          },
        },
      });
    } catch (error) {
      console.error("Failed to fetch stats: ", error);
    }
  }

  async changeBatch(direction) {
    let newBatch = this.#currentBatch + direction;
    if (newBatch < 1) {
      newBatch = 1;
    }
    this.#currentBatch = newBatch;
    this.#start = 1 + (this.#currentBatch - 1) * 9;
    this.updateURL();
    await this.loadTab(this.#currentTab);
  }

  hideNavigationButtons() {
    const backwardButton = document.getElementById("backward");
    const forwardButton = document.getElementById("forward");
    backwardButton.style.display = "none";
    forwardButton.style.display = "none";
  }

  async backwardClickHandler() {
    await this.changeBatch(-1);
  }

  async forwardClickHandler() {
    await this.changeBatch(1);
  }

  showNavigationButtons() {
    const backwardButton = document.getElementById("backward");
    const forwardButton = document.getElementById("forward");

    backwardButton.style.display = "inline-block";
    forwardButton.style.display = "inline-block";

    const newBackward = backwardButton.cloneNode(true);
    newBackward.addEventListener("click", this.backwardClickHandler.bind(this));
    backwardButton.parentNode.replaceChild(newBackward, backwardButton);

    const newForward = forwardButton.cloneNode(true);
    newForward.addEventListener("click", this.forwardClickHandler.bind(this));
    forwardButton.parentNode.replaceChild(newForward, forwardButton);
  }

  updateURL() {
    var url = new URL(window.location);
    var params = new URLSearchParams(url.search);
    params.set("tab", this.#currentTab);
    params.set("batch", this.#currentBatch);
    url.search = params.toString();
    history.pushState({}, "", url.toString());
  }

  async openTab(_evt, tabName, batch = 1) {
    if (this.#currentTab === tabName && this.#currentBatch === batch) return;
    this.#currentBatch = batch;
    this.#currentTab = tabName;
    this.#start = 1 + (this.#currentBatch - 1) * this.#batchSize;

    this.updateURL();
    await this.loadTab(tabName);
  }

  async loadTab(tabName) {
    document.querySelectorAll('a[id^="tab_"]').forEach((tab) => {
      if (tab.id === `tab_${tabName}`) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });

    if (tabName === "stats") {
      await this.injectStatsContent();

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

      this.updateProgressBar();
      this.hideNavigationButtons();
    } else if (tabName === "help") {
      await this.injectHelp();
      this.hideNavigationButtons();
    } else if (tabName === "check") {
      await this.injectCheck();
      this.hideNavigationButtons();
    } else {
      await this.fetchImages();
      this.showNavigationButtons();
    }
  }

  async submitForm(event) {
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
      if (this.#currentTab == "to_verify") {
        form.closest(".col-4").remove();
        this.reorganizeGrid(this.#currentBatch);
      } else {
        // In-place editing
        await this.loadTab(this.#currentTab);
      }
    } else {
      alert("Form submission failed.");
    }
  }

  reorganizeGrid(batch) {
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
    if (this.#currentTab == "to_verify") {
      this.fetchNewImage(batch, this.#currentTab);
    }
  }

  async fetchNewImage(batch, tab) {
    try {
      const response = await fetch(
        `/get_image?batch=${batch}&index=8&tab=${tab}`,
      );
      if (response.ok) {
        const newImageData = await response.json();

        const container = document.getElementById("images");
        const newImageBlock = this.createImageBlock(newImageData, 9, tab);

        const rows = container.querySelectorAll(".row");
        const lastRow = rows[rows.length - 1];

        lastRow.appendChild(newImageBlock);

        newImageBlock
          .querySelector("form.train-form")
          .addEventListener("submit", this.submitForm.bind(this));

        this.renumberImageIDs();
        this.prependCaptions(9, newImageData);
      } else {
        console.error("Failed to fetch a new image");
      }
    } catch (error) {
      console.error("Error fetching a new image:", error);
    }
  }

  renumberImageIDs() {
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

  prependCaptions(table_idx, imageData) {
    const captionContainer = document.querySelector(
      `#image${table_idx} .caption-container`,
    );
    if (captionContainer) {
      captionContainer.prepend(
        this.displayCaption({
          captioner: "Baseline model",
          image_id: imageData.image_id,
        }),
      );
      captionContainer.prepend(
        this.displayCaption({
          captioner: "Firefox",
          image_id: imageData.image_id,
        }),
      );
    } else {
      console.error(`Caption container not found for image${table_idx}`);
    }
  }

  async fetchImages() {
    const response = await fetch(
      `/get_images?batch=${this.#currentBatch}&tab=${this.#currentTab}`,
    );
    const data = await response.json();
    const oldContainer = document.getElementById("images");

    if (data.length === 0) {
      oldContainer.innerHTML = "Nothing to see here.";
      return;
    }

    const newContainer = document.createElement("div");
    newContainer.id = "images";
    let newRow;

    data.forEach(async (imageData, index) => {
      if (index >= 9) return;
      const imageBlock = this.createImageBlock(
        imageData,
        this.#start + index,
        this.#currentTab,
      );
      const img = imageBlock.querySelector("img");

      if (index % 3 === 0) {
        newRow = document.createElement("div");
        newRow.className = "row";
        newContainer.appendChild(newRow);
      }

      img.onload = () => {
        newRow.appendChild(imageBlock);

        document.getElementById(`image_id${this.#start + index}`).value =
          imageData.image_id;

        this.prependCaptions(this.#start + index, imageData);

        imageBlock
          .querySelector("form.train-form")
          .addEventListener("submit", this.submitForm.bind(this));
      };
    });

    oldContainer.replaceWith(newContainer);
  }

  createImageBlock(imageData, index, tab) {
    const imageBlock = document.createElement("div");
    imageBlock.className = "image-block col-4";
    imageBlock.id = `image${index}`;

    const img = document.createElement("img");
    img.src = imageData.image_url;
    img.className = "image";
    img.id = `actual_${imageData.image_id}`;

    // Create the NSFW label
    let nsfwLabel = document.createElement("div");
    nsfwLabel.classList.add("nsfw-label");
    nsfwLabel.innerText = "NSFW";

    // Add blur effect if the image is NSFW
    if (imageData.nsfw === 1) {
      img.classList.add("blurred");
      imageBlock.classList.add("nsfw");
    }

    // Add event listener for zoom functionality
    img.addEventListener("click", function() {
      const zoomedImage = document.createElement("div");
      zoomedImage.className = "zoomed-image";
      const zoomedImg = document.createElement("img");
      zoomedImg.src = imageData.image_url;
      zoomedImg.className = "zoomed-img";
      zoomedImage.appendChild(zoomedImg);

      // Add click event to remove the zoomed image
      zoomedImage.addEventListener("click", function() {
        document.body.removeChild(zoomedImage);
      });

      document.body.appendChild(zoomedImage);
    });

    const captionDiv = document.createElement("div");
    captionDiv.className = "caption-container";

    const humanCaption = this.taggedText("Human text", imageData.alt_text);
    captionDiv.appendChild(humanCaption);

    if (imageData.inclusive_alt_text !== "") {
      const trainCaption = this.taggedText(
        "Text for training",
        imageData.inclusive_alt_text,
      );
      captionDiv.appendChild(trainCaption);
    }

    imageBlock.appendChild(captionDiv);
    imageBlock.insertBefore(img, imageBlock.firstChild);
    imageBlock.insertBefore(nsfwLabel, imageBlock.firstChild);

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

    if (this.#user) {
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
      if (imageData.inclusive_alt_text !== "") {
        captionInput.value = imageData.inclusive_alt_text;
      }

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
        if (imageData.rejection_reasons.includes(reason)) {
          checkbox.checked = true;
        }
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(reason.replace(/_/g, " ")));
        fieldset.appendChild(label);
        fieldset.appendChild(document.createElement("br"));
      });

      form.appendChild(fieldset);
    }

    const footer = document.createElement("footer");
    footer.className = "is-right";

    if (this.#user) {
      const acceptButton = document.createElement("button");
      acceptButton.name = "discard";
      acceptButton.type = "submit";
      acceptButton.id = `success_${index}`;
      acceptButton.className = "button success";
      acceptButton.textContent = "Accept";
      footer.appendChild(acceptButton);

      const rejectButton = document.createElement("button");
      rejectButton.name = "train";
      rejectButton.type = "submit";
      rejectButton.id = `fail_${index}`;
      rejectButton.className = "button error";
      rejectButton.textContent = "Reject & Retrain";
      footer.appendChild(rejectButton);
    }

    form.appendChild(footer);
    imageBlock.appendChild(form);

    return imageBlock;
  }

  async loadContent(url) {
    const response = await fetch(url);
    return response.text();
  }

  async injectStatsContent() {
    const container = document.getElementById("images");
    if (!this.#statsHTML) {
      this.#statsHTML = await this.loadContent("static/stats.html");
    }
    container.innerHTML = this.#statsHTML;
  }

  async injectHelp() {
    const container = document.getElementById("images");
    if (!this.#helpHTML) {
      this.#helpHTML = await this.loadContent("static/help.html");
    }
    container.innerHTML = this.#helpHTML;
  }

  async injectCheck() {
    const container = document.getElementById("images");
    if (!this.#user) {
      container.innerHTML = "You need to be logged in to access this page";
      return;
    }
    try {
      const response = await fetch(
        `/get_images?batch=${this.#currentBatch}&batch_size=${this.#checkBatchSize}&tab=check&user_id=${this.#checkUser}`,
      );
      const data = await response.json();

      const image_ids = data.map((image) => image.image_id);
      const feedbackResponse = await fetch(
        "/feedback?image_ids=" + image_ids.join(","),
      );

      let feedbackData = await feedbackResponse.json();
      feedbackData = feedbackData.feedback;

      data.forEach((image) => {
        const feedback = feedbackData[image.image_id];
        if (feedback) {
          image.qa_feedback = feedback;
        } else {
          image.qa_feedback = "Click to edit";
        }
      });

      const div = document.createElement("div");
      div.id = "images";

      // create the form to change the user
      const form = document.createElement("form");
      const select = document.createElement("select");

      let userSelection;

      if (this.#user === "admin") {
        userSelection = this.#userList;
      } else {
        userSelection = [this.#user];
      }

      select.name = "user_id";

      userSelection.forEach((user) => {
        const option = document.createElement("option");
        option.value = user;
        option.textContent = user;
        if (user === this.#checkUser) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      form.appendChild(select);
      const input2 = document.createElement("input");
      input2.type = "hidden";
      input2.name = "tab";
      input2.value = "check";
      form.appendChild(input2);

      const input3 = document.createElement("input");
      input3.type = "hidden";
      input3.name = "batch";
      input3.value = "1";
      form.appendChild(input3);

      if (this.#user === "admin") {
        select.onchange = async () => {
          const newUserId = select.value;
          if (newUserId !== this.#checkUser) {
            this.#checkUser = newUserId;
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set("user_id", newUserId);
            window.history.pushState({}, "", newUrl);
            await this.injectCheck();
          }
        };
      }

      div.appendChild(form);

      // Create the table and its header
      const table = document.createElement("table");
      const header = table.createTHead();
      const headerRow = header.insertRow();

      const keys = [
        "image_id",
        "image_thumbnail_url",
        "result",
        "firefox_alt_text",
        "inclusive_alt_text",
        "rejection_reasons",
        "qa_feedback",
      ];

      const titles = {
        image_id: "ID",
        image_thumbnail_url: "Image",
        firefox_alt_text: "Firefox",
        inclusive_alt_text: "Corrected",
        result: "Accuracy",
        rejection_reasons: "Rejection reasons",
        verified_by: "Verified by",
        qa_feedback: "QA feedback",
      };

      keys.forEach((key) => {
        const th = document.createElement("th");
        th.textContent = titles[key];
        headerRow.appendChild(th);
      });

      // Create the table body
      const tbody = table.createTBody();

      data.forEach((image) => {
        const row = tbody.insertRow();

        keys.forEach((key) => {
          const cell = row.insertCell();

          if (key === "image_thumbnail_url") {
            // If the data is the image URL, create an img element
            const img = document.createElement("img");
            img.src = `/images/thumbnail/${image.image_id}.png`;
            img.alt = image.alt_text;
            img.className = "image";
            img.id = `thumbnail_${image.image_id}`;
            img.addEventListener("click", function() {
              const zoomedImage = document.createElement("div");
              zoomedImage.className = "zoomed-image";
              const zoomedImg = document.createElement("img");
              zoomedImg.src = `/images/${image.image_id}.png`;
              zoomedImg.className = "zoomed-img";
              zoomedImage.appendChild(zoomedImg);
              zoomedImage.addEventListener("click", function() {
                document.body.removeChild(zoomedImage);
              });

              document.body.appendChild(zoomedImage);
            });

            cell.appendChild(img);
          } else if (key === "rejection_reasons") {
            const ul = document.createElement("ul");
            // Create li elements for each item
            image[key].forEach((item) => {
              const li = document.createElement("li");
              li.textContent = item;
              ul.appendChild(li);
            });

            cell.appendChild(ul);
          } else if (key === "result") {
            if (image["verified"] === 1) {
              cell.textContent = "✅";
            } else if (image["need_training"] === 1) {
              cell.textContent = "❌";
            } else {
              cell.textContent = "❓";
            }
          } else if (key === "qa_feedback") {
            cell.textContent = image["qa_feedback"];
            if (cell.textContent === "Click to edit") {
              cell.style.backgroundColor = "#f0f0f0";
            } else {
              cell.style.backgroundColor = "white";
            }
            cell.style.padding = "5px";
            cell.title = "Click to edit";

            if (this.#user != "admin" && cell.textContent === "Click to edit") {
              cell.textContent = "";
              cell.style.backgroundColor = "white";
            }

            if (this.#user === "admin") {
              cell.contentEditable = true;
              cell.style.cursor = "pointer"; // Change cursor to pointer
              cell.addEventListener("keydown", async (event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const newFeedback = cell.textContent;
                  const payload = {
                    image_id: image.image_id,
                    qa_feedback: newFeedback,
                  };
                  try {
                    const response = await fetch("/submit_feedback", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify(payload),
                    });
                    if (response.ok) {
                      cell.blur();
                    } else {
                      console.error("Error submitting feedback");
                    }
                  } catch (error) {
                    console.error("Error submitting feedback", error);
                  }
                }
              });

              // Event listener for focus to clear the placeholder text and change background color
              cell.addEventListener("focus", () => {
                if (cell.textContent === "Click to edit") {
                  cell.textContent = "";
                }
                cell.style.backgroundColor = "white"; // Change background color to white
              });

              // Event listener for blur to restore placeholder text and change background color if empty
              cell.addEventListener("blur", () => {
                if (cell.textContent.trim() === "") {
                  cell.textContent = "Click to edit";
                  cell.style.backgroundColor = "#f0f0f0"; // Light background color if empty
                } else {
                  cell.style.backgroundColor = "white"; // Keep background color white if not empty
                }
              });
            }
          } else if (key === "firefox_alt_text") {
            cell.appendChild(
              this.displayCaption({
                captioner: "Firefox",
                image_id: image.image_id,
                create_header: false,
                //image_selector: `thumbnail_${image.image_id}`,
                image_url: `/images/${image.image_id}.png`,
              }),
            );
          } else {
            cell.textContent = image[key];
          }
        });
      });

      div.appendChild(table);
      container.replaceWith(div);
    } catch (error) {
      console.error("Error fetching and parsing data", error);
    }
  }
}
