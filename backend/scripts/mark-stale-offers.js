const { run, closeDb } = require("../src/db");
const { ensureOfferMaintenanceColumns } = require("../src/offer-maintenance");

const MAX_RETRY_COUNT = Number.parseInt(process.argv[2] || "3", 10);

async function main() {
  try {
    const ready = await ensureOfferMaintenanceColumns();
    if (!ready) {
      throw new Error("offers table not found. Run `npm run init-db` first.");
    }

    const retryLimit = Number.isNaN(MAX_RETRY_COUNT) || MAX_RETRY_COUNT < 1
      ? 3
      : MAX_RETRY_COUNT;

    const result = await markStaleOffers(retryLimit);

    console.log(
      `Marked ${result.changes || 0} offer(s) as stale/inactive (retry_count >= ${retryLimit} or 404).`
    );
  } catch (error) {
    console.error("Failed to mark stale offers:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

async function markStaleOffers(retryLimit) {
  return run(
    `UPDATE offers
     SET is_active = 0
     WHERE COALESCE(is_active, 1) = 1
       AND (
         COALESCE(retry_count, 0) >= ?
         OR COALESCE(last_status_code, 0) = 404
       )`,
    [retryLimit]
  );
}

main();
