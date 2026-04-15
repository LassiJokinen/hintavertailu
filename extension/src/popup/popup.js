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
    results.innerHTML = `<div class="empty">No cheaper offers available.</div>`;
    return;
  }

  status.textContent = `Found ${matches.length} matching offers`;

  let html = "";

  matches.forEach((match) => {
    const logoUrl = `https://www.google.com/s2/favicons?domain=${match.store}&sz=64`;

    html += `
      <div class="result-card">
        <div class="result-left">
          <img class="store-logo" src="${logoUrl}" alt="${match.store}">
        </div>

        <div class="result-center">
          <div class="product-title">${match.title}</div>
          <div class="store-name">${match.store}</div>
          <div class="price">${match.price} ${match.currency}</div>
        </div>

        <div class="result-right">
          <button class="visit-btn" data-url="${match.url}">
            ↗
          </button>
        </div>
      </div>
    `;
  });

  results.innerHTML = html;

  document.querySelectorAll(".visit-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const url = button.dataset.url;

      if (url) {
        chrome.tabs.create({ url });
      }
    });
  });
}

function showError(message) {
  const status = document.getElementById("status");
  status.innerHTML = `<span class="error">${message}</span>`;
}