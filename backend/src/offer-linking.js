const { all, get, run } = require("./db");
const {
  findBestMatchingProduct,
  normalizeProductLike,
  buildCanonicalProductFromOffer,
} = require("./canonical-products");

async function linkOfferToCanonicalProduct(offerId) {
  const offer = await get(
    `SELECT id, product_id, title, brand, model, sku, ean, mpn
     FROM offers
     WHERE id = ?`,
    [offerId]
  );

  if (!offer) {
    return { linked: false, createdProduct: false, productId: null };
  }

  const products = await all(
    `SELECT id, title, brand, model, sku, ean, mpn
     FROM products
     ORDER BY id ASC`
  );

  const normalizedOffer = normalizeProductLike(offer);
  const normalizedProducts = products.map(normalizeProductLike);
  const bestMatch = findBestMatchingProduct(normalizedOffer, normalizedProducts);

  let productId = null;
  let createdProduct = false;

  if (bestMatch) {
    productId = bestMatch.product.id;
  } else {
    const candidate = buildCanonicalProductFromOffer(offer);
    const created = await run(
      `INSERT INTO products (title, brand, model, sku, ean, mpn)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [candidate.title, candidate.brand, candidate.model, candidate.sku, candidate.ean, candidate.mpn]
    );

    productId = created.lastID;
    createdProduct = true;
  }

  if (Number(offer.product_id || 0) === Number(productId || 0)) {
    return { linked: false, createdProduct, productId };
  }

  await run(
    `UPDATE offers
     SET product_id = ?
     WHERE id = ?`,
    [productId, offer.id]
  );

  return { linked: true, createdProduct, productId };
}

module.exports = {
  linkOfferToCanonicalProduct,
};
