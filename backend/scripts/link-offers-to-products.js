const { all, get, run, closeDb } = require("../src/db");
const {
  findBestMatchingProduct,
  normalizeProductLike,
  buildCanonicalProductFromOffer,
} = require("../src/canonical-products");

async function main() {
  try {
    const offers = await loadOffers();
    const products = (await loadProducts()).map(normalizeProductLike);

    const summary = {
      offersProcessed: offers.length,
      productsCreated: 0,
      offersLinked: 0,
      relinked: 0,
    };

    for (const offer of offers) {
      const canonical = await findOrCreateCanonicalProduct(offer, products, summary);

      if (!canonical) {
        continue;
      }

      const existing = await get("SELECT product_id FROM offers WHERE id = ?", [offer.id]);
      if (existing && Number(existing.product_id || 0) === Number(canonical.id)) {
        continue;
      }

      await run(
        `UPDATE offers
         SET product_id = ?
         WHERE id = ?`,
        [canonical.id, offer.id]
      );

      summary.offersLinked += 1;
      if (existing && existing.product_id) {
        summary.relinked += 1;
      }
    }

    console.log("Canonical linking complete.");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Failed to link offers to products:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

async function loadOffers() {
  return all(
    `SELECT id, store, title, brand, model, sku, ean, mpn
     FROM offers
     ORDER BY id ASC`
  );
}

async function loadProducts() {
  return all(
    `SELECT id, title, brand, model, sku, ean, mpn
     FROM products
     ORDER BY id ASC`
  );
}

async function findOrCreateCanonicalProduct(offer, productCache, summary) {
  const normalizedOffer = normalizeProductLike(offer);
  const match = findBestMatchingProduct(normalizedOffer, productCache);

  if (match) {
    return match.product;
  }

  const candidate = buildCanonicalProductFromOffer(offer);
  const result = await run(
    `INSERT INTO products (title, brand, model, sku, ean, mpn)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      candidate.title,
      candidate.brand,
      candidate.model,
      candidate.sku,
      candidate.ean,
      candidate.mpn,
    ]
  );

  const created = {
    id: result.lastID,
    ...candidate,
  };

  productCache.push(normalizeProductLike(created));
  summary.productsCreated += 1;

  return created;
}

main();
