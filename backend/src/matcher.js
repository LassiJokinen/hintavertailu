const {
  normalizeTitle,
  normalizeModel,
  normalizeIdentifier,
  normalizeText,
} = require("./normalizer");

function getKeywordOverlapScore(queryTitle, offerTitle) {
  const queryWords = normalizeTitle(queryTitle).split(" ").filter(Boolean);
  const offerWords = normalizeTitle(offerTitle).split(" ").filter(Boolean);

  if (queryWords.length === 0 || offerWords.length === 0) {
    return 0;
  }

  const overlap = queryWords.filter((word) => offerWords.includes(word));
  const overlapRatio = overlap.length / Math.max(queryWords.length, offerWords.length);

  if (overlap.length >= 3 || overlapRatio >= 0.7) return 80;
  if (overlap.length >= 2 || overlapRatio >= 0.5) return 70;
  if (overlap.length >= 1) return 60;
  return 0;
}

function scoreMatch(query, offer) {
  const querySku = normalizeIdentifier(query.sku);
  const offerSku = normalizeIdentifier(offer.sku);

  const queryEan = normalizeIdentifier(query.ean);
  const offerEan = normalizeIdentifier(offer.ean);

  const queryMpn = normalizeIdentifier(query.mpn);
  const offerMpn = normalizeIdentifier(offer.mpn);

  const queryBrand = normalizeText(query.brand);
  const offerBrand = normalizeText(offer.brand);

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

  if (queryBrand && queryModel && queryBrand === offerBrand && queryModel === offerModel) {
    return { score: 90, reason: "Exact brand and model match" };
  }

  if (queryTitle && offerTitle && queryTitle === offerTitle) {
    return { score: 85, reason: "Exact title match" };
  }

  const keywordScore = getKeywordOverlapScore(query.title, offer.title);
  if (keywordScore > 0) {
    return { score: keywordScore, reason: "Keyword overlap" };
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
    .filter((result) => result.matchScore >= 60)
    .sort((a, b) => b.matchScore - a.matchScore || a.total - b.total);
}

module.exports = { scoreMatch, findMatches };