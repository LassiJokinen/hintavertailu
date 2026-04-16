const { scrapeGiganttiProduct } = require("../src/scrapers/gigantti");
const { get, run, closeDb } = require("../src/db");

const TEST_URL =
  process.argv[2] ||
  "https://www.gigantti.fi/product/tietokoneet-ja-toimistotarvikkeet/tietokonetarvikkeet/hiiret-ja-nappaimistot/tietokoneen-hiiret/logitech-mx-master-3s-langaton-hiiri-grafiitti/463133";

async function main() {
  try {
    console.log(`Scraping URL: ${TEST_URL}`);
    const result = await scrapeGiganttiProduct(TEST_URL);

    await upsertRawStoreProduct(result);
    await upsertOffer(result);

    console.log("Scrape result:");
    console.log(JSON.stringify(result, null, 2));
    console.log("Saved to SQLite (raw_store_products + offers).");
  } catch (error) {
    console.error("Refresh run failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
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
    ? (price === null ? null : Number((price + shipping).toFixed(2)))
    : Number(product.total);

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
  ];

  if (existing) {
    await run(
      `UPDATE offers
       SET store = ?, title = ?, price = ?, shipping = ?, total = ?, currency = ?,
           url = ?, brand = ?, model = ?, sku = ?, ean = ?, mpn = ?, in_stock = ?,
           fetched_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...params, existing.id]
    );
    return;
  }

  await run(
    `INSERT INTO offers (
      store, title, price, shipping, total, currency, url,
      brand, model, sku, ean, mpn, in_stock
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

main();
