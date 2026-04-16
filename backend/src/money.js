function roundMoney(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Number(numeric.toFixed(2));
}

function calculateTotal(price, shipping) {
  if (price === null || price === undefined || price === "") {
    return null;
  }

  const safeShipping = shipping === null || shipping === undefined || shipping === "" ? 0 : Number(shipping);
  return roundMoney(Number(price) + safeShipping);
}

module.exports = {
  roundMoney,
  calculateTotal,
};
