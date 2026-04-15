function normalizeText(text) {
  if (!text) return "";
  return text.toString().toLowerCase().trim();
}

function normalizeTitle(title) {
  return normalizeText(title)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModel(model) {
  return normalizeText(model).replace(/[-\s]+/g, "").toLowerCase();
}

function normalizeIdentifier(identifier) {
  return normalizeText(identifier).replace(/[^a-z0-9]/g, "");
}

module.exports = {
  normalizeText,
  normalizeTitle,
  normalizeModel,
  normalizeIdentifier
};