const SUPPORTED_STORES = [
  "gigantti.fi",
  "verkkokauppa.com",
  "power.fi",
  "jimms.fi"
];

const SITE_ADAPTERS = {
  "gigantti.fi": {
    titleSelectors: [
      "[data-testid='product-name']",
      "h1[data-testid='product-title']",
      "h1"
    ],
    priceSelectors: [
      "[data-testid='price-current']",
      "[itemprop='price']",
      "[data-price]",
      ".price"
    ]
  },
  "verkkokauppa.com": {
    titleSelectors: [
      "h1[data-testid='product-name']",
      ".product__name",
      "h1"
    ],
    priceSelectors: [
      "[data-testid='price-current']",
      "[itemprop='price']",
      "[data-price]",
      ".price"
    ]
  },
  "power.fi": {
    titleSelectors: [
      "h1[data-testid='product-name']",
      ".pdp-product-title",
      "h1"
    ],
    priceSelectors: [
      "[data-testid='price-current']",
      "[itemprop='price']",
      "[data-price]",
      ".price"
    ]
  },
  "jimms.fi": {
    titleSelectors: [
      "h1[itemprop='name']",
      ".product-name",
      "h1"
    ],
    priceSelectors: [
      "[itemprop='price']",
      ".product-price",
      ".price",
      "[data-price]"
    ]
  }
};

function extractProductFromPage() {
  const hostname = normalizeHostname(window.location.hostname);
  const matchedStore = getSupportedStore(hostname);

  if (!matchedStore) {
    return buildUnsupportedPageResult(hostname);
  }

  const adapterResult = extractWithSiteAdapter(matchedStore);
  if (isValidProduct(adapterResult)) {
    return adapterResult;
  }

  const genericResult = extractWithGenericFallback(matchedStore);
  if (isValidProduct(genericResult)) {
    return genericResult;
  }

  return buildUnsupportedPageResult(matchedStore);
}

function extractWithSiteAdapter(store) {
  const adapter = SITE_ADAPTERS[store];
  const jsonLdProduct = extractJsonLdProduct();
  const title = extractText(adapter.titleSelectors) || jsonLdProduct.title || "";
  const priceData = extractPrice(adapter.priceSelectors);
  const identifiers = extractIdentifiers();

  return buildProductResult({
    title,
    price: priceData.price,
    currency: priceData.currency,
    store,
    brand: jsonLdProduct.brand || identifiers.brand,
    model: jsonLdProduct.model || identifiers.model,
    sku: jsonLdProduct.sku || identifiers.sku,
    mpn: jsonLdProduct.mpn || identifiers.mpn,
    ean: jsonLdProduct.ean || identifiers.ean
  });
}

function extractWithGenericFallback(store) {
  const jsonLdProduct = extractJsonLdProduct();
  const fallbackTitleSelectors = [
    "h1",
    "[itemprop='name']",
    "[data-testid='product-title']",
    ".product-title",
    ".product-name",
    "meta[property='og:title']"
  ];

  const fallbackPriceSelectors = [
    "[itemprop='price']",
    "meta[property='product:price:amount']",
    "[data-price]",
    ".product-price",
    ".price"
  ];

  const title = extractText(fallbackTitleSelectors) || jsonLdProduct.title || "";
  const priceData = extractPrice(fallbackPriceSelectors);
  const identifiers = extractIdentifiers();

  return buildProductResult({
    title,
    price: priceData.price,
    currency: priceData.currency,
    store,
    brand: jsonLdProduct.brand || identifiers.brand,
    model: jsonLdProduct.model || identifiers.model,
    sku: jsonLdProduct.sku || identifiers.sku,
    mpn: jsonLdProduct.mpn || identifiers.mpn,
    ean: jsonLdProduct.ean || identifiers.ean
  });
}

function extractText(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;

    const value =
      element.content ||
      element.getAttribute("content") ||
      element.innerText ||
      element.textContent ||
      "";

    if (value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function extractPrice(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;

    const value =
      element.content ||
      element.getAttribute("content") ||
      element.getAttribute("data-price") ||
      element.innerText ||
      element.textContent ||
      "";

    const parsed = parsePrice(value);
    if (parsed && parsed.price !== null) {
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

  const clean = text.toString().replace(/\s+/g, " ").trim();
  const numberMatch = clean.match(/(?:\d{1,3}(?:[\.,\s]\d{3})+|\d+)(?:[\.,]\d{1,2})?/);
  if (!numberMatch) return null;

  const rawNumber = numberMatch[0].replace(/\s/g, "");
  const normalizedNumber = normalizePriceNumber(rawNumber);
  const parsedValue = Number.parseFloat(normalizedNumber);

  if (Number.isNaN(parsedValue)) {
    return null;
  }

  return {
    price: parsedValue,
    currency: detectCurrency(clean)
  };
}

function normalizePriceNumber(value) {
  const compact = value.replace(/\s/g, "");
  const hasComma = compact.includes(",");
  const hasDot = compact.includes(".");

  if (!hasComma && !hasDot) {
    return compact;
  }

  if (hasComma && hasDot) {
    const decimalSeparator = compact.lastIndexOf(",") > compact.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";

    return compact
      .split(thousandsSeparator).join("")
      .replace(decimalSeparator, ".");
  }

  const separator = hasComma ? "," : ".";
  const parts = compact.split(separator);

  if (parts.length > 2) {
    return parts.join("");
  }

  if (parts.length === 2) {
    const fractionLength = parts[1].length;

    if (fractionLength === 3 || fractionLength === 0) {
      return parts.join("");
    }

    return `${parts[0]}.${parts[1]}`;
  }

  return compact;
}

function detectCurrency(text) {
  if (text.includes("$") || /\bUSD\b/i.test(text)) return "USD";
  if (text.includes("£") || /\bGBP\b/i.test(text)) return "GBP";
  if (text.includes("kr") || /\bSEK\b|\bNOK\b|\bDKK\b/i.test(text)) return "SEK";
  return "EUR";
}

function extractIdentifiers() {
  const fields = [
    ...Array.from(document.querySelectorAll("[itemprop='sku'], [data-sku], [data-testid*='sku']")),
    ...Array.from(document.querySelectorAll("[itemprop='mpn'], [data-mpn], [data-testid*='mpn']")),
    ...Array.from(document.querySelectorAll("[itemprop='gtin13'], [itemprop='gtin'], [data-ean], [data-testid*='ean']")),
    ...Array.from(document.querySelectorAll("[itemprop='brand'], [data-brand], [data-testid*='brand']")),
    ...Array.from(document.querySelectorAll("[data-model], [data-testid*='model']"))
  ];

  const result = {
    brand: "",
    model: "",
    sku: "",
    mpn: "",
    ean: ""
  };

  for (const element of fields) {
    const text = (element.content || element.getAttribute("content") || element.innerText || "").trim();
    if (!text) continue;

    const marker = (element.getAttribute("itemprop") || element.getAttribute("data-testid") || "").toLowerCase();

    if (!result.sku && marker.includes("sku")) result.sku = text;
    if (!result.mpn && marker.includes("mpn")) result.mpn = text;
    if (!result.ean && (marker.includes("gtin") || marker.includes("ean"))) result.ean = text;
    if (!result.brand && marker.includes("brand")) result.brand = text;
    if (!result.model && marker.includes("model")) result.model = text;
  }

  return result;
}

function extractJsonLdProduct() {
  const jsonLdScripts = Array.from(document.querySelectorAll("script[type='application/ld+json']"));

  for (const script of jsonLdScripts) {
    try {
      const parsed = JSON.parse(script.textContent || "null");
      const product = findProductObject(parsed);
      if (!product) continue;

      const brandName = typeof product.brand === "string"
        ? product.brand
        : product.brand?.name || "";

      return {
        title: product.name || "",
        brand: brandName,
        model: product.model || "",
        sku: product.sku || "",
        mpn: product.mpn || "",
        ean: product.gtin13 || product.gtin12 || product.gtin14 || product.gtin || ""
      };
    } catch (error) {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return {
    title: "",
    brand: "",
    model: "",
    sku: "",
    mpn: "",
    ean: ""
  };
}

function findProductObject(candidate) {
  if (!candidate) return null;

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const found = findProductObject(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof candidate !== "object") {
    return null;
  }

  if (candidate["@type"] === "Product") {
    return candidate;
  }

  if (Array.isArray(candidate["@graph"])) {
    return findProductObject(candidate["@graph"]);
  }

  if (candidate.mainEntity) {
    return findProductObject(candidate.mainEntity);
  }

  return null;
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function getSupportedStore(hostname) {
  return SUPPORTED_STORES.find((store) => hostname === store || hostname.endsWith(`.${store}`)) || "";
}

function isValidProduct(product) {
  return Boolean(product && product.title);
}

function buildProductResult(product) {
  return {
    supported: true,
    title: product.title || "",
    price: product.price,
    currency: product.currency || "EUR",
    url: window.location.href,
    store: product.store || normalizeHostname(window.location.hostname),
    brand: product.brand || "",
    model: product.model || "",
    sku: product.sku || "",
    mpn: product.mpn || "",
    ean: product.ean || ""
  };
}

function buildUnsupportedPageResult(storeOrHostname) {
  return {
    supported: false,
    message: "This page is not a supported product page yet. Try a product page on gigantti.fi, verkkokauppa.com, power.fi, or jimms.fi.",
    url: window.location.href,
    store: storeOrHostname || normalizeHostname(window.location.hostname)
  };
}

