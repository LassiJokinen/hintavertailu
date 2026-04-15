const express = require("express");
const cors = require("cors");

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
    currency = "EUR",
    store = "",
  } = req.body || {};

  const response = {
    queryProduct: {
      title,
      store,
      price,
      currency,
    },
    matches: [
      {
        store: "shop-a.com",
        title: title || "Sample product match",
        price: 279.99,
        shipping: 0,
        total: 279.99,
        currency,
        url: "https://shop-a.com/sample-product",
        matchScore: 100,
        matchReason: "Dummy exact match",
      },
      {
        store: "shop-b.com",
        title: title || "Sample product match",
        price: 284.99,
        shipping: 4.99,
        total: 289.98,
        currency,
        url: "https://shop-b.com/sample-product",
        matchScore: 90,
        matchReason: "Dummy brand + model match",
      },
    ].filter((match) => match.store !== store),
  };

  res.json(response);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});