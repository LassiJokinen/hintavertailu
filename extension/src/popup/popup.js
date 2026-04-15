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

  results.innerHTML = matches
    .map(
      (match) => `
        <div class="result-card">
          <strong>${match.store}</strong><br>
          ${match.title}<br>
          <strong>${match.price} ${match.currency}</strong>
        </div>
      `
    )
    .join("");
}

function showError(message) {
  const status = document.getElementById("status");
  status.innerHTML = `<span class="error">${message}</span>`;
}