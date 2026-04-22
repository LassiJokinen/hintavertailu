document.addEventListener("DOMContentLoaded", () => {
  startComparison();
});

function formatPrice(value, currency) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return `${value ?? "-"} ${currency || "EUR"}`;
  }

  const formatted = new Intl.NumberFormat("fi-FI", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numericValue);

  return `${formatted} ${currency || "EUR"}`;
}

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
  const currentPrice = data.queryProduct?.price;

  if (matches.length === 0) {
    status.textContent = "Vastaavia tarjouksia ei löytynyt";
    results.innerHTML =
      `<div class="empty">Edullisempia tarjouksia ei löytynyt.</div>`;
    return;
  }

  status.innerHTML = `
    <span class="deal-icon">$</span>
    Löytyi ${matches.length} vastaavaa tarjousta!
  `;

  const cheapest = matches.reduce((min, offer) =>
    offer.total < min.total ? offer : min
  , matches[0]);

  const isCurrentCheapest =
    typeof currentPrice === "number" &&
    currentPrice <= cheapest.total;

  let html = "";

  if (!isCurrentCheapest) {
    const logoUrl =
      `https://www.google.com/s2/favicons?domain=${cheapest.store}&sz=64`;

    const cheapestIndex = matches.indexOf(cheapest);

    html += `
      <div class="featured-offer clickable-offer" data-index="${cheapestIndex}">
        <div class="featured-text">Halvin tuote löydetty!</div>

        <div class="featured-inner">
          <div class="featured-content">
            <img class="store-logo" src="${logoUrl}" alt="${cheapest.store}">

            <div class="featured-center">
              <div class="featured-title">${cheapest.title}</div>
              <div class="featured-store">${cheapest.store}</div>
              <div class="featured-price">${formatPrice(cheapest.price, cheapest.currency)}</div>
            </div>

            <button class="visit-btn" data-index="${cheapestIndex}">
              ↗
            </button>
          </div>
        </div>
      </div>
    `;
  }

  matches.forEach((match, index) => {
    if (!isCurrentCheapest && match === cheapest) return;

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
            <div class="price">${formatPrice(match.price, match.currency)}</div>
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
      openOffer(matches[index]);
    });
  });

  document.querySelectorAll(".visit-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = Number(button.dataset.index);
      openOffer(matches[index]);
    });
  });
}

function showError(message) {
  const status = document.getElementById("status");

  status.innerHTML = `
    <span class="error">${message}</span>
  `;
}