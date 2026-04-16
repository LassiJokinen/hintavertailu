const express = require("express");
const cors = require("cors");
const { scoreMatch, findMatches } = require("./matcher");
const { all } = require("./db");
const {
  normalizeProductLike,
  findBestMatchingProduct,
} = require("./canonical-products");

const app = express();
const PORT = 3000;

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

  // Ignore store-local numeric product IDs like "797281"
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
      const linkedOffers = await loadLinkedOffersFromDb(canonicalProduct.id);

      matches = linkedOffers
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
        })
        .filter((offer) => offer.matchScore >= 60)
        .sort((a, b) => b.matchScore - a.matchScore || a.total - b.total);
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
        store: match.store,
        title: match.title,
        price: match.price,
        shipping: match.shipping,
        total: match.total,
        currency: match.currency,
        url: match.url,
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

async function loadLinkedOffersFromDb(productId) {
  const rows = await all(
    `SELECT
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
      mpn
     FROM offers
     WHERE product_id = ?`,
    [productId]
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

async function loadOffersFromDb() {
  const rows = await all(
    `SELECT
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
      mpn
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