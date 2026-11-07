const { brandKey, extractProductBrand } = require("./productBrands");

const createBrandMigrationPlan = (products = []) => {
  const updates = [];
  const unresolved = [];
  for (const product of products) {
    const brand = extractProductBrand(product);
    if (!brand) {
      unresolved.push(product._id);
      continue;
    }
    if (brandKey(product.brand) !== brandKey(brand) || product.brand !== brand) updates.push({ _id: product._id, brand, previousBrand: product.brand || null });
  }
  return { updates, unresolved, scanned: products.length };
};

module.exports = { createBrandMigrationPlan };
