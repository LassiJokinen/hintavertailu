const express = require("express");
const cors = require("cors");
const { findMatches } = require("./matcher");
const { all } = require("./db");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Price compare backend is running" });
});

app.post("/compare", async (req, res) => {
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
    const offers = await loadOffersFromDb();
    const query = { title, price, currency, store, brand, model, sku, ean, mpn };
    const matches = findMatches(query, offers);

    res.json({
      queryProduct: { title, store, price, currency },
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
    total: row.total === null
      ? Number((Number(row.price || 0) + Number(row.shipping || 0)).toFixed(2))
      : Number(row.total),
  }));
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});