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
  "https://www.jimms.fi/fi/Product/List/000-0WH",
  "https://www.jimms.fi/fi/Product/List/000-17W",
];
const DEFAULT_MAX_SITEMAP_FILES = 10;
const DEFAULT_MAX_PRODUCT_URLS = 200;
const DEFAULT_DELAY_MS = 250;

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
      productUrlsFound: sitemapDiscovery.productUrlsFound,
      urls: sitemapDiscovery.urls,
    };
  }

  console.log("No product URLs from sitemap, using structured fallback source.");
  const fallbackDiscovery = await discoverFromStructuredFallback(options, existingUrls);

  return {
    source: "structured-fallback",
    sitemapFilesProcessed: sitemapDiscovery.sitemapFilesProcessed + fallbackDiscovery.sourceFilesProcessed,
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
  let sourceFilesProcessed = 0;
  let productUrlsFound = 0;

  const sourcePages = await loadStructuredSourcePages(options);

  for (const sourceUrl of sourcePages) {
    if (discovered.size >= options.maxProductUrls) {
      break;
    }

    sourceFilesProcessed += 1;
    console.log(`Scanning structured source: ${sourceUrl}`);

    try {
      const html = await fetchText(sourceUrl, options.delayMs);
      const urls = extractProductUrlsFromHtml(html)
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
      console.log(`  Skipped structured source because it could not be read: ${error.message}`);
    }
  }

  return {
    sourceFilesProcessed,
    productUrlsFound,
    urls: Array.from(discovered),
  };
}

async function loadStructuredSourcePages(options) {
  const pages = new Set();
  const homepageUrl = "https://www.jimms.fi/fi";

  pages.add(homepageUrl);

  try {
    const html = await fetchText(homepageUrl, options.delayMs);
    const categoryUrls = extractStructuredCategoryUrls(html)
      .map((url) => normalizeAbsoluteUrl(url))
      .filter(Boolean);

    for (const url of categoryUrls) {
      if (pages.size >= options.maxSitemapFiles) {
        break;
      }

      pages.add(url);
    }
  } catch (error) {
    // Use static fallback pages when homepage cannot be fetched.
  }

  for (const fallbackUrl of FALLBACK_STRUCTURED_SOURCES) {
    if (pages.size >= options.maxSitemapFiles) {
      break;
    }

    const normalized = normalizeAbsoluteUrl(fallbackUrl);
    if (normalized) {
      pages.add(normalized);
    }
  }

  return Array.from(pages).slice(0, options.maxSitemapFiles);
}

function extractStructuredCategoryUrls(html) {
  const urls = new Set();
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((match[1] || "").trim());
    if (!href) {
      continue;
    }

    if (/\/fi\/Product\/List\//i.test(href) || /\/fi\/ShopInShop\//i.test(href)) {
      urls.add(href);
    }
  }

  return Array.from(urls);
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