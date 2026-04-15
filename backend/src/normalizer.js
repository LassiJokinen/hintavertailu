function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizeTitle(title) {
  return normalizeText(title)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModel(model) {
  return normalizeText(model)
    .replace(/[-\s]+/g, "")
    .trim();
}

function normalizeIdentifier(identifier) {
  return normalizeText(identifier)
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

module.exports = {
  normalizeText,
  normalizeTitle,
  normalizeModel,
  normalizeIdentifier,
};