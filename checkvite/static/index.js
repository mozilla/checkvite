function taggedText(tag, text) {
  const captionDiv = document.createElement("div");
  captionDiv.innerHTML = `<span class='tag'>${tag}</span> ${text}`;
  return captionDiv;
}

function fetchCaption(captioner, dataset, image_id) {
  const apiUrl = `/infere/${captioner}/${dataset}/${image_id}`;

  return fetch(apiUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok: " + response.statusText);
      }
      return response.json();
    })
    .then((data) => {
      console.log(data);
      return data.text; // Return the text to the caller
    });
}

function displayCaption(captioner, dataset, image_id, idx, class_prefix = "") {
  // Create a new div element for the caption and set a loading message
  div = document.createElement("div");
  div.innerHTML = `<span class='tag'>${captioner}</span>&nbsp;<span class="loader"></span>`;
  div.id = `${class_prefix}caption${captioner}${image_id}`;

  fetchCaption(captioner, dataset, image_id)
    .then((text) => {
      console.log(text);
      const container = document.getElementById(
        `${class_prefix}caption${captioner}${image_id}`,
      );
      container.innerHTML = `<span class='tag'>${captioner}</span> ${text}`;

      const input = document.getElementById(`${class_prefix}caption${idx}`);
      input.value = text;
    })
    .catch((error) => {
      console.log(error);
      // Handle errors and update the div to show the error message
      const err = "Failed to load caption: " + error.message;
      const container = document.getElementById(
        `${class_prefix}caption${captioner}${image_id}`,
      );
      container.innerHTML = `<span class='tag'>${captioner}</span> ${err}`;
    });
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

    const humanCaption = taggedText("Human", imageData.caption);
    captionDiv.appendChild(humanCaption);

    imageBlock.appendChild(captionDiv);
    container.insertBefore(imageBlock, container.firstChild);

    container.insertBefore(img, container.firstChild);

    document.getElementById(`image_id${index + 1}`).value = imageData.image_id;
    document.getElementById(`dataset${index + 1}`).value = imageData.dataset;
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
      displayCaption("large", imageData.dataset, imageData.image_id),
    );
    */

    captionContainer.appendChild(
      displayCaption("pdf", imageData.dataset, imageData.image_id, index + 1),
    );
  });
}

async function fetchAdversarialImages() {
  const response = await fetch("/get_adversarial_images");
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

    const humanCaption = taggedText("Human", imageData.caption);
    captionDiv.appendChild(humanCaption);

    imageBlock.appendChild(captionDiv);
    container.insertBefore(imageBlock, container.firstChild);

    container.insertBefore(img, container.firstChild);

    document.getElementById(`a_image_id${index + 1}`).value =
      imageData.image_id;
    document.getElementById(`a_dataset${index + 1}`).value = imageData.dataset;
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
      displayCaption("large", imageData.dataset, imageData.image_id),
    );
    */

    captionContainer.appendChild(
      displayCaption(
        "pdf",
        imageData.dataset,
        imageData.image_id,
        index + 1,
        "a_",
      ),
    );
  });
}

fetchImages();
fetchAdversarialImages();

function openTab(evt, tabName) {
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
