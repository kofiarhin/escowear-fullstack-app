// Repairs catalogue brand values from trusted manufacturer rules. Preview is
// the default; --apply is intentionally required for any MongoDB write.
require("dotenv").config();
const { connectDB } = require("../db/db");
const Product = require("../Models/Product.model");
const { createBrandMigrationPlan } = require("../services/productBrandMigration");

const apply = process.argv.includes("--apply");

const run = async ({ ProductModel = Product, connect = connectDB, log = console.log } = {}) => {
  await connect();
  const products = await ProductModel.find({}).select({ brand: 1, title: 1, name: 1, storeName: 1, retailer: 1, source: 1 }).lean();
  const plan = createBrandMigrationPlan(products);
  const changedBrands = [...new Set(plan.updates.map((item) => item.brand))].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
  log(`Scanned ${plan.scanned} product(s); ${plan.updates.length} brand value(s) ${apply ? "will be" : "would be"} normalized; ${plan.unresolved.length} product(s) need no change or cannot be safely classified.`);
  log(`Normalized brands: ${changedBrands.join(", ") || "none"}`);
  if (!apply || !plan.updates.length) return plan;
  const result = await ProductModel.bulkWrite(plan.updates.map((item) => ({ updateOne: { filter: { _id: item._id, ...(item.previousBrand === null ? { brand: { $in: [null, ""] } } : { brand: item.previousBrand }) }, update: { $set: { brand: item.brand } } } })), { ordered: false });
  log(`Updated ${result.modifiedCount} product brand value(s).`);
  return plan;
};

if (require.main === module) run().then(() => process.exit(0)).catch((error) => { console.error(`Product brand migration failed: ${error.message}`); process.exit(1); });

module.exports = { run };
