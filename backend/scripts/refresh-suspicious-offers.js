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

const DEFAULT_RATIO = 0.25;
const DEFAULT_MIN_SECOND_PRICE = 50;

const ratio = Number.parseFloat(process.argv[2] || String(DEFAULT_RATIO));
const minSecondPrice = Number.parseFloat(process.argv[3] || String(DEFAULT_MIN_SECOND_PRICE));
const limit = Number.parseInt(process.argv[4] || "200", 10);

async function main() {
  const summary = {
    total: 0,
    refreshed: 0,
    failed: 0,
  };

  try {
    const ready = await ensureOfferMaintenanceColumns();
    if (!ready) {
      throw new Error("offers table not found. Run `npm run init-db` first.");
    }

    const candidates = await loadSuspiciousOffers(ratio, minSecondPrice, limit);
    summary.total = candidates.length;

    console.log(
      `Found ${candidates.length} suspicious low-price offer(s) using ratio < ${ratio} and second_price >= ${minSecondPrice}.`
    );

    for (const item of candidates) {
      const normalizedStore = normalizeStore(item.store, item.url);
      const scraper = SCRAPERS[normalizedStore];

      if (!scraper) {
        summary.failed += 1;
        console.log(`Skipping unsupported store: ${item.store} (${item.url})`);
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
        const statusCode = extractStatusCode(error);

        if (statusCode === 404) {
          console.log(`404 NOT FOUND [${normalizedStore}] ${item.url}`);
        }

        await recordOfferFailure(item.id, error, statusCode);
        console.log(`Failed [${normalizedStore}] ${item.url}`);
        console.log(`  ${error.message}`);
      }
    }

    console.log("Targeted refresh complete.");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Targeted refresh failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

async function loadSuspiciousOffers(ratio, minSecondPrice, limit) {
  return all(
    `WITH ranked AS (
       SELECT
         id, product_id, store, title, price, shipping, total, url,
         ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY price ASC, id ASC) AS rn,
         COUNT(*) OVER (PARTITION BY product_id) AS cnt
       FROM offers
       WHERE product_id IS NOT NULL
         AND price IS NOT NULL
         AND url IS NOT NULL
         AND url <> ''
         AND COALESCE(is_active, 1) = 1
     ), bounds AS (
       SELECT product_id,
              MAX(CASE WHEN rn = 1 THEN price END) AS min_price,
              MAX(CASE WHEN rn = 2 THEN price END) AS second_price,
              MAX(cnt) AS cnt
       FROM ranked
       GROUP BY product_id
     )
     SELECT r.id, r.store, r.url, r.title, r.price, b.second_price, b.cnt
     FROM ranked r
     JOIN bounds b ON b.product_id = r.product_id
     WHERE r.rn = 1
       AND b.cnt >= 2
       AND b.second_price IS NOT NULL
       AND b.second_price >= ?
       AND r.price < (b.second_price * ?)
     ORDER BY b.second_price DESC, r.price ASC
     LIMIT ?`,
    [minSecondPrice, ratio, limit]
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
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
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