const { all, run } = require("./db");

async function ensureOfferMaintenanceColumns() {
  const offersTable = await all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'offers'"
  );

  if (!offersTable.length) {
    return false;
  }

  const columns = await all("PRAGMA table_info(offers)");
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("is_active")) {
    await run("ALTER TABLE offers ADD COLUMN is_active INTEGER DEFAULT 1");
  }

  if (!names.has("retry_count")) {
    await run("ALTER TABLE offers ADD COLUMN retry_count INTEGER DEFAULT 0");
  }

  if (!names.has("last_error")) {
    await run("ALTER TABLE offers ADD COLUMN last_error TEXT");
  }

  if (!names.has("last_error_at")) {
    await run("ALTER TABLE offers ADD COLUMN last_error_at TEXT");
  }

  if (!names.has("last_status_code")) {
    await run("ALTER TABLE offers ADD COLUMN last_status_code INTEGER");
  }

  await run("UPDATE offers SET is_active = 1 WHERE is_active IS NULL");
  await run("UPDATE offers SET retry_count = 0 WHERE retry_count IS NULL");

  return true;
}

function extractStatusCode(error) {
  if (!error || !error.message) {
    return null;
  }

  const statusMatch = String(error.message).match(/\b(\d{3})\b/);
  if (!statusMatch) {
    return null;
  }

  const statusCode = Number(statusMatch[1]);
  return Number.isNaN(statusCode) ? null : statusCode;
}

module.exports = {
  ensureOfferMaintenanceColumns,
  extractStatusCode,
};
