const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// POST /compare endpoint
app.post('/compare', (req, res) => {
  const { title, price, currency, url, store, brand, model, sku } = req.body;

  // Hardcoded response matching the API contract
  const response = {
    matches: [
      {
        store: "Example Store",
        price: 19.99,
        currency: "USD",
        url: "https://example.com/product"
      }
    ]
  };

  res.json(response);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});