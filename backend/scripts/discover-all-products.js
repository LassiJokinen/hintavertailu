const path = require("path");
const { spawnSync } = require("child_process");

const DISCOVERY_SCRIPTS = [
  { store: "gigantti.fi", script: "discover-gigantti-products.js" },
  { store: "verkkokauppa.com", script: "discover-verkkokauppa-products.js" },
  { store: "power.fi", script: "discover-power-products.js" },
  { store: "jimms.fi", script: "discover-jimms-products.js" },
];

function main() {
  const forwardedArgs = process.argv.slice(2);

  const combined = {
    scriptsRun: 0,
    scriptsSucceeded: 0,
    scriptsFailed: 0,
    totals: {
      sitemapFilesProcessed: 0,
      productUrlsFound: 0,
      newUrlsSaved: 0,
      productsScraped: 0,
      offersInserted: 0,
      offersUpdated: 0,
      linkedOffers: 0,
      failures: 0,
    },
    byStore: {},
  };

  for (const entry of DISCOVERY_SCRIPTS) {
    combined.scriptsRun += 1;
    const scriptPath = path.join(__dirname, entry.script);

    console.log(`Running ${entry.script}...`);
    const result = runNodeScript(scriptPath, forwardedArgs);

    if (result.exitCode === 0) {
      combined.scriptsSucceeded += 1;
    } else {
      combined.scriptsFailed += 1;
    }

    if (result.summary) {
      addToTotals(combined.totals, result.summary);
    }

    combined.byStore[entry.store] = {
      script: entry.script,
      exitCode: result.exitCode,
      summary: result.summary,
    };
  }

  console.log("All discovery scripts complete.");
  console.log(JSON.stringify(combined, null, 2));

  if (combined.scriptsFailed > 0) {
    process.exitCode = 1;
  }
}

function runNodeScript(scriptPath, args) {
  const child = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
  });

  if (child.stdout) {
    process.stdout.write(child.stdout);
  }

  if (child.stderr) {
    process.stderr.write(child.stderr);
  }

  return {
    exitCode: Number.isInteger(child.status) ? child.status : 1,
    summary: extractLastJsonObject(child.stdout || ""),
  };
}

function extractLastJsonObject(text) {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }

  let index = source.lastIndexOf("{");
  while (index >= 0) {
    const candidate = source.slice(index).trim();

    try {
      return JSON.parse(candidate);
    } catch (error) {
      index = source.lastIndexOf("{", index - 1);
    }
  }

  return null;
}

function addToTotals(totals, summary) {
  const keys = [
    "sitemapFilesProcessed",
    "productUrlsFound",
    "newUrlsSaved",
    "productsScraped",
    "offersInserted",
    "offersUpdated",
    "linkedOffers",
    "failures",
  ];

  for (const key of keys) {
    const value = Number(summary[key] || 0);
    totals[key] += Number.isFinite(value) ? value : 0;
  }
}

main();
