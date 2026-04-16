const { all, closeDb } = require("../src/db");
const { ensureOfferMaintenanceColumns } = require("../src/offer-maintenance");

const DAYS_BACK = Number.parseInt(process.argv[2] || "7", 10);

async function main() {
  try {
    const ready = await ensureOfferMaintenanceColumns();
    if (!ready) {
      throw new Error("offers table not found. Run `npm run init-db` first.");
    }

    const days = Number.isNaN(DAYS_BACK) || DAYS_BACK < 1 ? 7 : DAYS_BACK;
    const failedOffers = await loadFailedOffers(days);

    if (!failedOffers.length) {
      console.log(`No failed offers found in the last ${days} day(s).`);
      return;
    }

    console.log(`Found ${failedOffers.length} failed/stale candidate offers:`);
    for (const offer of failedOffers) {
      const marker = offer.last_status_code === 404 ? "404" : `retry=${offer.retry_count}`;
      const when = offer.last_error_at || "unknown-time";
      console.log(`[${marker}] ${offer.store} | ${offer.title} | ${offer.url}`);
      console.log(`  last_error_at=${when} active=${offer.is_active}`);
    }
  } catch (error) {
    console.error("Failed to list failed offers:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

async function loadFailedOffers(days) {
  return all(
    `SELECT store, title, url, retry_count, last_status_code, last_error, last_error_at, is_active
     FROM offers
     WHERE (
       last_status_code = 404
       OR (
         last_error IS NOT NULL
         AND last_error <> ''
         AND datetime(COALESCE(last_error_at, fetched_at)) >= datetime('now', ?)
       )
     )
     ORDER BY COALESCE(last_error_at, fetched_at) DESC, retry_count DESC`,
    [`-${days} days`]
  );
}

main();
