const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

sqlite3.verbose();

const DB_PATH = path.join(__dirname, "..", "data", "offers.db");
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = open({
      filename: DB_PATH,
      driver: sqlite3.Database,
    });
  }

  return dbPromise;
}

async function run(sql, params = []) {
  const db = await openDb();
  return db.run(sql, params);
}

async function get(sql, params = []) {
  const db = await openDb();
  return db.get(sql, params);
}

async function all(sql, params = []) {
  const db = await openDb();
  return db.all(sql, params);
}

async function exec(sql) {
  const db = await openDb();
  return db.exec(sql);
}

async function closeDb() {
  if (!dbPromise) {
    return;
  }

  const db = await dbPromise;
  await db.close();
  dbPromise = null;
}

module.exports = {
  DB_PATH,
  openDb,
  run,
  get,
  all,
  exec,
  closeDb,
};
