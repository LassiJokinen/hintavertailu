function clean(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s.toLowerCase() === "nan" || s === "[object Object]") return null;
  return s;
}

function normalizeText(value) {
  const s = clean(value);
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[()#[\],;:/\\|]/g, " ")
    .replace(/[^a-z0-9åäö+\-. ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBrand(value) {
  const s = normalizeText(value);
  const map = {
    "hewlett packard": "hp",
    "hp inc": "hp",
    "logitech g": "logitech",
    "western digital": "wd",
    "wd black": "wd",
    "wd blue": "wd",
    "wd red": "wd"
  };
  return map[s] || s;
}

function normalizeId(value) {
  const s = clean(value);
  if (!s) return null;
  const out = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return out.length >= 3 ? out : null;
}

function normalizeEan(value) {
  const s = clean(value);
  if (!s) return null;
  const digits = s.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 8 ? digits : null;
}

function tokenizeTitle(title) {
  return new Set(
    normalizeText(title)
      .split(" ")
      .filter(t => t.length > 2)
      .filter(t => !["with", "from", "for", "the", "and", "musta", "white", "black"].includes(t))
  );
}

function modelishTokens(title) {
  const text = normalizeText(title);
  const matches = text.match(/\b[a-z]*\d+[a-z0-9.-]*\b/g) || [];
  return new Set(matches.map(t => t.replace(/[^a-z0-9]/g, "")));
}

function overlapScore(aSet, bSet) {
  const a = [...aSet];
  const b = [...bSet];
  if (!a.length || !b.length) return 0;

  const intersection = a.filter(x => bSet.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function hasConflictingModelTokens(queryTitle, offerTitle) {
  const a = modelishTokens(queryTitle);
  const b = modelishTokens(offerTitle);

  if (!a.size || !b.size) return false;

  const shared = [...a].some(token => b.has(token));
  return !shared;
}

function scoreMatch(query, offer) {
  const qBrand = normalizeBrand(query.brand);
  const oBrand = normalizeBrand(offer.brand);

  const qEan = normalizeEan(query.ean);
  const oEan = normalizeEan(offer.ean);

  const qMpn = normalizeId(query.mpn);
  const oMpn = normalizeId(offer.mpn);

  const qSku = normalizeId(query.sku);
  const oSku = normalizeId(offer.sku);

  if (query.store === offer.store) {
    return { score: -1, reason: "same store" };
  }

  // Hard rejects
  if (qBrand && oBrand && qBrand !== oBrand) {
    return { score: -1, reason: "brand mismatch" };
  }

  if (hasConflictingModelTokens(query.title, offer.title)) {
    return { score: -1, reason: "model token mismatch" };
  }

  // High confidence identifiers
  if (qEan && oEan && qEan === oEan) {
    return { score: 100, reason: "EAN exact match" };
  }

  if (qBrand && oBrand && qMpn && oMpn && qMpn === oMpn) {
    return { score: 97, reason: "brand + MPN exact match" };
  }

  // SKU is weaker in your dataset, so keep it below EAN/MPN
  if (qBrand && oBrand && qSku && oSku && qSku === oSku) {
    return { score: 88, reason: "brand + SKU exact match" };
  }

  // Title fallback only if brand matches or brand missing
  const titleTokensQ = tokenizeTitle(query.title);
  const titleTokensO = tokenizeTitle(offer.title);
  const tokenScore = overlapScore(titleTokensQ, titleTokensO); // 0..1

  if (tokenScore >= 0.75) {
    return { score: 80, reason: "strong title overlap" };
  }

  if (tokenScore >= 0.55) {
    return { score: 68, reason: "possible title match" };
  }

  return { score: -1, reason: "too weak" };
}

function findMatches(query, offers) {
  return offers
    .map(offer => {
      const result = scoreMatch(query, offer);
      return {
        ...offer,
        matchScore: result.score,
        matchReason: result.reason,
        total: Number(offer.price || 0) + Number(offer.shipping || 0)
      };
    })
    .filter(x => x.matchScore >= 75) // only show confident results
    .sort((a, b) => b.matchScore - a.matchScore || a.total - b.total);
}

module.exports = {
  scoreMatch,
  findMatches
};