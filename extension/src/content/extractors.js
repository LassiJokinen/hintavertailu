function extractProductFromPage() {
  const title = extractTitle();
  const priceData = extractPrice();

  return {
    title,
    price: priceData.price,
    currency: priceData.currency,
    url: window.location.href,
    store: window.location.hostname
  };
}

function extractTitle() {
  const selectors = [
    "h1",
    "[itemprop='name']",
    ".product-title",
    ".product-name",
    "[data-testid='product-title']"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (element && element.innerText.trim()) {
      return element.innerText.trim();
    }
  }

  return document.title || "Unknown Product";
}

function extractPrice() {
  const selectors = [
    "[itemprop='price']",
    ".price",
    ".product-price",
    "[data-price]",
    ".a-price .a-offscreen"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (!element) continue;

    const text =
      element.content ||
      element.getAttribute("data-price") ||
      element.innerText;

    const parsed = parsePrice(text);

    if (parsed) {
      return parsed;
    }
  }

  return {
    price: null,
    currency: "EUR"
  };
}

function parsePrice(text) {
  if (!text) return null;

  const cleanText = text.replace(/\s/g, "");

  const match = cleanText.match(/(\d+[.,]?\d*)/);

  if (!match) return null;

  const price = parseFloat(match[1].replace(",", "."));

  let currency = "EUR";

  if (cleanText.includes("$")) currency = "USD";
  if (cleanText.includes("£")) currency = "GBP";
  if (cleanText.includes("€")) currency = "EUR";

  return {
    price,
    currency
  };
}