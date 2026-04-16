document.addEventListener("DOMContentLoaded", () => {
  startComparison();
});

function startComparison() {
  const status = document.getElementById("status");
  const results = document.getElementById("results");

  status.textContent = "Skannataan nykyistä sivua...";
  results.innerHTML = "";

  chrome.runtime.sendMessage(
    { type: "COMPARE_CURRENT_TAB" },
    (response) => {
      if (!response) {
        showError("Laajennus ei vastannut");
        return;
      }

      if (!response.success) {
        showError(response.error || "Tuntematon virhe");
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
    status.textContent = "Vastaavia tarjouksia ei löytynyt";
    results.innerHTML =
      `<div class="empty">Edullisempia tarjouksia ei löytynyt.</div>`;
    return;
  }

  status.innerHTML = `
    <span class="deal-icon">$</span>
    Löytyi ${matches.length} vastaavaa tarjousta
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

  function openOffer(match) {
    if (!match.url) {
      showError("Tuotteen linkkiä ei löytynyt");
      return;
    }

    chrome.tabs.create({ url: match.url });
  }

  document.querySelectorAll(".clickable-offer").forEach((card) => {
    card.addEventListener("click", () => {
      const index = Number(card.dataset.index);
      const match = matches[index];
      openOffer(match);
    });
  });

  document.querySelectorAll(".visit-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();

      const index = Number(button.dataset.index);
      const match = matches[index];
      openOffer(match);
    });
  });
}

function showError(message) {
  const status = document.getElementById("status");

  status.innerHTML = `
    <span class="error">${message}</span>
  `;
}