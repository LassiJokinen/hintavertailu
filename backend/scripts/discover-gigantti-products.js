const { all, get, run, closeDb } = require("../src/db");
const { scrapeGiganttiProduct } = require("../src/scrapers/gigantti");
const { ensureOfferMaintenanceColumns } = require("../src/offer-maintenance");
const { calculateTotal, roundMoney } = require("../src/money");
const { linkOfferToCanonicalProduct } = require("../src/offer-linking");

const STORE = "gigantti.fi";
const DEFAULT_SITEMAP_INDEX_URL = "https://www.gigantti.fi/sitemaps/OCFIGIG.pdp.index.sitemap.xml";
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
      sitemapFilesProcessed: discovery.sitemapFilesProcessed,
      productUrlsFound: discovery.productUrlsFound,
      savedUrls: 0,
      scraped: 0,
      offersInserted: 0,
      offersUpdated: 0,
      linkedOffers: 0,
      failed: 0,
    };

    for (const url of discovery.urls) {
      try {
        const saved = await saveDiscoveredUrl(url);
        if (saved) {
          summary.savedUrls += 1;
        }

        const product = await scrapeGiganttiProduct(url);
        summary.scraped += 1;

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
        summary.failed += 1;
        console.log(`Failed for ${url}`);
        console.log(`  ${error.message}`);
      }
    }

    console.log("Gigantti discovery complete.");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Gigantti discovery failed:", error.message);
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
  const discovered = new Set();
  const sitemapUrls = await loadProductSitemapUrls(options.sitemapIndexUrl, options.maxSitemapFiles, options.delayMs);
  let productUrlsFound = 0;

  let sitemapFilesProcessed = 0;

  for (const sitemapUrl of sitemapUrls) {
    if (discovered.size >= options.maxProductUrls) {
      break;
    }

    sitemapFilesProcessed += 1;
    console.log(`Scanning sitemap: ${sitemapUrl}`);

    try {
      const xml = await fetchText(sitemapUrl, options.delayMs);
      const urls = parseLocUrls(xml)
        .filter((url) => url.includes("/product/"))
        .map((url) => normalizeUrl(url))
        .filter(Boolean);

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

async function loadProductSitemapUrls(sitemapIndexUrl, maxSitemapFiles, delayMs) {
  const xml = await fetchText(sitemapIndexUrl, delayMs);
  return parseLocUrls(xml).slice(0, maxSitemapFiles);
}

async function fetchText(url, delayMs) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 PriceCompareSchoolProjectBot/1.0",
      accept: "application/xml,text/xml,text/html,application/xhtml+xml",
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

function normalizeUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== STORE) {
      return null;
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch (error) {
    return null;
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
