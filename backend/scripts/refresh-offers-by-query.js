const { all, get, run, closeDb } = require("../src/db");
const { scrapeGiganttiProduct } = require("../src/scrapers/gigantti");
const { scrapeVerkkokauppaProduct } = require("../src/scrapers/verkkokauppa");
const { scrapePowerProduct } = require("../src/scrapers/power");
const { scrapeJimmsProduct } = require("../src/scrapers/jimms");
const { ensureOfferMaintenanceColumns, extractStatusCode } = require("../src/offer-maintenance");
const { calculateTotal, roundMoney } = require("../src/money");
const { linkOfferToCanonicalProduct } = require("../src/offer-linking");

const SCRAPERS = {
  "gigantti.fi": scrapeGiganttiProduct,
  "verkkokauppa.com": scrapeVerkkokauppaProduct,
  "power.fi": scrapePowerProduct,
  "jimms.fi": scrapeJimmsProduct,
};

const searchTerm = String(process.argv[2] || "").trim();
const maxRows = Number.parseInt(process.argv[3] || "50", 10);

if (!searchTerm) {
  console.error("Usage: node scripts/refresh-offers-by-query.js <search-term> [limit]");
  process.exit(1);
}

async function main() {
  const summary = { total: 0, refreshed: 0, failed: 0, skipped: 0 };

  try {
    const ready = await ensureOfferMaintenanceColumns();
    if (!ready) {
      throw new Error("offers table not found. Run `npm run init-db` first.");
    }

    const items = await loadOffersByTitle(searchTerm, Number.isNaN(maxRows) ? 50 : maxRows);
    summary.total = items.length;

    console.log(`Found ${items.length} offer(s) matching '${searchTerm}'.`);

    for (const item of items) {
      const normalizedStore = normalizeStore(item.store, item.url);
      const scraper = SCRAPERS[normalizedStore];

      if (!scraper) {
        summary.skipped += 1;
        continue;
      }

      try {
        console.log(`Refreshing [${normalizedStore}] ${item.url}`);
        const result = await scraper(item.url);
        await upsertRawStoreProduct(result);
        const upsertResult = await upsertOffer(result);
        await linkOfferToCanonicalProduct(upsertResult.id);
        summary.refreshed += 1;
      } catch (error) {
        summary.failed += 1;
        await recordOfferFailure(item.id, error, extractStatusCode(error));
      }
    }

    console.log("Query refresh complete.");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Query refresh failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

async function loadOffersByTitle(searchTerm, limit) {
  return all(
    `SELECT id, store, title, url
     FROM offers
     WHERE COALESCE(is_active, 1) = 1
       AND url IS NOT NULL
       AND url <> ''
       AND LOWER(title) LIKE LOWER(?)
     ORDER BY fetched_at DESC
     LIMIT ?`,
    [`%${searchTerm}%`, limit]
  );
}

async function recordOfferFailure(offerId, error, statusCode) {
  await run(
    `UPDATE offers
     SET retry_count = COALESCE(retry_count, 0) + 1,
         last_error = ?,
         last_error_at = CURRENT_TIMESTAMP,
         last_status_code = ?
     WHERE id = ?`,
    [error.message || "Unknown refresh failure", statusCode, offerId]
  );
}

function normalizeStore(store, url) {
  if (store) {
    return String(store).toLowerCase().replace(/^www\./, "");
  }

  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch (error) {
    return "";
  }
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