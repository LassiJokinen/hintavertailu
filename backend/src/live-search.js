const cheerio = require("cheerio");

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_CANDIDATES_PER_STORE = 3;

const STORE_SEARCHES = [
  {
    store: "gigantti.fi",
    searchUrls: (query) => [
      `https://www.gigantti.fi/search?q=${encodeURIComponent(query)}`,
      `https://www.gigantti.fi/search?SearchParameter=${encodeURIComponent(`@QueryTerm=${query}`)}`,
    ],
    sitemapUrls: [
      "https://www.gigantti.fi/sitemaps/OCFIGIG.pdp.index.sitemap.xml",
    ],
    maxSitemapFiles: 40,
    normalizeProductUrl: normalizeGiganttiUrl,
  },
  {
    store: "verkkokauppa.com",
    searchUrls: (query) => [
      `https://www.verkkokauppa.com/fi/search?query=${encodeURIComponent(query)}`,
    ],
    sitemapUrls: [
      "https://cdn.verkkokauppa.com/gsitemaps1/latest.xml",
      "https://www.verkkokauppa.com/gsitemaps1/sitemap.xml",
    ],
    maxSitemapFiles: 6,
    normalizeProductUrl: normalizeVerkkokauppaUrl,
  },
  {
    store: "power.fi",
    searchUrls: (query) => [
      `https://www.power.fi/search/?q=${encodeURIComponent(query)}`,
    ],
    sitemapUrls: [
      "https://www.power.fi/services/sitemap.xml",
    ],
    maxSitemapFiles: 3,
    normalizeProductUrl: normalizePowerUrl,
  },
  {
    store: "jimms.fi",
    searchUrls: (query) => [
      `https://www.jimms.fi/fi/Product/Search?q=${encodeURIComponent(query)}`,
    ],
    sitemapUrls: [
      "https://www.jimms.fi/sitemap.xml",
      "https://www.jimms.fi/sitemap_index.xml",
    ],
    maxSitemapFiles: 3,
    normalizeProductUrl: normalizeJimmsUrl,
  },
];

async function searchLiveOffers(query, scrapers, options = {}) {
  const searchQueries = buildSearchQueries(query);
  if (!searchQueries.length) {
    return { offers: [], diagnostics: [] };
  }

  const candidatesPerStore = clampPositiveInteger(
    options.candidatesPerStore,
    DEFAULT_CANDIDATES_PER_STORE
  );
  const timeoutMs = clampPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  const results = await Promise.all(
    STORE_SEARCHES.map((storeConfig) =>
      searchStore(storeConfig, searchQueries, query, scrapers, {
        candidatesPerStore,
        timeoutMs,
      })
    )
  );

  return {
    offers: results.flatMap((result) => result.offers),
    diagnostics: results.map((result) => result.diagnostic),
  };
}

async function searchStore(storeConfig, searchQueries, query, scrapers, options) {
  const scraper = scrapers[storeConfig.store];
  const diagnostic = {
    store: storeConfig.store,
    status: "searched",
    searchUrlsChecked: 0,
    sitemapUrlsChecked: 0,
    candidatesFound: 0,
    candidatesScraped: 0,
    failures: [],
  };

  if (!scraper) {
    diagnostic.status = "skipped";
    diagnostic.failures.push("No scraper configured");
    return { offers: [], diagnostic };
  }

  const candidateUrls = new Set();
  const rawCandidateLimit = options.candidatesPerStore * 5;

  for (const searchQuery of searchQueries) {
    for (const searchUrl of storeConfig.searchUrls(searchQuery)) {
      if (candidateUrls.size >= rawCandidateLimit) {
        break;
      }

      diagnostic.searchUrlsChecked += 1;

      try {
        const html = await fetchText(searchUrl, options.timeoutMs);
        const urls = extractProductUrls(html, searchUrl, storeConfig.normalizeProductUrl);

        for (const url of urls) {
          candidateUrls.add(url);
          if (candidateUrls.size >= rawCandidateLimit) {
            break;
          }
        }
      } catch (error) {
        diagnostic.failures.push(`${searchUrl}: ${error.message}`);
      }
    }
  }

  for (const searchQuery of searchQueries) {
    if (candidateUrls.size >= rawCandidateLimit) {
      break;
    }

    const sitemapCandidates = await discoverFromSitemaps(
      storeConfig,
      searchQuery,
      {
        ...options,
        candidatesPerStore: rawCandidateLimit,
      },
      diagnostic
    );

    for (const url of sitemapCandidates) {
      candidateUrls.add(url);
      if (candidateUrls.size >= rawCandidateLimit) {
        break;
      }
    }
  }

  diagnostic.candidatesFound = candidateUrls.size;

  const offers = [];
  const rankedCandidateUrls = rankCandidateUrls(Array.from(candidateUrls), query)
    .slice(0, options.candidatesPerStore);

  for (const url of rankedCandidateUrls) {
    try {
      const product = await scraper(url);
      diagnostic.candidatesScraped += 1;
      offers.push({
        ...product,
        source: "live-search",
      });
    } catch (error) {
      diagnostic.failures.push(`${url}: ${error.message}`);
    }
  }

  if (!offers.length && diagnostic.failures.length) {
    diagnostic.status = "partial-failure";
  }

  return { offers, diagnostic };
}

async function discoverFromSitemaps(storeConfig, searchQuery, options, diagnostic) {
  const urls = new Set();
  const tokens = tokenizeForUrlSearch(searchQuery);
  if (!tokens.length) {
    return [];
  }

  const queue = [...(storeConfig.sitemapUrls || [])];
  const seen = new Set();
  let sitemapFilesProcessed = 0;
  const maxSitemapFiles = storeConfig.maxSitemapFiles || 3;

  while (queue.length > 0 && sitemapFilesProcessed < maxSitemapFiles) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || seen.has(sitemapUrl)) {
      continue;
    }

    seen.add(sitemapUrl);
    diagnostic.sitemapUrlsChecked += 1;
    sitemapFilesProcessed += 1;

    try {
      const xml = await fetchText(sitemapUrl, options.timeoutMs);
      const locs = parseLocUrls(xml);

      if (/<sitemapindex\b/i.test(xml)) {
        for (const loc of locs.slice(0, maxSitemapFiles)) {
          if (!seen.has(loc)) {
            queue.push(loc);
          }
        }
        continue;
      }

      for (const loc of locs) {
        if (!urlLooksLikeQuery(loc, tokens)) {
          continue;
        }

        const normalized = storeConfig.normalizeProductUrl(loc, sitemapUrl);
        if (!normalized) {
          continue;
        }

        urls.add(normalized);
        if (urls.size >= options.candidatesPerStore) {
          return Array.from(urls);
        }
      }
    } catch (error) {
      diagnostic.failures.push(`${sitemapUrl}: ${error.message}`);
    }
  }

  return Array.from(urls);
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 PriceCompareSchoolProjectBot/1.0",
        accept: "text/html,application/xhtml+xml,application/xml,application/json,text/plain",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractProductUrls(html, baseUrl, normalizeProductUrl) {
  const urls = new Set();
  const $ = cheerio.load(html);

  $("a[href]").each((_, element) => {
    const normalized = normalizeProductUrl($(element).attr("href"), baseUrl);
    if (normalized) {
      urls.add(normalized);
    }
  });

  for (const candidate of extractUrlLikeStrings(html)) {
    const normalized = normalizeProductUrl(candidate, baseUrl);
    if (normalized) {
      urls.add(normalized);
    }
  }

  return Array.from(urls);
}

function extractUrlLikeStrings(html) {
  const source = String(html || "");
  const urls = new Set();
  const patterns = [
    /https?:\\?\/\\?\/[^"'<>\\\s]+/gi,
    /(?:href|url|canonicalUrl|productUrl)"?\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
    /"path"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi,
    /"(\/(?:fi\/)?product\/[^"\\<>\s]+)"/gi,
    /"(\/fi\/Product\/Show\/\d+[^"\\<>\s]*)"/gi,
    /"(\/[^"\\<>\s]+\/p-\d+\/?)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      urls.add(decodeJsonishString(match[1] || match[0]));
    }
  }

  return Array.from(urls);
}

function parseLocUrls(xml) {
  const urls = [];
  const pattern = /<loc>([^<]+)<\/loc>/gi;
  let match;

  while ((match = pattern.exec(String(xml || ""))) !== null) {
    const url = decodeXmlEntities(match[1].trim());
    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function decodeJsonishString(value) {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }

  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch (error) {
    return raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
  }
}

function buildSearchQueries(query) {
  const identifiers = [query.ean, query.mpn, query.sku]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => !/^\d{1,5}$/.test(value));

  const title = String(query.title || "")
    .replace(/\s+/g, " ")
    .trim();

  const titleQuery = title.split(" ").slice(0, 8).join(" ");
  const queries = [...identifiers, titleQuery]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return Array.from(new Set(queries));
}

function tokenizeForUrlSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 3 || /\d/.test(token) || isRomanModelToken(token))
    .filter((token) => !["the", "and", "with", "for"].includes(token))
    .slice(0, 5);
}

function isRomanModelToken(token) {
  return /^(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(String(token || ""));
}

function urlLooksLikeQuery(url, tokens) {
  const haystack = decodeURIComponent(String(url || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const modelTokens = tokens.filter((token) => /\d/.test(token) || isRomanModelToken(token));
  if (modelTokens.length && !modelTokens.every((token) => haystack.includes(token))) {
    return false;
  }

  const hits = tokens.filter((token) => haystack.includes(token)).length;
  const requiredHits = Math.max(2, Math.ceil(tokens.length * 0.6));
  return hits >= Math.min(requiredHits, tokens.length);
}

function rankCandidateUrls(urls, query) {
  return urls
    .map((url) => ({
      url,
      score: scoreCandidateUrl(url, query),
    }))
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
    .map((entry) => entry.url);
}

function scoreCandidateUrl(url, query) {
  const haystack = decodeURIComponent(String(url || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const tokens = tokenizeForUrlSearch(query.title);
  let score = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += /\d/.test(token) || isRomanModelToken(token) ? 4 : 2;
    }
  }

  for (const identifier of [query.ean, query.mpn, query.sku]) {
    const normalized = String(identifier || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    if (normalized && normalized.length > 5 && haystack.replace(/[^a-z0-9]/g, "").includes(normalized)) {
      score += 8;
    }
  }

  return score;
}

function normalizeGiganttiUrl(value, baseUrl) {
  return normalizeUrl(value, baseUrl, "gigantti.fi", (parsed) => {
    if (!/\/product\//i.test(parsed.pathname)) {
      return null;
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  });
}

function normalizeVerkkokauppaUrl(value, baseUrl) {
  return normalizeUrl(value, baseUrl, "verkkokauppa.com", (parsed) => {
    if (!/^\/fi\/product\/[^/]+\/[^/]+/i.test(parsed.pathname)) {
      return null;
    }

    parsed.hash = "";
    parsed.search = "";
    return `https://www.verkkokauppa.com${parsed.pathname}`;
  });
}

function normalizePowerUrl(value, baseUrl) {
  return normalizeUrl(value, baseUrl, "power.fi", (parsed) => {
    if (!/\/p-\d+\/?$/i.test(parsed.pathname)) {
      return null;
    }

    parsed.hash = "";
    parsed.search = "";
    return `https://www.power.fi${parsed.pathname}`;
  });
}

function normalizeJimmsUrl(value, baseUrl) {
  return normalizeUrl(value, baseUrl, "jimms.fi", (parsed) => {
    const match = parsed.pathname.match(/^\/(?:fi\/)?Product\/Show\/(\d+)(?:\/[^/?#]+)*/i);
    if (!match) {
      return null;
    }

    parsed.hash = "";
    parsed.search = "";
    return `https://www.jimms.fi${parsed.pathname}`;
  });
}

function normalizeUrl(value, baseUrl, expectedStore, mapper) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, baseUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== expectedStore) {
      return null;
    }

    return mapper(parsed);
  } catch (error) {
    return null;
  }
}

function clampPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

module.exports = {
  searchLiveOffers,
};
