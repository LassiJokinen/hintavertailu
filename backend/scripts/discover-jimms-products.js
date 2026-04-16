const { all, get, run, closeDb } = require("../src/db");
const { scrapeJimmsProduct } = require("../src/scrapers/jimms");
const { ensureOfferMaintenanceColumns } = require("../src/offer-maintenance");
const { calculateTotal, roundMoney } = require("../src/money");
const { linkOfferToCanonicalProduct } = require("../src/offer-linking");

const STORE = "jimms.fi";
const DEFAULT_SITEMAP_INDEX_URL = "https://www.jimms.fi/sitemap.xml";
const SITEMAP_CANDIDATE_URLS = [
  DEFAULT_SITEMAP_INDEX_URL,
  "https://www.jimms.fi/sitemap_index.xml",
  "https://www.jimms.fi/sitemapindex.xml",
  "https://www.jimms.fi/sitemap/SitemapIndex.xml",
];
const DEFAULT_MAX_SITEMAP_FILES = 10;
const DEFAULT_MAX_CATEGORY_PAGES = 120;
const DEFAULT_MAX_CATEGORY_DEPTH = 3;
const DEFAULT_MAX_PAGINATION_PAGES = 240;
const DEFAULT_MAX_PAGES_PER_CATEGORY = 25;
const DEFAULT_MAX_PRODUCT_URLS = 500;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const LARGE_SUBCATEGORY_LINK_WARNING_THRESHOLD = 100;
const MAX_SUBCATEGORY_LINKS_TO_KEEP_WHEN_NOISY = 100;
const HOMEPAGE_URL = "https://www.jimms.fi/fi";
const PRIORITY_CATEGORY_KEYWORDS = [
  "kannettava",
  "laptop",
  "apple",
  "mac",
  "emolevy",
  "motherboard",
  "prosessori",
  "cpu",
  "naytonohjain",
  "näytönohjain",
  "gpu",
  "ssd",
  "kiintolevy",
  "hard drive",
  "virtalahde",
  "virtalähde",
  "power supply",
  "kotelo",
  "case",
];

async function main() {
  try {
    const ready = await ensureOfferMaintenanceColumns();
    if (!ready) {
      throw new Error("offers table not found. Run `npm run init-db` first.");
    }

    const options = parseOptions(process.argv.slice(2));
    const existingUrls = await loadExistingUrls();
    const discovery = await discoverProductUrls(options, existingUrls);

    const summary = {
      discoverySource: discovery.source,
      sitemapFilesProcessed: discovery.sitemapFilesProcessed,
      categoryPagesProcessed: discovery.categoryPagesProcessed,
      subcategoryLinksFound: discovery.subcategoryLinksFound,
      paginationPagesProcessed: discovery.paginationPagesProcessed,
      productUrlsFound: discovery.productUrlsFound,
      newUrlsSaved: 0,
      productsScraped: 0,
      offersInserted: 0,
      offersUpdated: 0,
      linkedOffers: 0,
      failures: 0,
    };

    for (const url of discovery.urls) {
      try {
        const saved = await saveDiscoveredUrl(url);
        if (saved) {
          summary.newUrlsSaved += 1;
        }

        const product = await scrapeJimmsProduct(url);
        summary.productsScraped += 1;

        await upsertRawStoreProduct(product);
        const offerResult = await upsertOffer(product);
        if (offerResult.wasUpdated) {
          summary.offersUpdated += 1;
        } else {
          summary.offersInserted += 1;
        }

        const linkResult = await linkOfferToCanonicalProduct(offerResult.id);
        if (linkResult.linked) {
          summary.linkedOffers += 1;
        }
      } catch (error) {
        summary.failures += 1;
        console.log(`Failed for ${url}`);
        console.log(`  ${error.message}`);
      }

      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }

    console.log("Jimms discovery complete.");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Jimms discovery failed:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

function parseOptions(args) {
  const options = {
    sitemapIndexUrl: DEFAULT_SITEMAP_INDEX_URL,
    maxSitemapFiles: DEFAULT_MAX_SITEMAP_FILES,
    maxCategoryPages: DEFAULT_MAX_CATEGORY_PAGES,
    maxCategoryDepth: DEFAULT_MAX_CATEGORY_DEPTH,
    maxPaginationPages: DEFAULT_MAX_PAGINATION_PAGES,
    maxPagesPerCategory: DEFAULT_MAX_PAGES_PER_CATEGORY,
    maxProductUrls: DEFAULT_MAX_PRODUCT_URLS,
    delayMs: DEFAULT_DELAY_MS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--sitemap-index-url" && args[index + 1]) {
      options.sitemapIndexUrl = args[index + 1];
      index += 1;
      continue;
    }

    if (current === "--max-sitemap-files" && args[index + 1]) {
      options.maxSitemapFiles = toPositiveInteger(args[index + 1], DEFAULT_MAX_SITEMAP_FILES);
      index += 1;
      continue;
    }

    if (current === "--max-product-urls" && args[index + 1]) {
      options.maxProductUrls = toPositiveInteger(args[index + 1], DEFAULT_MAX_PRODUCT_URLS);
      index += 1;
      continue;
    }

    if (current === "--max-category-pages" && args[index + 1]) {
      options.maxCategoryPages = toPositiveInteger(args[index + 1], DEFAULT_MAX_CATEGORY_PAGES);
      index += 1;
      continue;
    }

    if (current === "--max-category-depth" && args[index + 1]) {
      options.maxCategoryDepth = toPositiveInteger(args[index + 1], DEFAULT_MAX_CATEGORY_DEPTH);
      index += 1;
      continue;
    }

    if (current === "--max-pagination-pages" && args[index + 1]) {
      options.maxPaginationPages = toPositiveInteger(args[index + 1], DEFAULT_MAX_PAGINATION_PAGES);
      index += 1;
      continue;
    }

    if (current === "--max-pages-per-category" && args[index + 1]) {
      options.maxPagesPerCategory = toPositiveInteger(args[index + 1], DEFAULT_MAX_PAGES_PER_CATEGORY);
      index += 1;
      continue;
    }

    if (current === "--delay-ms" && args[index + 1]) {
      options.delayMs = toPositiveInteger(args[index + 1], DEFAULT_DELAY_MS);
      index += 1;
      continue;
    }

    if (current === "--request-timeout-ms" && args[index + 1]) {
      options.requestTimeoutMs = toPositiveInteger(args[index + 1], DEFAULT_REQUEST_TIMEOUT_MS);
      index += 1;
      continue;
    }

    if (current.startsWith("--sitemap-index-url=")) {
      options.sitemapIndexUrl = current.split("=").slice(1).join("=") || DEFAULT_SITEMAP_INDEX_URL;
      continue;
    }

    if (current.startsWith("--max-sitemap-files=")) {
      options.maxSitemapFiles = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_SITEMAP_FILES);
      continue;
    }

    if (current.startsWith("--max-product-urls=")) {
      options.maxProductUrls = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_PRODUCT_URLS);
      continue;
    }

    if (current.startsWith("--max-category-pages=")) {
      options.maxCategoryPages = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_CATEGORY_PAGES);
      continue;
    }

    if (current.startsWith("--max-category-depth=")) {
      options.maxCategoryDepth = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_CATEGORY_DEPTH);
      continue;
    }

    if (current.startsWith("--max-pagination-pages=")) {
      options.maxPaginationPages = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_PAGINATION_PAGES);
      continue;
    }

    if (current.startsWith("--max-pages-per-category=")) {
      options.maxPagesPerCategory = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_PAGES_PER_CATEGORY);
      continue;
    }

    // Backward-compatible alias from previous implementation.
    if (current === "--max-pagination-depth" && args[index + 1]) {
      options.maxPaginationPages = toPositiveInteger(args[index + 1], DEFAULT_MAX_PAGINATION_PAGES);
      index += 1;
      continue;
    }

    if (current.startsWith("--max-pagination-depth=")) {
      options.maxPaginationPages = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_MAX_PAGINATION_PAGES);
      continue;
    }

    if (current.startsWith("--request-timeout-ms=")) {
      options.requestTimeoutMs = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_REQUEST_TIMEOUT_MS);
      continue;
    }

    if (current.startsWith("--delay-ms=")) {
      options.delayMs = toPositiveInteger(current.split("=").slice(1).join("="), DEFAULT_DELAY_MS);
    }
  }

  return options;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

async function discoverProductUrls(options, existingUrls) {
  const discovered = new Set();

  const sitemapDiscovery = await discoverFromSitemap(options, existingUrls);
  for (const url of sitemapDiscovery.urls) {
    if (discovered.size >= options.maxProductUrls) {
      break;
    }

    discovered.add(url);
  }

  const remainingProductCapacity = Math.max(0, options.maxProductUrls - discovered.size);
  const categoryDiscovery = remainingProductCapacity > 0
    ? await discoverFromRecursiveCategories({
      ...options,
      maxProductUrls: remainingProductCapacity,
    }, existingUrls)
    : {
      categoryPagesProcessed: 0,
      subcategoryLinksFound: 0,
      paginationPagesProcessed: 0,
      productUrlsFound: 0,
      urls: [],
    };

  for (const url of categoryDiscovery.urls) {
    if (discovered.size >= options.maxProductUrls) {
      break;
    }

    discovered.add(url);
  }

  return {
    source: "sitemap+recursive-categories",
    sitemapFilesProcessed: sitemapDiscovery.sitemapFilesProcessed,
    categoryPagesProcessed: categoryDiscovery.categoryPagesProcessed,
    subcategoryLinksFound: categoryDiscovery.subcategoryLinksFound,
    paginationPagesProcessed: categoryDiscovery.paginationPagesProcessed,
    productUrlsFound: sitemapDiscovery.productUrlsFound + categoryDiscovery.productUrlsFound,
    urls: Array.from(discovered),
  };
}

async function discoverFromSitemap(options, existingUrls) {
  const discovered = new Set();
  let sitemapFilesProcessed = 0;
  let productUrlsFound = 0;

  const sitemapSources = await loadSitemapSources(options);

  for (const sitemapUrl of sitemapSources) {
    if (discovered.size >= options.maxProductUrls) {
      break;
    }

    sitemapFilesProcessed += 1;
    console.log(`Scanning sitemap: ${sitemapUrl}`);

    try {
      const xml = await fetchText(sitemapUrl, options.delayMs, options.requestTimeoutMs);
      const urls = parseLocUrls(xml)
        .map((url) => normalizeUrl(url))
        .filter((url) => isRealProductUrl(url));

      for (const url of urls) {
        productUrlsFound += 1;

        if (discovered.size >= options.maxProductUrls) {
          break;
        }

        if (existingUrls.has(url)) {
          continue;
        }

        discovered.add(url);
        existingUrls.add(url);
      }
    } catch (error) {
      console.log(`  Skipped sitemap because it could not be read: ${error.message}`);
    }
  }

  return {
    sitemapFilesProcessed,
    productUrlsFound,
    urls: Array.from(discovered),
  };
}

async function loadSitemapSources(options) {
  const candidates = [options.sitemapIndexUrl, ...SITEMAP_CANDIDATE_URLS]
    .map((url) => String(url || "").trim())
    .filter(Boolean);

  const seen = new Set();

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeUrl(candidate) || normalizeAbsoluteUrl(candidate);
    const dedupeKey = normalizedCandidate || candidate;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);

    try {
      const xml = await fetchText(candidate, options.delayMs, options.requestTimeoutMs);
      const locUrls = parseLocUrls(xml)
        .map((url) => normalizeAbsoluteUrl(url))
        .filter(Boolean);

      if (isSitemapIndexXml(xml)) {
        return locUrls.slice(0, options.maxSitemapFiles);
      }

      if (isUrlSetXml(xml)) {
        return [normalizeAbsoluteUrl(candidate)].filter(Boolean).slice(0, options.maxSitemapFiles);
      }
    } catch (error) {
      // Try next candidate.
    }
  }

  return [];
}

function isSitemapIndexXml(xml) {
  return /<sitemapindex\b/i.test(xml);
}

function isUrlSetXml(xml) {
  return /<urlset\b/i.test(xml);
}

async function discoverFromRecursiveCategories(options, existingUrls) {
  const discovered = new Set();
  let productUrlsFound = 0;
  let categoryPagesProcessed = 0;
  let paginationPagesProcessed = 0;
  let subcategoryLinksFound = 0;

  const categoryQueue = await loadInitialCategoryQueue(options);
  const seenCategories = new Set(categoryQueue.map((entry) => entry.url));
  let paginationBudgetRemaining = options.maxPaginationPages;

  while (categoryQueue.length > 0) {
    if (discovered.size >= options.maxProductUrls) {
      break;
    }

    if (categoryPagesProcessed >= options.maxCategoryPages) {
      break;
    }

    const category = categoryQueue.shift();
    if (!category || !category.url) {
      continue;
    }

    if (category.depth > options.maxCategoryDepth) {
      continue;
    }

    if (paginationBudgetRemaining < 0) {
      paginationBudgetRemaining = 0;
    }

    categoryPagesProcessed += 1;
    console.log(
      `[progress] category-start url=${category.url} depth=${category.depth} ` +
      `categoryPagesProcessed=${categoryPagesProcessed} paginationPagesProcessed=${paginationPagesProcessed} ` +
      `productUrlsFound=${productUrlsFound} queueRemaining=${categoryQueue.length}`
    );

    try {
      const crawlResult = await crawlCategoryWithPagination(
        category.url,
        options,
        paginationBudgetRemaining,
        category.depth,
        ({ pageUrl, pageDepth, paginationPage, paginationPagesProcessedInCategory }) => {
          const totalPaginationAfterCurrentPage = paginationPagesProcessed + paginationPagesProcessedInCategory;
          console.log(
            `[progress] page url=${pageUrl} categoryUrl=${category.url} categoryDepth=${category.depth} ` +
            `pageDepth=${pageDepth} paginationPage=${paginationPage} categoryPagesProcessed=${categoryPagesProcessed} ` +
            `paginationPagesProcessed=${totalPaginationAfterCurrentPage} productUrlsFound=${productUrlsFound} ` +
            `queueRemaining=${categoryQueue.length}`
          );
        }
      );
      paginationPagesProcessed += crawlResult.paginationPagesProcessed;
      paginationBudgetRemaining = Math.max(0, paginationBudgetRemaining - crawlResult.paginationPagesProcessed);

      for (const url of crawlResult.productUrls) {
        productUrlsFound += 1;

        if (discovered.size >= options.maxProductUrls) {
          break;
        }

        if (existingUrls.has(url)) {
          continue;
        }

        discovered.add(url);
        existingUrls.add(url);
      }

      subcategoryLinksFound += crawlResult.linkedCategoryUrls.length;
      const linksForQueue = limitNoisySubcategoryLinks(category.url, crawlResult.linkedCategoryUrls);

      if (crawlResult.linkedCategoryUrls.length > LARGE_SUBCATEGORY_LINK_WARNING_THRESHOLD) {
        console.log(
          `[warning] noisy category links trimmed: ` +
          `url=${category.url} depth=${category.depth} found=${crawlResult.linkedCategoryUrls.length} kept=${linksForQueue.length}`
        );
      }

      for (const linkedCategoryUrl of linksForQueue) {

        if (category.depth >= options.maxCategoryDepth) {
          continue;
        }

        if (seenCategories.has(linkedCategoryUrl)) {
          continue;
        }

        if (seenCategories.size >= options.maxCategoryPages * 4) {
          break;
        }

        seenCategories.add(linkedCategoryUrl);
        categoryQueue.push({
          url: linkedCategoryUrl,
          depth: category.depth + 1,
          score: scoreCategory(linkedCategoryUrl, "") - (category.depth + 1) * 2,
        });
      }

      if (paginationBudgetRemaining <= 0) {
        console.log("Pagination budget exhausted for this run.");
      }

      console.log(
        `[progress] category-done url=${category.url} depth=${category.depth} ` +
        `categoryPagesProcessed=${categoryPagesProcessed} paginationPagesProcessed=${paginationPagesProcessed} ` +
        `productUrlsFound=${productUrlsFound} queueRemaining=${categoryQueue.length}`
      );

      categoryQueue.sort((a, b) => b.score - a.score);
    } catch (error) {
      console.log(`  Skipped category because it could not be read: ${error.message}`);
    }
  }

  return {
    categoryPagesProcessed,
    subcategoryLinksFound,
    paginationPagesProcessed,
    productUrlsFound,
    urls: Array.from(discovered),
  };
}

async function loadInitialCategoryQueue(options) {
  const byUrl = new Map();

  try {
    const html = await fetchText(HOMEPAGE_URL, options.delayMs, options.requestTimeoutMs);
    const menuCategories = extractCategoryLinksFromHtml(html, {
      includeJsonLinks: true,
      allowQuery: false,
    });

    for (const category of menuCategories) {
      const normalized = normalizeCategoryUrl(category.url);
      if (!normalized) {
        continue;
      }

      const score = scoreCategory(normalized, category.label || "");
      const existing = byUrl.get(normalized);
      if (!existing || score > existing.score) {
        byUrl.set(normalized, { url: normalized, depth: 0, score });
      }
    }
  } catch (error) {
    console.log(`Homepage category discovery failed: ${error.message}`);
  }

  return Array.from(byUrl.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxCategoryPages * 2);
}

function extractCategoryLinksFromHtml(html, options = {}) {
  const opts = {
    includeJsonLinks: true,
    allowQuery: false,
    ...options,
  };

  const results = [];
  const byUrl = new Map();

  const addCandidate = (candidateUrl, label) => {
    const normalized = normalizeCategoryUrl(candidateUrl, {
      keepPaginationQuery: false,
    });
    if (!normalized) {
      return;
    }

    if (!opts.allowQuery && hasQueryString(candidateUrl)) {
      return;
    }

    if (looksLikeFacetOrFilterLink(candidateUrl)) {
      return;
    }

    const existing = byUrl.get(normalized);
    const resolvedLabel = String(label || "").trim();
    if (!existing || (resolvedLabel && !existing.label)) {
      byUrl.set(normalized, { url: normalized, label: resolvedLabel });
    }
  };

  const anchorPattern = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchorMatch;

  while ((anchorMatch = anchorPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((anchorMatch[1] || "").trim());
    if (!/\/fi\/Product\/List\//i.test(href)) {
      continue;
    }

    const label = cleanHtmlText(anchorMatch[2] || "");
    addCandidate(href, label);
  }

  if (opts.includeJsonLinks) {
    const jsonPattern = /"(?:url|href)"\s*:\s*"(\/fi\/Product\/List\/[^"\\]+)"(?:[^{}]{0,180}?"(?:name|title|label)"\s*:\s*"([^"\\]*)")?/gi;
    let jsonMatch;

    while ((jsonMatch = jsonPattern.exec(html)) !== null) {
      const href = decodeJsonLikeString(jsonMatch[1] || "");
      const label = decodeJsonLikeString(jsonMatch[2] || "");
      addCandidate(href, label);
    }
  }

  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let hrefMatch;

  while ((hrefMatch = hrefPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((hrefMatch[1] || "").trim());
    if (/\/fi\/Product\/List\//i.test(href)) {
      addCandidate(href, "");
    }
  }

  for (const value of byUrl.values()) {
    results.push(value);
  }

  return results;
}

function scoreCategory(url, label) {
  const text = `${String(url || "")} ${String(label || "")}`.toLowerCase();
  let score = 0;

  for (const keyword of PRIORITY_CATEGORY_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      score += 10;
    }
  }

  // Prefer main category list pages over heavily filtered links.
  if (!text.includes("?fq=")) {
    score += 3;
  }

  if (text.includes("/fi/product/list/")) {
    score += 2;
  }

  return score;
}

function extractSubcategoryLinksFromCategoryPage(html, currentCategoryUrl) {
  const categoryContentHtml = extractCategoryContentHtml(html);
  const links = extractCategoryLinksFromHtml(categoryContentHtml, {
    includeJsonLinks: false,
    allowQuery: false,
  }).map((entry) => entry.url);

  return rankSubcategoryLinks(currentCategoryUrl, links);
}

function extractCategoryContentHtml(html) {
  const source = String(html || "");
  if (!source) {
    return "";
  }

  // Remove global sections before extracting links so header/footer/nav links do not pollute subcategory discovery.
  const withoutGlobalSections = source
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");

  const mainMatches = withoutGlobalSections.match(/<main\b[\s\S]*?<\/main>/gi) || [];
  if (mainMatches.length > 0) {
    return mainMatches.join("\n");
  }

  const contentBlocks = withoutGlobalSections.match(
    /<(?:section|div)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:content|main|category|product-list|listing|results)[^"']*["'][^>]*>[\s\S]*?<\/(?:section|div)>/gi
  ) || [];

  if (contentBlocks.length > 0) {
    return contentBlocks.join("\n");
  }

  return withoutGlobalSections;
}

function limitNoisySubcategoryLinks(parentCategoryUrl, links) {
  const ranked = rankSubcategoryLinks(parentCategoryUrl, links);

  if (ranked.length <= LARGE_SUBCATEGORY_LINK_WARNING_THRESHOLD) {
    return ranked;
  }

  return ranked.slice(0, MAX_SUBCATEGORY_LINKS_TO_KEEP_WHEN_NOISY);
}

function rankSubcategoryLinks(parentCategoryUrl, links) {
  const parent = normalizeCategoryUrl(parentCategoryUrl, { keepPaginationQuery: false });
  const parentBase = getCategoryBaseKey(parent || parentCategoryUrl);
  const parentCode = getCategoryCode(parent || parentCategoryUrl);
  const unique = new Map();

  for (const link of links) {
    const normalized = normalizeCategoryUrl(link, { keepPaginationQuery: false });
    if (!normalized) {
      continue;
    }

    if (parent && normalized === parent) {
      continue;
    }

    if (looksLikeFacetOrFilterLink(normalized)) {
      continue;
    }

    let score = scoreCategory(normalized, "");

    if (getCategoryBaseKey(normalized) === parentBase) {
      score += 10;
    }

    if (getCategoryCode(normalized) === parentCode) {
      score += 8;
    }

    if (normalized.split("/").length <= 9) {
      score += 2;
    }

    const existing = unique.get(normalized);
    if (!existing || score > existing.score) {
      unique.set(normalized, { url: normalized, score });
    }
  }

  return Array.from(unique.values())
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
    .map((entry) => entry.url);
}

function hasQueryString(value) {
  try {
    const parsed = new URL(value, "https://www.jimms.fi");
    return parsed.searchParams.toString().length > 0;
  } catch (error) {
    return /\?/.test(String(value || ""));
  }
}

function looksLikeFacetOrFilterLink(value) {
  const text = String(value || "").toLowerCase();

  if (!text) {
    return false;
  }

  if (!text.includes("/fi/product/list/")) {
    return false;
  }

  return [
    "?",
    "&fq=",
    "?fq=",
    "sort=",
    "order=",
    "minprice=",
    "maxprice=",
    "brand=",
    "manufacturer=",
    "availability=",
    "instock=",
    "view=",
    "perpage=",
    "limit=",
  ].some((needle) => text.includes(needle));
}

async function crawlCategoryWithPagination(
  categoryUrl,
  options,
  paginationBudget,
  categoryDepth,
  onPageProgress = null
) {
  const visitedPages = new Set();
  const queue = [{ url: categoryUrl, depth: 0 }];
  const productUrls = new Set();
  const linkedCategoryUrls = new Set();
  let paginationPagesProcessed = 0;
  let pagesProcessedForCategory = 0;

  while (queue.length > 0) {
    if (pagesProcessedForCategory >= options.maxPagesPerCategory) {
      console.log(
        `[safeguard] max pages-per-category reached: ` +
        `url=${categoryUrl} depth=${categoryDepth} maxPagesPerCategory=${options.maxPagesPerCategory}`
      );
      break;
    }

    const current = queue.shift();
    if (!current || !current.url) {
      continue;
    }

    if (visitedPages.has(current.url)) {
      continue;
    }

    if (current.depth > 0 && paginationPagesProcessed >= paginationBudget) {
      continue;
    }

    visitedPages.add(current.url);
    pagesProcessedForCategory += 1;
    if (current.depth > 0) {
      paginationPagesProcessed += 1;
    }

    if (typeof onPageProgress === "function") {
      onPageProgress({
        pageUrl: current.url,
        pageDepth: current.depth,
        paginationPage: getPaginationPageNumber(current.url),
        paginationPagesProcessedInCategory: paginationPagesProcessed,
      });
    }

    const html = await fetchText(current.url, options.delayMs, options.requestTimeoutMs);

    const pageProducts = extractProductUrlsFromHtml(html)
      .map((url) => normalizeUrl(url))
      .filter((url) => isRealProductUrl(url));

    for (const url of pageProducts) {
      productUrls.add(url);
    }

    const categoryLinks = extractSubcategoryLinksFromCategoryPage(html, current.url)
      .map((url) => normalizeCategoryUrl(url, { keepPaginationQuery: false }))
      .filter(Boolean);

    for (const linkedCategoryUrl of categoryLinks) {
      linkedCategoryUrls.add(linkedCategoryUrl);
    }

    if (paginationPagesProcessed >= paginationBudget) {
      continue;
    }

    const paginationUrls = extractPaginationUrls(html, current.url);
    const fallbackPagination = buildFallbackPaginationCandidates(current.url, current.depth + 1);
    const nextPages = [...paginationUrls, ...fallbackPagination]
      .map((url) => normalizeCategoryUrl(url, { keepPaginationQuery: true }))
      .filter(Boolean);

    for (const nextUrl of nextPages) {
      if (!visitedPages.has(nextUrl)) {
        queue.push({ url: nextUrl, depth: current.depth + 1 });
      }
    }
  }

  return {
    paginationPagesProcessed,
    productUrls: Array.from(productUrls),
    linkedCategoryUrls: Array.from(linkedCategoryUrls),
  };
}

function extractPaginationUrls(html, currentCategoryUrl) {
  const paginationUrls = new Set();
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  const current = normalizeCategoryUrl(currentCategoryUrl, { keepPaginationQuery: true });

  if (!current) {
    return [];
  }

  const currentBaseKey = getCategoryBaseKey(current);
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((match[1] || "").trim());
    const normalized = normalizeCategoryUrl(href, { keepPaginationQuery: true });
    if (!normalized) {
      continue;
    }

    if (getCategoryBaseKey(normalized) !== currentBaseKey) {
      continue;
    }

    if (looksLikePaginationUrl(normalized)) {
      paginationUrls.add(normalized);
    }
  }

  return Array.from(paginationUrls);
}

function buildFallbackPaginationCandidates(categoryUrl, pageNumber) {
  const base = normalizeCategoryUrl(categoryUrl, { keepPaginationQuery: false });
  if (!base) {
    return [];
  }

  const urls = [];

  try {
    const pageUrl = new URL(base);
    pageUrl.searchParams.set("page", String(pageNumber));
    urls.push(pageUrl.toString());

    const pUrl = new URL(base);
    pUrl.searchParams.set("p", String(pageNumber));
    urls.push(pUrl.toString());
  } catch (error) {
    return [];
  }

  return urls;
}

function looksLikePaginationUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has("page") || parsed.searchParams.has("p") || parsed.searchParams.has("Page");
  } catch (error) {
    return false;
  }
}

function getCategoryBaseKey(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4) {
      return parsed.pathname.toLowerCase();
    }

    return `/${parts[0].toLowerCase()}/${parts[1].toLowerCase()}/${parts[2].toLowerCase()}/${parts[3].toLowerCase()}`;
  } catch (error) {
    return String(url || "").toLowerCase();
  }
}

function getCategoryCode(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return String(parts[3] || "").toLowerCase();
  } catch (error) {
    return "";
  }
}

function extractProductUrlsFromHtml(html) {
  const urls = new Set();

  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let hrefMatch;

  while ((hrefMatch = hrefPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities((hrefMatch[1] || "").trim());
    if (!href) {
      continue;
    }

    if (/\/Product\/Show\/\d+/i.test(href)) {
      urls.add(href);
    }
  }

  const escapedPattern = /https?:\\\/\\\/www\.jimms\.fi\\\/(?:fi|FI)\\\/Product\\\/Show\\\/\d+[^"\\s<]*/g;
  let escapedMatch;

  while ((escapedMatch = escapedPattern.exec(html)) !== null) {
    const unescaped = escapedMatch[0]
      .replace(/\\\//g, "/")
      .replace(/\\u0026/g, "&");

    urls.add(unescaped);
  }

  return Array.from(urls);
}

function getPaginationPageNumber(url) {
  try {
    const parsed = new URL(url);
    const page = parsed.searchParams.get("page") || parsed.searchParams.get("p") || parsed.searchParams.get("Page");
    const parsedPage = Number.parseInt(String(page || ""), 10);
    if (Number.isFinite(parsedPage) && parsedPage > 0) {
      return parsedPage;
    }
  } catch (error) {
    // Ignore invalid URL parsing for progress info.
  }

  return 1;
}

async function fetchText(url, delayMs, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 PriceCompareSchoolProjectBot/1.0",
        accept: "application/xml,text/xml,text/html,application/xhtml+xml,application/json,text/plain",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseLocUrls(xml) {
  const urls = [];
  const pattern = /<loc>([^<]+)<\/loc>/g;
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    const url = decodeXmlEntities(match[1].trim());
    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeJsonLikeString(value) {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }

  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch (error) {
    return raw
      .replace(/\\\//g, "/")
      .replace(/\\u0026/g, "&");
  }
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAbsoluteUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, "https://www.jimms.fi").toString();
  } catch (error) {
    return null;
  }
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, "https://www.jimms.fi");
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== STORE) {
      return null;
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const productIndex = pathParts.findIndex((part) => part.toLowerCase() === "product");
    if (productIndex < 0) {
      return null;
    }

    const showPart = pathParts[productIndex + 1] || "";
    const productId = pathParts[productIndex + 2] || "";
    if (showPart.toLowerCase() !== "show" || !/^\d+$/.test(productId)) {
      return null;
    }

    const tail = pathParts.slice(productIndex + 3).map((part) => encodeURIComponent(decodeURIComponent(part)));
    const normalizedPath = ["fi", "Product", "Show", productId, ...tail].join("/");

    return `https://www.jimms.fi/${normalizedPath}`;
  } catch (error) {
    return null;
  }
}

function normalizeCategoryUrl(value, options = {}) {
  const config = {
    keepPaginationQuery: false,
    ...options,
  };

  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, "https://www.jimms.fi");
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== STORE) {
      return null;
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length < 4) {
      return null;
    }

    if (pathParts[0].toLowerCase() !== "fi") {
      return null;
    }

    if (pathParts[1].toLowerCase() !== "product" || pathParts[2].toLowerCase() !== "list") {
      return null;
    }

    const normalizedTail = pathParts
      .slice(3)
      .map((part) => encodeURIComponent(decodeURIComponent(part)).replace(/%2F/gi, "/"));

    if (normalizedTail.length < 1) {
      return null;
    }

    parsed.pathname = `/fi/Product/List/${normalizedTail.join("/")}`.replace(/\/+$/, "");

    if (config.keepPaginationQuery) {
      const pageValue = parsed.searchParams.get("page") || parsed.searchParams.get("p") || parsed.searchParams.get("Page");
      const page = Number.parseInt(String(pageValue || ""), 10);
      parsed.search = "";

      if (Number.isFinite(page) && page > 1) {
        parsed.searchParams.set("page", String(page));
      }
    } else {
      parsed.search = "";
    }

    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function isRealProductUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return /^\/fi\/Product\/Show\/\d+(?:\/[^/?#]+)*$/i.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function sleep(ms) {
  if (!ms || ms < 1) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadExistingUrls() {
  const rows = await all(
    `SELECT url
     FROM offers
     WHERE store = ? AND url IS NOT NULL AND url <> ''
     UNION
     SELECT url
     FROM raw_store_products
     WHERE store = ? AND url IS NOT NULL AND url <> ''`,
    [STORE, STORE]
  );

  return new Set(rows.map((row) => normalizeUrl(row.url)).filter(Boolean));
}

async function saveDiscoveredUrl(url) {
  const existing = await get(
    "SELECT id FROM raw_store_products WHERE store = ? AND url = ?",
    [STORE, url]
  );

  if (existing) {
    return false;
  }

  await run(
    `INSERT INTO raw_store_products (store, url, html, extracted_json)
     VALUES (?, ?, ?, ?)`,
    [STORE, url, null, null]
  );

  return true;
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
    ? calculateTotal(price, shipping)
    : roundMoney(product.total);

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
    1,
    0,
    null,
    null,
    null,
  ];

  if (existing) {
    await run(
      `UPDATE offers
       SET store = ?, title = ?, price = ?, shipping = ?, total = ?, currency = ?,
           url = ?, brand = ?, model = ?, sku = ?, ean = ?, mpn = ?, in_stock = ?,
           is_active = ?, retry_count = ?, last_error = ?, last_error_at = ?,
           last_status_code = ?, fetched_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...params, existing.id]
    );
    return { id: existing.id, wasUpdated: true };
  }

  const result = await run(
    `INSERT INTO offers (
      store, title, price, shipping, total, currency, url,
      brand, model, sku, ean, mpn, in_stock,
      is_active, retry_count, last_error, last_error_at, last_status_code
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );

  return { id: result.lastID, wasUpdated: false };
}

main();