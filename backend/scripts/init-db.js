const { exec, closeDb } = require("../src/db");

async function initDatabase() {
  await exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      sku TEXT,
      ean TEXT,
      mpn TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      store TEXT NOT NULL,
      title TEXT NOT NULL,
      price REAL,
      shipping REAL DEFAULT 0,
      total REAL,
      currency TEXT DEFAULT 'EUR',
      url TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      sku TEXT,
      ean TEXT,
      mpn TEXT,
      in_stock INTEGER,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS raw_store_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      url TEXT NOT NULL,
      html TEXT,
      extracted_json TEXT,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_store_url ON offers(store, url);
    CREATE INDEX IF NOT EXISTS idx_products_identifiers ON products(sku, ean, mpn);
    CREATE INDEX IF NOT EXISTS idx_offers_identifiers ON offers(sku, ean, mpn);
    CREATE INDEX IF NOT EXISTS idx_raw_store_url ON raw_store_products(store, url);
  `);
}

async function main() {
  try {
    await initDatabase();
    console.log("Database initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
