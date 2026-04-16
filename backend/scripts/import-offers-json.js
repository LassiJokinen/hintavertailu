const fs = require("fs");
const path = require("path");
const { get, run, closeDb } = require("../src/db");
const { calculateTotal, roundMoney } = require("../src/money");
const { linkOfferToCanonicalProduct } = require("../src/offer-linking");

const OFFERS_JSON_PATH = path.join(__dirname, "..", "data", "offers.json");

async function main() {
  try {
    const offers = readOffersJson();
    let inserted = 0;
    let updated = 0;
    let linked = 0;
    let createdProducts = 0;

    for (const offer of offers) {
      const upsertResult = await upsertOffer(offer);
      if (upsertResult.wasUpdated) {
        updated += 1;
      } else {
        inserted += 1;
      }

      const linkResult = await linkOfferToCanonicalProduct(upsertResult.id);
      if (linkResult.linked) {
        linked += 1;
      }
      if (linkResult.createdProduct) {
        createdProducts += 1;
      }
    }

    console.log(
      `Imported offers from JSON. Inserted: ${inserted}, Updated: ${updated}, Linked: ${linked}, Products created: ${createdProducts}`
    );
  } catch (error) {
    console.error("Import failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

function readOffersJson() {
  const raw = fs.readFileSync(OFFERS_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("offers.json must contain an array");
  }

  return parsed;
}

async function upsertOffer(offer) {
  const existing = await get(
    "SELECT id FROM offers WHERE store = ? AND url = ?",
    [offer.store || "", offer.url || ""]
  );

  const shipping = Number(offer.shipping || 0);
  const price = offer.price === null || offer.price === undefined ? null : Number(offer.price);
  const total = offer.total === null || offer.total === undefined
    ? calculateTotal(price, shipping)
    : roundMoney(offer.total);

  const params = [
    offer.store || "",
    offer.title || "",
    price,
    shipping,
    total,
    offer.currency || "EUR",
    offer.url || "",
    offer.brand || "",
    offer.model || "",
    offer.sku || "",
    offer.ean || "",
    offer.mpn || "",
    offer.inStock === undefined || offer.inStock === null ? null : (offer.inStock ? 1 : 0),
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
    return { id: existing.id, wasUpdated: true };
  }

  const result = await run(
    `INSERT INTO offers (
      store, title, price, shipping, total, currency, url,
      brand, model, sku, ean, mpn, in_stock
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );

  return { id: result.lastID, wasUpdated: false };
}

main();
