const express = require("express");
const cors = require("cors");
const { findMatches } = require("./matcher");
const offers = require("../data/offers.json");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Price compare backend is running" });
});

app.post("/compare", (req, res) => {
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
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});