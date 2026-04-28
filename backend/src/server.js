const express = require("express");
const cors = require("cors");
const { scoreMatch, findMatches } = require("./matcher");
const { all, get, run } = require("./db");
const {
  normalizeProductLike,
  findBestMatchingProduct,
} = require("./canonical-products");
const { scrapeGiganttiProduct } = require("./scrapers/gigantti");
const { scrapeVerkkokauppaProduct } = require("./scrapers/verkkokauppa");
const { scrapePowerProduct } = require("./scrapers/power");
const { scrapeJimmsProduct } = require("./scrapers/jimms");
const { ensureOfferMaintenanceColumns, extractStatusCode } = require("./offer-maintenance");
const { calculateTotal, roundMoney } = require("./money");
const { linkOfferToCanonicalProduct } = require("./offer-linking");

const app = express();
const PORT = 3000;
const MAX_BACKGROUND_REFRESHES = 3;
const OFFER_REFRESH_WINDOW_MS = 12 * 60 * 60 * 1000;

const SCRAPERS = {
  "gigantti.fi": scrapeGiganttiProduct,
  "verkkokauppa.com": scrapeVerkkokauppaProduct,
  "power.fi": scrapePowerProduct,
  "jimms.fi": scrapeJimmsProduct,
};

app.use(cors());
app.use(express.json());

function firstValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function normalizeInputString(value) {
  return String(firstValue(value)).trim();
}

function normalizeInputSku(value) {
  const normalized = normalizeInputString(value);

  
  if (/^\d+$/.test(normalized)) {
    return "";
  }

  return normalized;
}

function normalizeInputPrice(value) {
  const normalized = firstValue(value);

  if (normalized === null || normalized === undefined || normalized === "") {
    return null;
  }

  const parsed = Number.parseFloat(String(normalized).replace(",", "."));
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeEanForLookup(value) {
  const normalized = normalizeInputString(value);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/\D/g, "").replace(/^0+/, "");
}

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Price compare backend is running" });
});

app.post("/compare", async (req, res) => {
  console.log("COMPARE BODY:", req.body);

  const {
    title = "",
    price = null,
    currency = "",
    store = "",
    brand = "",
    model = "",
    sku = "",
    ean = "",
    mpn = "",
  } = req.body || {};

  try {
    const query = {
      title: normalizeInputString(title),
      price: normalizeInputPrice(price),
      currency: normalizeInputString(currency),
      store: normalizeInputString(store),
      brand: normalizeInputString(brand),
      model: normalizeInputString(model),
      sku: normalizeInputSku(sku),
      ean: normalizeInputString(ean),
      mpn: normalizeInputString(mpn),
    };

    const canonicalProduct = await findBestCanonicalProduct(query);
    console.log("CANONICAL PRODUCT:", canonicalProduct);

    let matches = [];

    if (canonicalProduct) {
      const linkedOffers = await loadLinkedOffersFromDb(canonicalProduct);
      console.log(
        "CANONICAL CANDIDATE OFFERS:",
        linkedOffers.map((offer) => ({
          store: offer.store,
          title: offer.title,
          ean: offer.ean,
          product_id: offer.product_id,
        }))
      );

      const scoredOffers = linkedOffers
        .filter((offer) => !query.store || offer.store !== query.store)
        .filter(
          (offer) =>
            !query.currency || !offer.currency || offer.currency === query.currency
        )
        .map((offer) => {
          const { score, reason } = scoreMatch(query, offer);

          return {
            ...offer,
            matchScore: score,
            matchReason: reason,
          };
        });

      console.log(
        "CANONICAL SCORED OFFERS:",
        scoredOffers.map((offer) => ({
          store: offer.store,
          title: offer.title,
          ean: offer.ean,
          matchScore: offer.matchScore,
          matchReason: offer.matchReason,
        }))
      );

      matches = scoredOffers
        .filter((offer) => offer.matchScore >= 60)
        .sort((a, b) => b.matchScore - a.matchScore || a.total - b.total);

      console.log(
        "CANONICAL FINAL OFFERS:",
        matches.map((offer) => ({
          store: offer.store,
          title: offer.title,
          ean: offer.ean,
          matchScore: offer.matchScore,
          matchReason: offer.matchReason,
        }))
      );
    } else {
      const offers = await loadOffersFromDb();
      matches = findMatches(query, offers);
      console.log("FALLBACK MATCHES:", matches.length, matches);
    }

    res.json({
      queryProduct: {
        title: query.title,
        store: query.store,
        price: query.price,
        currency: query.currency,
      },
      matches: matches.map((match) => ({
        id: match.id,
        store: match.store,
        title: match.title,
        price: match.price,
        shipping: match.shipping,
        total: match.total,
        currency: match.currency,
        url: match.url,
        fetchedAt: match.fetched_at,
        matchScore: match.matchScore,
        matchReason: match.matchReason,
      })),
    });
  } catch (error) {
    console.error("/compare failed:", error);
    res.status(500).json({
      error: "Failed to compare offers",
    });
  }
});

app.post("/refresh-matches", async (req, res) => {
  const matches = Array.isArray(req.body?.matches) ? req.body.matches : [];
  const limitInput = Number.parseInt(req.body?.limit || String(MAX_BACKGROUND_REFRESHES), 10);
  const limit = Number.isNaN(limitInput)
    ? MAX_BACKGROUND_REFRESHES
    : Math.max(1, Math.min(limitInput, MAX_BACKGROUND_REFRESHES));

  try {
    console.log(`/refresh-matches called: matches=${matches.length} limit=${limit}`);
    const ready = await ensureOfferMaintenanceColumns();
    if (!ready) {
      throw new Error("offers table not found. Run `npm run init-db` first.");
    }

    const refreshed = [];

    for (const match of matches.slice(0, limit)) {
      if (!match?.url) {
        continue;
      }

      console.log(`Starting background refresh for: ${match.url}`);
      const result = await refreshOfferByUrl(match.url);
      refreshed.push(result);
      console.log(`Refresh result for ${match.url}: ${JSON.stringify(result)}`);
    }

    res.json({ ok: true, refreshed });
  } catch (error) {
    console.error("/refresh-matches failed:", error);
    res.status(500).json({
      error: "Failed to refresh matched offers",
    });
  }
});

async function findBestCanonicalProduct(query) {
  const products = await all(
    `SELECT id, title, brand, model, sku, ean, mpn
     FROM products`
  );

  if (!products.length) {
    return null;
  }

  const normalizedProducts = products.map(normalizeProductLike);
  const normalizedQuery = normalizeProductLike(query);
  const bestMatch = findBestMatchingProduct(normalizedQuery, normalizedProducts);

  return bestMatch ? bestMatch.product : null;
}

async function loadLinkedOffersFromDb(canonicalProduct) {
  const normalizedCanonicalEan = normalizeEanForLookup(canonicalProduct.ean);

  const rows = await all(
    `SELECT
      id,
      product_id,
      store,
      title,
      price,
      shipping,
      total,
      currency,
      url,
      brand,
      model,
      sku,
      ean,
      mpn,
      fetched_at
     FROM offers
     WHERE product_id = ?
        OR (
          ? <> ''
          AND LTRIM(REPLACE(IFNULL(ean, ''), ' ', ''), '0') = ?
        )`,
    [canonicalProduct.id, normalizedCanonicalEan, normalizedCanonicalEan]
  );

  return rows.map((row) => ({
    ...row,
    price: row.price === null ? null : Number(row.price),
    shipping: Number(row.shipping || 0),
    total:
      row.total === null
        ? Number((Number(row.price || 0) + Number(row.shipping || 0)).toFixed(2))
        : Number(row.total),
  }));
}

async function refreshOfferByUrl(url) {
  const existing = await get(
    `SELECT id, store, url, fetched_at, retry_count, last_status_code
     FROM offers
     WHERE url = ?`,
    [url]
  );

  if (!existing) {
    console.log(`No existing offer found for URL: ${url}`);
    return { url, status: "missing" };
  }

  if (!shouldRefreshOffer(existing)) {
    console.log(`Skipping refresh for ${url} (recently fetched)`);
    return { url, status: "skipped", reason: "fresh" };
  }

  const normalizedStore = normalizeStore(existing.store, existing.url);
  const scraper = SCRAPERS[normalizedStore];

  if (!scraper) {
    console.log(`No scraper for store '${normalizedStore}' (url: ${url})`);
    return { url, status: "skipped", reason: "unsupported-store" };
  }

  try {
    console.log(`Refreshing offer id=${existing.id} url=${existing.url}`);
    const product = await scraper(existing.url);
    await upsertRawStoreProduct(product);
    const upsertResult = await upsertOffer(product);
    await linkOfferToCanonicalProduct(upsertResult.id);

    console.log(`Successfully refreshed offer id=${upsertResult.id} url=${existing.url}`);
    return {
      url,
      status: "refreshed",
      offerId: upsertResult.id,
      wasUpdated: upsertResult.wasUpdated,
    };
  } catch (error) {
    const statusCode = extractStatusCode(error);

    console.error(`Refresh failed for url=${url} error=${error.message}`);
    await recordOfferFailure(existing.id, error, statusCode);

    return {
      url,
      status: "failed",
      statusCode,
      error: error.message || "Unknown refresh failure",
    };
  }
}

function shouldRefreshOffer(offer) {
  if (Number(offer.retry_count || 0) > 0) {
    return true;
  }

  if (offer.last_status_code) {
    return true;
  }

  if (!offer.fetched_at) {
    return true;
  }

  const fetchedAtMs = Date.parse(offer.fetched_at);
  if (Number.isNaN(fetchedAtMs)) {
    return true;
  }

  return Date.now() - fetchedAtMs >= OFFER_REFRESH_WINDOW_MS;
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

async function loadOffersFromDb() {
  const rows = await all(
    `SELECT
      id,
      store,
      title,
      price,
      shipping,
      total,
      currency,
      url,
      brand,
      model,
      sku,
      ean,
      mpn,
      fetched_at
     FROM offers`
  );

  return rows.map((row) => ({
    ...row,
    price: row.price === null ? null : Number(row.price),
    shipping: Number(row.shipping || 0),
    total:
      row.total === null
        ? Number((Number(row.price || 0) + Number(row.shipping || 0)).toFixed(2))
        : Number(row.total),
  }));
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});