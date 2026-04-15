const {
  normalizeTitle,
  normalizeModel,
  normalizeIdentifier,
  normalizeText,
} = require("./normalizer");

const STOP_WORDS = new Set([
  "wireless",
  "bluetooth",
  "headphones",
  "kuulokkeet",
  "langattomat",
  "portable",
  "speaker",
  "black",
  "white",
  "generation",
  "gen",
  "2nd",
  "3rd",
  "4th",
  "2024",
  "aktiivisella",
  "melunvaimennuksella",
  "latauskotelo",
  "with",
  "case"
]);

const KNOWN_BRANDS = ["apple", "sony", "jbl", "bose"];

function getMeaningfulWords(title) {
  return normalizeTitle(title)
    .split(" ")
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word));
}

function detectBrand(text) {
  const normalized = normalizeTitle(text);
  return KNOWN_BRANDS.find((brand) => normalized.includes(brand)) || "";
}

function scoreMatch(query, offer) {
  const querySku = normalizeIdentifier(query.sku);
  const offerSku = normalizeIdentifier(offer.sku);

  const queryEan = normalizeIdentifier(query.ean);
  const offerEan = normalizeIdentifier(offer.ean);

  const queryMpn = normalizeIdentifier(query.mpn);
  const offerMpn = normalizeIdentifier(offer.mpn);

  const explicitQueryBrand = normalizeText(query.brand);
  const offerBrand = normalizeText(offer.brand);
  const inferredQueryBrand = detectBrand(query.title);
  const effectiveQueryBrand = explicitQueryBrand || inferredQueryBrand;

  const queryModel = normalizeModel(query.model);
  const offerModel = normalizeModel(offer.model);

  const queryTitle = normalizeTitle(query.title);
  const offerTitle = normalizeTitle(offer.title);

  if (querySku && offerSku && querySku === offerSku) {
    return { score: 100, reason: "Exact SKU match" };
  }

  if (queryEan && offerEan && queryEan === offerEan) {
    return { score: 100, reason: "Exact EAN match" };
  }

  if (queryMpn && offerMpn && queryMpn === offerMpn) {
    return { score: 100, reason: "Exact MPN match" };
  }

  if (effectiveQueryBrand && queryModel && effectiveQueryBrand === offerBrand && queryModel === offerModel) {
    return { score: 90, reason: "Exact brand and model match" };
  }

  if (queryTitle && offerTitle && queryTitle === offerTitle) {
    return { score: 85, reason: "Exact title match" };
  }

  const queryWords = getMeaningfulWords(query.title);
  const offerWords = getMeaningfulWords(offer.title);
  const overlap = queryWords.filter((word) => offerWords.includes(word));

  if (effectiveQueryBrand && effectiveQueryBrand === offerBrand && overlap.length >= 2) {
    return { score: 75, reason: "Strong keyword overlap with same brand" };
  }

  return { score: 0, reason: "No strong match" };
}

function findMatches(query, offers) {
  return offers
    .filter((offer) => !query.store || offer.store !== query.store)
    .filter((offer) => !query.currency || !offer.currency || offer.currency === query.currency)
    .map((offer) => {
      const { score, reason } = scoreMatch(query, offer);
      const total = Number(offer.price || 0) + Number(offer.shipping || 0);

      return {
        ...offer,
        total,
        matchScore: score,
        matchReason: reason,
      };
    })
    .filter((result) => result.matchScore >= 75)
    .sort((a, b) => b.matchScore - a.matchScore || a.total - b.total);
}

module.exports = { scoreMatch, findMatches };