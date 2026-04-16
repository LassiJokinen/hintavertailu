const {
  normalizeTitle,
  normalizeModel,
  normalizeIdentifier,
  normalizeText,
} = require("./normalizer");

const MATCH_PRIORITY = {
  SKU: 1,
  EAN: 2,
  MPN: 3,
  BRAND_MODEL: 4,
  STRICT_TITLE: 5,
  NONE: 99,
};

function normalizeProductLike(item) {
  const brand = normalizeText(item.brand);

  return {
    ...item,
    _norm: {
      sku: normalizeIdentifier(item.sku),
      ean: normalizeIdentifier(item.ean),
      mpn: normalizeIdentifier(item.mpn),
      brand,
      model: normalizeModel(item.model),
      title: normalizeTitle(item.title),
    },
  };
}

function getMatchDetails(left, right) {
  const a = left._norm || normalizeProductLike(left)._norm;
  const b = right._norm || normalizeProductLike(right)._norm;

  if (a.sku && b.sku && a.sku === b.sku) {
    return { rank: MATCH_PRIORITY.SKU, reason: "Exact SKU match" };
  }

  if (a.ean && b.ean && a.ean === b.ean) {
    return { rank: MATCH_PRIORITY.EAN, reason: "Exact EAN match" };
  }

  if (a.mpn && b.mpn && a.mpn === b.mpn) {
    return { rank: MATCH_PRIORITY.MPN, reason: "Exact MPN match" };
  }

  if (a.brand && a.model && b.brand && b.model && a.brand === b.brand && a.model === b.model) {
    return { rank: MATCH_PRIORITY.BRAND_MODEL, reason: "Exact brand + model match" };
  }

  if (a.title && b.title && a.title === b.title) {
    return { rank: MATCH_PRIORITY.STRICT_TITLE, reason: "Strict normalized title match" };
  }

  return { rank: MATCH_PRIORITY.NONE, reason: "No strong canonical match" };
}

function findBestMatchingProduct(item, products) {
  const normalizedItem = normalizeProductLike(item);
  let best = null;

  for (const product of products) {
    const normalizedProduct = product._norm ? product : normalizeProductLike(product);
    const details = getMatchDetails(normalizedItem, normalizedProduct);

    if (details.rank === MATCH_PRIORITY.NONE) {
      continue;
    }

    if (!best) {
      best = { product: normalizedProduct, ...details };
      continue;
    }

    if (details.rank < best.rank) {
      best = { product: normalizedProduct, ...details };
    }
  }

  return best;
}

function buildCanonicalProductFromOffer(offer) {
  return {
    title: offer.title || "",
    brand: offer.brand || "",
    model: offer.model || "",
    sku: offer.sku || "",
    ean: offer.ean || "",
    mpn: offer.mpn || "",
  };
}

module.exports = {
  MATCH_PRIORITY,
  normalizeProductLike,
  getMatchDetails,
  findBestMatchingProduct,
  buildCanonicalProductFromOffer,
};
