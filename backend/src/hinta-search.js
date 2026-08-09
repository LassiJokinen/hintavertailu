const cheerio = require("cheerio");
const { calculateTotal, roundMoney } = require("./money");

const HINTA_BASE_URL = "https://hinta.fi";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_RESULTS = 12;

const STORE_ALIASES = {
  "gigantti": "gigantti.fi",
  "power.fi": "power.fi",
  "verkkokauppa.com": "verkkokauppa.com",
  "jimm's pc-store": "jimms.fi",
  "jimms": "jimms.fi",
  "jimms.fi": "jimms.fi",
};

async function searchHintaOffers(query, options = {}) {
  const timeoutMs = toPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxResults = toPositiveInteger(options.maxResults, DEFAULT_MAX_RESULTS);
  const searches = buildHintaSearchQueries(query);
  const diagnostic = {
    source: "hinta.fi",
    status: "searched",
    searchPagesChecked: 0,
    productPagesChecked: 0,
    productUrl: "",
    offersFound: 0,
    failures: [],
  };

  if (!searches.length) {
    diagnostic.status = "skipped";
    diagnostic.failures.push("No search query available");
    return { offers: [], diagnostic };
  }

  for (const search of searches) {
    try {
      diagnostic.searchPagesChecked += 1;
      const productUrl = await findBestProductUrl(search, query, timeoutMs);
      if (!productUrl) {
        continue;
      }

      diagnostic.productUrl = productUrl;
      diagnostic.productPagesChecked += 1;
      const offers = await scrapeHintaProductOffers(productUrl, query, {
        timeoutMs,
        maxResults,
      });
      diagnostic.offersFound = offers.length;

      if (offers.length) {
        return { offers: [summarizeHintaOffers(offers, productUrl)], diagnostic };
      }
    } catch (error) {
      diagnostic.failures.push(`${search.value}: ${error.message}`);
    }
  }

  if (diagnostic.failures.length) {
    diagnostic.status = "partial-failure";
  }

  return { offers: [], diagnostic };
}

async function findBestProductUrl(search, query, timeoutMs) {
  const html = await fetchText(
    `${HINTA_BASE_URL}/haku?q=${encodeURIComponent(search.value)}`,
    timeoutMs
  );
  const candidates = parseSearchResults(html);

  if (!candidates.length) {
    return "";
  }

  if (search.type === "identifier") {
    return candidates[0].url;
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreProductCandidate(candidate, query),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.url || "";
}

function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const candidates = [];
  const seen = new Set();

  $("tr").each((index, row) => {
    const link = $(row)
      .find("a[href]")
      .toArray()
      .map((element) => $(element).attr("href"))
      .find((href) => /^\/\d+\//.test(href || "") && !/\/(?:tuotetiedot|historia)(?:$|[/?#])/.test(href));

    if (!link) {
      return;
    }

    const url = normalizeHintaUrl(link);
    if (!url || seen.has(url)) {
      return;
    }

    seen.add(url);
    candidates.push({
      index,
      url,
      title:
        cleanText($(row).find(".hv--name").first().text()) ||
        cleanText($(row).find(".hv-prt_product-a").first().text()) ||
        cleanText($(row).text()),
    });
  });

  return candidates;
}

async function scrapeHintaProductOffers(productUrl, query, options) {
  const html = await fetchText(productUrl, options.timeoutMs);
  const $ = cheerio.load(html);
  const hintaProductTitle = cleanText($("h1").first().text());
  const offers = [];

  $("tr").each((_, row) => {
    const storeCell = $(row).find(".hv--store").first();
    const productCell = $(row).find(".hv--product").first();
    const priceCell = $(row).find(".hv--price").first();
    const totalCell = $(row).find(".hv--price-total").first();

    if (!storeCell.length || !productCell.length || !priceCell.length) {
      return;
    }

    const storeName =
      cleanText(storeCell.find(".hv-visual-hide").first().text()) ||
      cleanStoreNameFromTitle(storeCell.find("a[title]").first().attr("title"));
    const title = cleanText(productCell.text());
    const price = parseMoney(priceCell.text());
    const total = parseMoney(totalCell.text());
    const deliveryTime = cleanText($(row).find(".hv--delivery-time").first().text());
    const country =
      cleanText($(row).find(".hv--dispatch .hv-visual-hide").first().text()) ||
      cleanDispatchCountry($(row).find(".hv--dispatch [title]").first().attr("title"));
    const href = $(row)
      .find("a[href]")
      .toArray()
      .map((element) => $(element).attr("href"))
      .find((value) => /kauppaan\.php/.test(value || ""));

    if (!storeName || !title || price === null) {
      return;
    }

    const resolvedTotal = total === null ? calculateTotal(price, 0) : total;
    const shipping = roundMoney(Math.max(0, resolvedTotal - price));

    offers.push({
      id: null,
      store: normalizeStoreName(storeName),
      displayStore: storeName,
      title,
      price,
      shipping,
      total: resolvedTotal,
      currency: query.currency || "EUR",
      url: productUrl,
      hintaShopUrl: href ? normalizeHintaUrl(href) : "",
      brand: query.brand || "",
      model: query.model || "",
      sku: "",
      ean: query.ean || "",
      mpn: query.mpn || "",
      fetched_at: new Date().toISOString(),
      matchScore: 95,
      matchReason: `Hinta.fi product group: ${hintaProductTitle}`,
      source: "hinta.fi",
      deliveryTime,
      country,
      hintaProductUrl: productUrl,
    });
  });

  return offers
    .filter((offer) => !query.store || offer.store !== query.store)
    .sort((a, b) => a.total - b.total)
    .slice(0, options.maxResults);
}

function summarizeHintaOffers(offers, productUrl) {
  const sorted = [...offers].sort((a, b) => a.total - b.total);
  const cheapest = sorted[0];
  const storeNames = sorted
    .slice(0, 3)
    .map((offer) => offer.displayStore || offer.store)
    .join(", ");

  return {
    ...cheapest,
    store: "hinta.fi",
    displayStore: "Hinta.fi",
    title: `Hintavertailu: ${cheapest.matchReason.replace(/^Hinta\.fi product group:\s*/, "")}`,
    url: productUrl,
    hintaProductUrl: productUrl,
    hintaShopUrl: "",
    matchReason: `Hinta.fi product page, ${offers.length} offer(s). Cheapest: ${storeNames}`,
  };
}

function buildHintaSearchQueries(query) {
  const identifiers = [query.ean, query.mpn]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const title = String(query.title || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ");

  const searches = [
    ...identifiers.map((value) => ({ type: "identifier", value })),
    { type: "title", value: title },
  ].filter((entry) => entry.value);

  const seen = new Set();
  return searches.filter((entry) => {
    const key = entry.value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function scoreProductCandidate(candidate, query) {
  const candidateTokens = tokenize(candidate.title);
  const queryTokens = tokenize(query.title);
  if (!candidateTokens.length || !queryTokens.length) {
    return 0;
  }

  let score = 0;
  for (const token of queryTokens) {
    if (candidateTokens.includes(token)) {
      score += isImportantToken(token) ? 4 : 2;
    }
  }

  const queryModels = queryTokens.filter(isImportantToken);
  const candidateModels = candidateTokens.filter(isImportantToken);
  if (queryModels.length && candidateModels.length) {
    const hasConflict = queryModels.some((token) => !candidateModels.includes(token));
    if (hasConflict) {
      score -= 12;
    }
  }

  return score;
}

function tokenize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(\d+)\s+([a-z]+)\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .filter((token) => !["the", "and", "with", "for"].includes(token));
}

function isImportantToken(token) {
  return /\d/.test(token) || /^(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(token);
}

function normalizeStoreName(value) {
  const normalized = cleanText(value).toLowerCase();
  return STORE_ALIASES[normalized] || normalized;
}

function cleanStoreNameFromTitle(value) {
  return cleanText(value).replace(/^Siirry kauppaan:\s*/i, "");
}

function cleanDispatchCountry(value) {
  return cleanText(value).replace(/^Lähetysmaa:\s*/i, "");
}

function normalizeHintaUrl(value) {
  try {
    const parsed = new URL(value, HINTA_BASE_URL);
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function parseMoney(value) {
  const text = cleanText(value);
  const match = text.match(/(?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:,\d{1,2})?/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[0].replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 PriceCompareSchoolProjectBot/1.0",
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  searchHintaOffers,
};
