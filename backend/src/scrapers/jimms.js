const cheerio = require("cheerio");

const TITLE_SELECTORS = [
  "h1[itemprop='name']",
  ".product-name",
  "h1",
  "meta[property='og:title']",
];

const PRICE_SELECTORS = [
  "[itemprop='price']",
  "meta[property='product:price:amount']",
  ".product-price",
  ".price",
  "[data-price]",
];

const SHIPPING_SELECTORS = [
  "[data-testid='delivery-cost']",
  "[data-testid='shipping-cost']",
  "[data-testid*='delivery']",
  ".delivery-cost",
  ".shipping-cost",
  ".delivery-price",
];

const STOCK_SELECTORS = [
  "[data-testid*='availability']",
  "[data-testid*='stock']",
  "[itemprop='availability']",
  ".availability",
  ".stock-status",
];

async function scrapeJimmsProduct(url) {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");

  if (!hostname.includes("jimms.fi")) {
    throw new Error("scrapeJimmsProduct only supports jimms.fi URLs");
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 PriceCompareSchoolProjectBot/1.0",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Jimms request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const jsonLdProduct = extractJsonLdProduct($);

  const title = jsonLdProduct.title || extractText($, TITLE_SELECTORS) || "";
  const priceData = jsonLdProduct.price !== null
    ? { price: jsonLdProduct.price, currency: jsonLdProduct.currency || "EUR" }
    : extractPrice($, PRICE_SELECTORS);

  const shipping = jsonLdProduct.shipping !== null
    ? jsonLdProduct.shipping
    : extractShipping($, SHIPPING_SELECTORS);

  const total = priceData.price !== null
    ? Number((priceData.price + shipping).toFixed(2))
    : null;

  const identifiers = extractIdentifiers($);

  const inStock = typeof jsonLdProduct.inStock === "boolean"
    ? jsonLdProduct.inStock
    : extractInStock($, STOCK_SELECTORS);

  return {
    store: "jimms.fi",
    title,
    price: priceData.price,
    shipping,
    total,
    currency: priceData.currency || "EUR",
    url,
    brand: jsonLdProduct.brand || identifiers.brand,
    model: jsonLdProduct.model || identifiers.model,
    sku: jsonLdProduct.sku || identifiers.sku,
    ean: jsonLdProduct.ean || identifiers.ean,
    mpn: jsonLdProduct.mpn || identifiers.mpn,
    inStock,
  };
}

function extractText($, selectors) {
  for (const selector of selectors) {
    const value = ($(selector).first().attr("content") || $(selector).first().text() || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function extractPrice($, selectors) {
  for (const selector of selectors) {
    const element = $(selector).first();
    if (!element.length) {
      continue;
    }

    const text = (
      element.attr("content") ||
      element.attr("data-price") ||
      element.text() ||
      ""
    ).trim();

    const parsed = parsePrice(text);
    if (parsed.price !== null) {
      return parsed;
    }
  }

  return { price: null, currency: "EUR" };
}

function extractShipping($, selectors) {
  for (const selector of selectors) {
    const text = ($(selector).first().text() || "").trim();
    if (!text) {
      continue;
    }

    if (/free|ilmainen/i.test(text)) {
      return 0;
    }

    const parsed = parsePrice(text);
    if (parsed.price !== null) {
      return parsed.price;
    }
  }

  return 0;
}

function parsePrice(text) {
  if (!text) {
    return { price: null, currency: "EUR" };
  }

  const clean = text.replace(/\s+/g, " ").trim();
  const numberMatch = clean.match(/\d{1,3}(?:[\.\s]\d{3})*(?:[\.,]\d{1,2})?|\d+(?:[\.,]\d{1,2})?/);

  if (!numberMatch) {
    return { price: null, currency: detectCurrency(clean) };
  }

  const normalizedNumber = normalizePriceNumber(numberMatch[0]);
  const value = Number.parseFloat(normalizedNumber);

  if (Number.isNaN(value)) {
    return { price: null, currency: detectCurrency(clean) };
  }

  return {
    price: value,
    currency: detectCurrency(clean),
  };
}

function normalizePriceNumber(value) {
  const compact = value.replace(/\s/g, "");
  const hasComma = compact.includes(",");
  const hasDot = compact.includes(".");

  if (hasComma && hasDot) {
    const decimalSeparator = compact.lastIndexOf(",") > compact.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";

    return compact
      .split(thousandsSeparator)
      .join("")
      .replace(decimalSeparator, ".");
  }

  if (hasComma) {
    return compact.replace(",", ".");
  }

  return compact;
}

function detectCurrency(text) {
  if (text.includes("$") || /\bUSD\b/i.test(text)) {
    return "USD";
  }

  if (text.includes("£") || /\bGBP\b/i.test(text)) {
    return "GBP";
  }

  return "EUR";
}

function extractIdentifiers($) {
  const fields = {
    brand: [
      "[itemprop='brand']",
      "[data-brand]",
      "[data-testid*='brand']",
    ],
    model: [
      "[itemprop='model']",
      "[data-model]",
      "[data-testid*='model']",
    ],
    sku: [
      "[itemprop='sku']",
      "[data-sku]",
      "[data-testid*='sku']",
    ],
    mpn: [
      "[itemprop='mpn']",
      "[data-mpn]",
      "[data-testid*='mpn']",
    ],
    ean: [
      "[itemprop='gtin13']",
      "[itemprop='gtin']",
      "[data-ean]",
      "[data-testid*='ean']",
    ],
  };

  return {
    brand: extractText($, fields.brand),
    model: extractText($, fields.model),
    sku: extractText($, fields.sku),
    mpn: extractText($, fields.mpn),
    ean: extractText($, fields.ean),
  };
}

function extractInStock($, selectors) {
  for (const selector of selectors) {
    const value = (
      $(selector).first().attr("content") ||
      $(selector).first().text() ||
      ""
    ).toLowerCase();

    if (!value) {
      continue;
    }

    if (/instock|in stock|varastossa|available/.test(value)) {
      return true;
    }

    if (/outofstock|out of stock|loppu|ei saatavilla|unavailable/.test(value)) {
      return false;
    }
  }

  return false;
}

function extractJsonLdProduct($) {
  const scripts = $("script[type='application/ld+json']").toArray();

  for (const script of scripts) {
    const raw = $(script).html() || "";

    try {
      const parsed = JSON.parse(raw);
      const product = findProductObject(parsed);
      if (!product) {
        continue;
      }

      const offer = normalizeOffer(product.offers);
      const brandName = typeof product.brand === "string"
        ? product.brand
        : product.brand?.name || "";

      const priceData = parsePrice(String(offer.price || ""));
      const shippingData = parsePrice(String(offer.shipping || ""));

      return {
        title: product.name || "",
        brand: brandName,
        model: product.model || "",
        sku: product.sku || "",
        mpn: product.mpn || "",
        ean: product.gtin13 || product.gtin12 || product.gtin14 || product.gtin || "",
        price: priceData.price,
        currency: offer.currency || priceData.currency || "EUR",
        shipping: shippingData.price !== null ? shippingData.price : 0,
        inStock: availabilityToBoolean(offer.availability),
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
    ean: "",
    price: null,
    currency: "EUR",
    shipping: null,
    inStock: null,
  };
}

function findProductObject(candidate) {
  if (!candidate) {
    return null;
  }

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const found = findProductObject(item);
      if (found) {
        return found;
      }
    }

    return null;
  }

  if (typeof candidate !== "object") {
    return null;
  }

  if (isProductType(candidate["@type"])) {
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

function isProductType(typeValue) {
  if (Array.isArray(typeValue)) {
    return typeValue.some((item) => String(item).toLowerCase() === "product");
  }

  return String(typeValue || "").toLowerCase() === "product";
}

function normalizeOffer(offers) {
  if (!offers) {
    return { price: "", currency: "EUR", shipping: "", availability: "" };
  }

  const offer = Array.isArray(offers) ? offers[0] : offers;
  const shippingRate = offer.shippingDetails?.shippingRate;
  const shippingValue = typeof shippingRate === "object" ? shippingRate.value : shippingRate;

  return {
    price: offer.price || "",
    currency: offer.priceCurrency || "EUR",
    shipping: shippingValue || "",
    availability: offer.availability || "",
  };
}

function availabilityToBoolean(value) {
  const text = String(value || "").toLowerCase();

  if (!text) {
    return null;
  }

  if (text.includes("instock")) {
    return true;
  }

  if (text.includes("outofstock") || text.includes("soldout")) {
    return false;
  }

  return null;
}

module.exports = {
  scrapeJimmsProduct,
};
