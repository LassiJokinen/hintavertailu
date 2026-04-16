const { all, get, run, closeDb } = require("../src/db");
const { scrapeJimmsProduct } = require("../src/scrapers/jimms");
const { ensureOfferMaintenanceColumns } = require("../src/offer-maintenance");
const { calculateTotal, roundMoney } = require("../src/money");
const { linkOfferToCanonicalProduct } = require("../src/offer-linking");

const STORE = "jimms.fi";
const DEFAULT_SITEMAP_INDEX_URL = "https://www.jimms.fi/sitemap.xml";
const SITEMAP_CANDIDATE_URLS = [
  DEFAULT_SITEMAP_INDEX_URL,
  "https://www.jimms.fi/sitemap_index.xml",
  "https://www.jimms.fi/sitemapindex.xml",
  "https://www.jimms.fi/sitemap/SitemapIndex.xml",
];
const FALLBACK_STRUCTURED_SOURCES = [
  "https://www.jimms.fi/fi",
  "https://www.jimms.fi/fi/Product/List/000-0WN",
  "https://www.jimms.fi/fi/Product/List/000-0WH",
  "https://www.jimms.fi/fi/Product/List/000-17W",
];
const DEFAULT_MAX_SITEMAP_FILES = 10;
const DEFAULT_MAX_CATEGORY_PAGES = 30;
const DEFAULT_MAX_PAGINATION_DEPTH = 4;
const DEFAULT_MAX_PRODUCT_URLS = 200;
const DEFAULT_DELAY_MS = 250;
const HOMEPAGE_URL = "https://www.jimms.fi/fi";
const PRIORITY_CATEGORY_KEYWORDS = [
  "kannettava",
  "laptop",
  "apple",
  "mac",
  "emolevy",
  "motherboard",
  "prosessori",
  "cpu",
  "naytonohjain",
  "näytönohjain",
  "gpu",
  "ssd",
  "kiintolevy",
  "hard drive",
  "virtalahde",
  "virtalähde",
  "power supply",
  "kotelo",
  "case",
];

async function main() {
  try {
    const ready = await ensureOfferMaintenanceColumns();
    if (!ready) {
      throw new Error("offers table not found. Run `npm run init-db` first.");
    }

    const options = parseOptions(process.argv.slice(2));
    const existingUrls = await loadExistingUrls();
    const discovery = await discoverProductUrls(options, existingUrls);

    const summary = {
      discoverySource: discovery.source,
      sitemapFilesProcessed: discovery.sitemapFilesProcessed,
      categoryPagesProcessed: discovery.categoryPagesProcessed,
      paginationPagesProcessed: discovery.paginationPagesProcessed,
      productUrlsFound: discovery.productUrlsFound,
      newUrlsSaved: 0,
      productsScraped: 0,
      offersInserted: 0,
      offersUpdated: 0,
      linkedOffers: 0,
      failures: 0,
    };

    for (const url of discovery.urls) {
      try {
        const saved = await saveDiscoveredUrl(url);
        if (saved) {
          summary.newUrlsSaved += 1;
        }

        const product = await scrapeJimmsProduct(url);
        summary.productsScraped += 1;

        await upsertRawStoreProduct(product);
        const offerResult = await upsertOffer(product);
        if (offerResult.wasUpdated) {
          summary.offersUpdated += 1;
        } else {
          summary.offersInserted += 1;
        }

        const linkResult = await linkOfferToCanonicalProduct(offerResult.id);
        if (linkResult.linked) {
          summary.linkedOffers += 1;
        }
      } catch (error) {
        summary.failures += 1;
        console.log(`Failed for ${url}`);
        console.log(`  ${error.message}`);
      }

      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }

    console.log("Jimms discovery complete.");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Jimms discovery failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

function parseOptions(args) {
  const options = {
    sitemapIndexUrl: DEFAULT_SITEMAP_INDEX_URL,
    maxSitemapFiles: DEFAULT_MAX_SITEMAP_FILES,
    maxCategoryPages: DEFAULT_MAX_CATEGORY_PAGES,
    maxPaginationDepth: DEFAULT_MAX_PAGINATION_DEPTH,
    maxProductUrls: DEFAULT_MAX_PRODUCT_URLS,
    delayMs: DEFAULT_DELAY_MS,
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--sitemap-index-url" && args[index + 1]) {
      options.sitemapIndexUrl = args[index + 1];
      index += 1;
      continue;
    }

    if (current === "--max-sitemap-files" && args[index + 1]) {
      options.maxSitemapFiles = toPositiveInteger(args[index + 1], DEFAULT_MAX_SITEMAP_FILES);
      index += 1;
      continue;
    }

    if (current === "--max-product-urls" && args[index + 1]) {
      options.maxProductUrls = toPositiveInteger(args[index + 1], DEFAULT_MAX_PRODUCT_URLS);
      index += 1;
      continue;
    }

    if (current === "--max-category-pages" && args[index + 1]) {
      options.maxCategoryPages = toPositiveInteger(args[index + 1], DEFAULT_MAX_CATEGORY_PAGES);
      index += 1;
      continue;
    }

    if (current === "--max-pagination-depth" && args[index + 1]) {
      options.maxPaginationDepth = toPositiveInteger(args[index + 1], DEFAULT_MAX_PAGINATION_DEPTH);
      index += 1;
      continue;
    }

    if (current === "--delay-ms" && args[index + 1]) {
      options.delayMs = toPositiveInteger(args[index + 1], DEFAULT_DELAY_MS);
      index += 1;
      continue;
    }

    if (current.startsWith("--sitemap-index-url=")) {
      options.sitemapIndexUrl = current.split("=").slice(1).join("=") || DEFAULT_SITEMAP_INDEX_URL;
      continue;
    }

    if (current.startsWith("--max-sitemap-files=")) {
      options.maxSitemapFiles = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_SITEMAP_FILES);
      continue;
    }

    if (current.startsWith("--max-product-urls=")) {
      options.maxProductUrls = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_PRODUCT_URLS);
      continue;
    }

    if (current.startsWith("--max-category-pages=")) {
      options.maxCategoryPages = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_CATEGORY_PAGES);
      continue;
    }

    if (current.startsWith("--max-pagination-depth=")) {
      options.maxPaginationDepth = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_PAGINATION_DEPTH);
      continue;
    }

    if (current.startsWith("--delay-ms=")) {
      options.delayMs = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_DELAY_MS);
    }
  }

  return options;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

async function discoverProductUrls(options, existingUrls) {
  const sitemapDiscovery = await discoverFromSitemap(options, existingUrls);
  if (sitemapDiscovery.urls.length > 0) {
    return {
      source: "sitemap",
      sitemapFilesProcessed: sitemapDiscovery.sitemapFilesProcessed,
      categoryPagesProcessed: 0,
      paginationPagesProcessed: 0,
      productUrlsFound: sitemapDiscovery.productUrlsFound,
      urls: sitemapDiscovery.urls,
    };
  }

  console.log("No product URLs from sitemap, using structured fallback source.");
  const fallbackDiscovery = await discoverFromStructuredFallback(options, existingUrls);

  return {
    source: "structured-fallback",
    sitemapFilesProcessed: sitemapDiscovery.sitemapFilesProcessed,
    categoryPagesProcessed: fallbackDiscovery.categoryPagesProcessed,
    paginationPagesProcessed: fallbackDiscovery.paginationPagesProcessed,
    productUrlsFound: sitemapDiscovery.productUrlsFound + fallbackDiscovery.productUrlsFound,
    urls: fallbackDiscovery.urls,
  };
}

async function discoverFromSitemap(options, existingUrls) {
  const discovered = new Set();
  let sitemapFilesProcessed = 0;
  let productUrlsFound = 0;

  const sitemapSources = await loadSitemapSources(options);

  for (const sitemapUrl of sitemapSources) {
    if (discovered.size >= options.maxProductUrls) {
      break;
    }

    sitemapFilesProcessed += 1;
    console.log(`Scanning sitemap: ${sitemapUrl}`);

    try {
      const xml = await fetchText(sitemapUrl, options.delayMs);
      const urls = parseLocUrls(xml)
        .map((url) => normalizeUrl(url))
        .filter((url) => isRealProductUrl(url));

      for (const url of urls) {
        productUrlsFound += 1;

        if (discovered.size >= options.maxProductUrls) {
          break;
        }

        if (existingUrls.has(url)) {
          continue;
        }

        discovered.add(url);
        existingUrls.add(url);
      }
    } catch (error) {
      console.log(`  Skipped sitemap because it could not be read: ${error.message}`);
    }
  }

  return {
    sitemapFilesProcessed,
    productUrlsFound,
    urls: Array.from(discovered),
  };
}

async function loadSitemapSources(options) {
  const candidates = [options.sitemapIndexUrl, ...SITEMAP_CANDIDATE_URLS]
    .map((url) => String(url || "").trim())
    .filter(Boolean);

  const seen = new Set();

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeUrl(candidate) || normalizeAbsoluteUrl(candidate);
    const dedupeKey = normalizedCandidate || candidate;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);

    try {
      const xml = await fetchText(candidate, options.delayMs);
      const locUrls = parseLocUrls(xml)
        .map((url) => normalizeAbsoluteUrl(url))
        .filter(Boolean);

      if (isSitemapIndexXml(xml)) {
        return locUrls.slice(0, options.maxSitemapFiles);
      }

      if (isUrlSetXml(xml)) {
        return [normalizeAbsoluteUrl(candidate)].filter(Boolean).slice(0, options.maxSitemapFiles);
      }
    } catch (error) {
      // Try next candidate.
    }
  }

  return [];
}

function isSitemapIndexXml(xml) {
  return /<sitemapindex\b/i.test(xml);
}

function isUrlSetXml(xml) {
  return /<urlset\b/i.test(xml);
}

async function discoverFromStructuredFallback(options, existingUrls) {
  const discovered = new Set();
  let productUrlsFound = 0;
  let categoryPagesProcessed = 0;
  let paginationPagesProcessed = 0;

  const categoryQueue = await loadInitialCategoryQueue(options);
  const seenCategories = new Set(categoryQueue.map((entry) => entry.url));

  while (categoryQueue.length > 0) {
    if (discovered.size >= options.maxProductUrls) {
      break;
    }

    if (categoryPagesProcessed >= options.maxCategoryPages) {
      break;
    }

    const category = categoryQueue.shift();
    categoryPagesProcessed += 1;
    console.log(`Scanning category: ${category.url}`);

    try {
      const crawlResult = await crawlCategoryPages(category.url, options);
      paginationPagesProcessed += crawlResult.pagesProcessed;

      for (const url of crawlResult.productUrls) {
        productUrlsFound += 1;

        if (discovered.size >= options.maxProductUrls) {
          break;
        }

        if (existingUrls.has(url)) {
          continue;
        }

        discovered.add(url);
        existingUrls.add(url);
      }

      for (const linkedCategoryUrl of crawlResult.linkedCategoryUrls) {
        if (seenCategories.has(linkedCategoryUrl)) {
          continue;
        }

        if (seenCategories.size >= options.maxCategoryPages * 4) {
          break;
        }

        seenCategories.add(linkedCategoryUrl);
        categoryQueue.push({ url: linkedCategoryUrl, score: scoreCategory(linkedCategoryUrl, "") });
      }

      categoryQueue.sort((a, b) => b.score - a.score);
    } catch (error) {
      console.log(`  Skipped category because it could not be read: ${error.message}`);
    }
  }

  return {
    categoryPagesProcessed,
    paginationPagesProcessed,
    productUrlsFound,
    urls: Array.from(discovered),
  };
}

async function loadInitialCategoryQueue(options) {
  const byUrl = new Map();

  try {
    const html = await fetchText(HOMEPAGE_URL, options.delayMs);
    const menuCategories = extractMenuCategoryCandidates(html);

    for (const category of menuCategories) {
      const normalized = normalizeCategoryUrl(category.url);
      if (!normalized) {
        continue;
      }

      const score = scoreCategory(normalized, category.label || "");
      const existing = byUrl.get(normalized);
      if (!existing || score > existing.score) {
        byUrl.set(normalized, { url: normalized, score });
      }
    }
  } catch (error) {
    console.log(`Homepage menu discovery failed, using static category sources: ${error.message}`);
  }

  for (const fallbackUrl of FALLBACK_STRUCTURED_SOURCES) {
    const normalized = normalizeCategoryUrl(fallbackUrl);
    if (!normalized) {
      continue;
    }

    if (!byUrl.has(normalized)) {
      byUrl.set(normalized, { url: normalized, score: scoreCategory(normalized, "") });
    }
  }

  return Array.from(byUrl.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxCategoryPages * 2);
}

function extractMenuCategoryCandidates(html) {
  const results = [];

  const anchorPattern = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchorMatch;

  while ((anchorMatch = anchorPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((anchorMatch[1] || "").trim());
    if (!/\/fi\/Product\/List\//i.test(href)) {
      continue;
    }

    const label = cleanHtmlText(anchorMatch[2] || "");
    results.push({ url: href, label });
  }

  const jsonPattern = /"(?:url|href)"\s*:\s*"(\/fi\/Product\/List\/[^"\\]+)"(?:[^{}]{0,180}?"(?:name|title|label)"\s*:\s*"([^"\\]*)")?/gi;
  let jsonMatch;

  while ((jsonMatch = jsonPattern.exec(html)) !== null) {
    const href = decodeJsonLikeString(jsonMatch[1] || "");
    const label = decodeJsonLikeString(jsonMatch[2] || "");
    results.push({ url: href, label });
  }

  return results;
}

function scoreCategory(url, label) {
  const text = `${String(url || "")} ${String(label || "")}`.toLowerCase();
  let score = 0;

  for (const keyword of PRIORITY_CATEGORY_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      score += 10;
    }
  }

  // Prefer main category list pages over heavily filtered links.
  if (!text.includes("?fq=")) {
    score += 3;
  }

  if (text.includes("/fi/product/list/")) {
    score += 2;
  }

  return score;
}

async function crawlCategoryPages(categoryUrl, options) {
  const visitedPages = new Set();
  const queue = [{ url: categoryUrl, depth: 1 }];
  const productUrls = new Set();
  const linkedCategoryUrls = new Set();
  let pagesProcessed = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || !current.url) {
      continue;
    }

    if (current.depth > options.maxPaginationDepth) {
      continue;
    }

    if (visitedPages.has(current.url)) {
      continue;
    }

    visitedPages.add(current.url);
    pagesProcessed += 1;

    const html = await fetchText(current.url, options.delayMs);

    const pageProducts = extractProductUrlsFromHtml(html)
      .map((url) => normalizeUrl(url))
      .filter((url) => isRealProductUrl(url));

    for (const url of pageProducts) {
      productUrls.add(url);
    }

    const categoryLinks = extractCategoryLinksFromHtml(html)
      .map((url) => normalizeCategoryUrl(url))
      .filter(Boolean);

    for (const linkedCategoryUrl of categoryLinks) {
      linkedCategoryUrls.add(linkedCategoryUrl);
    }

    if (current.depth >= options.maxPaginationDepth) {
      continue;
    }

    const paginationUrls = extractPaginationUrls(html, current.url);
    const fallbackPagination = buildFallbackPaginationCandidates(current.url, current.depth + 1);
    const nextPages = [...paginationUrls, ...fallbackPagination]
      .map((url) => normalizeCategoryUrl(url))
      .filter(Boolean);

    for (const nextUrl of nextPages) {
      if (!visitedPages.has(nextUrl)) {
        queue.push({ url: nextUrl, depth: current.depth + 1 });
      }
    }
  }

  return {
    pagesProcessed,
    productUrls: Array.from(productUrls),
    linkedCategoryUrls: Array.from(linkedCategoryUrls),
  };
}

function extractCategoryLinksFromHtml(html) {
  const categoryUrls = new Set();
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((match[1] || "").trim());
    if (!href) {
      continue;
    }

    if (/\/fi\/Product\/List\//i.test(href)) {
      categoryUrls.add(href);
    }
  }

  return Array.from(categoryUrls);
}

function extractPaginationUrls(html, currentCategoryUrl) {
  const paginationUrls = new Set();
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  const current = normalizeCategoryUrl(currentCategoryUrl);

  if (!current) {
    return [];
  }

  const currentBaseKey = getCategoryBaseKey(current);
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((match[1] || "").trim());
    const normalized = normalizeCategoryUrl(href);
    if (!normalized) {
      continue;
    }

    if (getCategoryBaseKey(normalized) !== currentBaseKey) {
      continue;
    }

    if (looksLikePaginationUrl(normalized)) {
      paginationUrls.add(normalized);
    }
  }

  return Array.from(paginationUrls);
}

function buildFallbackPaginationCandidates(categoryUrl, pageNumber) {
  const base = normalizeCategoryUrl(categoryUrl);
  if (!base) {
    return [];
  }

  const urls = [];

  try {
    const pageUrl = new URL(base);
    pageUrl.searchParams.set("page", String(pageNumber));
    urls.push(pageUrl.toString());

    const pUrl = new URL(base);
    pUrl.searchParams.set("p", String(pageNumber));
    urls.push(pUrl.toString());
  } catch (error) {
    return [];
  }

  return urls;
}

function looksLikePaginationUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has("page") || parsed.searchParams.has("p") || parsed.searchParams.has("Page");
  } catch (error) {
    return false;
  }
}

function getCategoryBaseKey(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4) {
      return parsed.pathname.toLowerCase();
    }

    return `/${parts[0].toLowerCase()}/${parts[1].toLowerCase()}/${parts[2].toLowerCase()}/${parts[3].toLowerCase()}`;
  } catch (error) {
    return String(url || "").toLowerCase();
  }
}

function extractProductUrlsFromHtml(html) {
  const urls = new Set();

  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let hrefMatch;

  while ((hrefMatch = hrefPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((hrefMatch[1] || "").trim());
    if (!href) {
      continue;
    }

    if (/\/Product\/Show\/\d+/i.test(href)) {
      urls.add(href);
    }
  }

  const escapedPattern = /https?:\\\/\\\/www\.jimms\.fi\\\/(?:fi|FI)\\\/Product\\\/Show\\\/\d+[^"\\s<]*/g;
  let escapedMatch;

  while ((escapedMatch = escapedPattern.exec(html)) !== null) {
    const unescaped = escapedMatch[0]
      .replace(/\\\//g, "/")
      .replace(/\\u0026/g, "&");

    urls.add(unescaped);
  }

  return Array.from(urls);
}

async function fetchText(url, delayMs) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 PriceCompareSchoolProjectBot/1.0",
      accept: "application/xml,text/xml,text/html,application/xhtml+xml,application/json,text/plain",
    },
  });

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseLocUrls(xml) {
  const urls = [];
  const pattern = /<loc>([^<]+)<\/loc>/g;
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    const url = decodeXmlEntities(match[1].trim());
    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeJsonLikeString(value) {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }

  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch (error) {
    return raw
      .replace(/\\\//g, "/")
      .replace(/\\u0026/g, "&");
  }
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAbsoluteUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, "https://www.jimms.fi").toString();
  } catch (error) {
    return null;
  }
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, "https://www.jimms.fi");
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== STORE) {
      return null;
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const productIndex = pathParts.findIndex((part) => part.toLowerCase() === "product");
    if (productIndex < 0) {
      return null;
    }

    const showPart = pathParts[productIndex + 1] || "";
    const productId = pathParts[productIndex + 2] || "";
    if (showPart.toLowerCase() !== "show" || !/^\d+$/.test(productId)) {
      return null;
    }

    const tail = pathParts.slice(productIndex + 3).map((part) => encodeURIComponent(decodeURIComponent(part)));
    const normalizedPath = ["fi", "Product", "Show", productId, ...tail].join("/");

    return `https://www.jimms.fi/${normalizedPath}`;
  } catch (error) {
    return null;
  }
}

function normalizeCategoryUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, "https://www.jimms.fi");
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== STORE) {
      return null;
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length < 4) {
      return null;
    }

    if (pathParts[0].toLowerCase() !== "fi") {
      return null;
    }

    if (pathParts[1].toLowerCase() !== "product" || pathParts[2].toLowerCase() !== "list") {
      return null;
    }

    parsed.pathname = `/fi/Product/List/${pathParts.slice(3).join("/")}`;
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function isRealProductUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return /^\/fi\/Product\/Show\/\d+(?:\/[^/?#]+)*$/i.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function sleep(ms) {
  if (!ms || ms < 1) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadExistingUrls() {
  const rows = await all(
    `SELECT url
     FROM offers
     WHERE store = ? AND url IS NOT NULL AND url <> ''
     UNION
     SELECT url
     FROM raw_store_products
     WHERE store = ? AND url IS NOT NULL AND url <> ''`,
    [STORE, STORE]
  );

  return new Set(rows.map((row) => normalizeUrl(row.url)).filter(Boolean));
}

async function saveDiscoveredUrl(url) {
  const existing = await get(
    "SELECT id FROM raw_store_products WHERE store = ? AND url = ?",
    [STORE, url]
  );

  if (existing) {
    return false;
  }

  await run(
    `INSERT INTO raw_store_products (store, url, html, extracted_json)
     VALUES (?, ?, ?, ?)`,
    [STORE, url, null, null]
  );

  return true;
}

async function upsertRawStoreProduct(product) {
  const existing = await get(
    "SELECT id FROM raw_store_products WHERE store = ? AND url = ?",
    [product.store, product.url]
  );

  const extractedJson = JSON.stringify(product);

  if (existing) {
    await run(
      `UPDATE raw_store_products
       SET extracted_json = ?, fetched_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [extractedJson, existing.id]
    );
    return;
  }

  await run(
    `INSERT INTO raw_store_products (store, url, html, extracted_json)
     VALUES (?, ?, ?, ?)`,
    [product.store, product.url, null, extractedJson]
  );
}

async function upsertOffer(product) {
  const existing = await get(
    "SELECT id FROM offers WHERE store = ? AND url = ?",
    [product.store, product.url]
  );

  const shipping = Number(product.shipping || 0);
  const price = product.price === null ? null : Number(product.price);
  const total = product.total === null || product.total === undefined
    ? calculateTotal(price, shipping)
    : roundMoney(product.total);

  const params = [
    product.store,
    product.title || "",
    price,
    shipping,
    total,
    product.currency || "EUR",
    product.url,
    product.brand || "",
    product.model || "",
    product.sku || "",
    product.ean || "",
    product.mpn || "",
    product.inStock ? 1 : 0,
    1,
    0,
    null,
    null,
    null,
  ];

  if (existing) {
    await run(
      `UPDATE offers
       SET store = ?, title = ?, price = ?, shipping = ?, total = ?, currency = ?,
           url = ?, brand = ?, model = ?, sku = ?, ean = ?, mpn = ?, in_stock = ?,
           is_active = ?, retry_count = ?, last_error = ?, last_error_at = ?,
           last_status_code = ?, fetched_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...params, existing.id]
    );
    return { id: existing.id, wasUpdated: true };
  }

  const result = await run(
    `INSERT INTO offers (
      store, title, price, shipping, total, currency, url,
      brand, model, sku, ean, mpn, in_stock,
      is_active, retry_count, last_error, last_error_at, last_status_code
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );

  return { id: result.lastID, wasUpdated: false };
}

main();