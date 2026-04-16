document.addEventListener("DOMContentLoaded", () => {
  startComparison();
});

function startComparison() {
  const status = document.getElementById("status");
  const results = document.getElementById("results");

  status.textContent = "Scanning current page...";
  results.innerHTML = "";

  chrome.runtime.sendMessage(
    { type: "COMPARE_CURRENT_TAB" },
    (response) => {
      if (!response) {
        showError("No response from extension");
        return;
      }

      if (!response.success) {
        showError(response.error || "Unknown error");
        return;
      }

      renderResults(response.data);
    }
  );
}

function renderResults(data) {
  const status = document.getElementById("status");
  const results = document.getElementById("results");

  const matches = data.matches || [];

  if (matches.length === 0) {
    status.textContent = "No matching offers found";
    results.innerHTML =
      `<div class="empty">No cheaper offers available.</div>`;
    return;
  }

  status.innerHTML = `
    <span class="deal-icon">$</span>
    Found ${matches.length} matching offers
  `;

  let html = "";

  matches.forEach((match, index) => {
    const logoUrl =
      `https://www.google.com/s2/favicons?domain=${match.store}&sz=64`;

    html += `
  <div class="result-card clickable-offer" data-index="${index}">
    <div class="offer-inner">
      <div class="result-left">
        <img class="store-logo" src="${logoUrl}" alt="${match.store}">
      </div>

      <div class="result-center">
        <div class="product-title">${match.title}</div>
        <div class="store-name">${match.store}</div>
        <div class="price">${match.price} ${match.currency}</div>
      </div>

      <div class="result-right">
        <button class="visit-btn" data-index="${index}">
          ↗
        </button>
      </div>
    </div>
  </div>
`;
  });

  results.innerHTML = html;

  document.querySelectorAll(".clickable-offer").forEach((card) => {
    card.addEventListener("click", () => {
      const index = Number(card.dataset.index);
      const match = matches[index];

      const searchUrl = buildStoreSearchUrl(
        match.store,
        match.title
      );

      if (searchUrl) {
        chrome.tabs.create({ url: searchUrl });
      }
    });
  });

  document.querySelectorAll(".visit-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();

      const index = Number(button.dataset.index);
      const match = matches[index];

      const searchUrl = buildStoreSearchUrl(
        match.store,
        match.title
      );

      if (searchUrl) {
        chrome.tabs.create({ url: searchUrl });
      }
    });
  });
}

function buildStoreSearchUrl(store, title) {
  const query = encodeURIComponent(title);

  if (store.includes("gigantti")) {
    return `https://www.gigantti.fi/search?q=${query}`;
  }

  if (store.includes("verkkokauppa")) {
    return `https://www.verkkokauppa.com/fi/search?query=${query}`;
  }

  if (store.includes("jimms")) {
    return `https://www.jimms.fi/fi/Product/Search?q=${query}`;
  }

  return `https://${store}/search?q=${query}`;
}

function showError(message) {
  const status = document.getElementById("status");

  status.innerHTML = `
    <span class="error">${message}</span>
  `;
}