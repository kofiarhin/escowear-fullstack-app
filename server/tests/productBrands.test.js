const test = require("node:test");
const assert = require("node:assert/strict");
const { exactManufacturer, extractProductBrand, getAvailableBrands } = require("../services/productBrands");
const { createBrandMigrationPlan } = require("../services/productBrandMigration");
const { run: runBrandMigration } = require("../scripts/migrateProductBrands");

const productModel = (products) => ({
  find() {
    return { select() { return this; }, lean: async () => products };
  },
});

test("extracts only recognized manufacturers and normalizes title collections", () => {
  assert.equal(exactManufacturer("nIkE"), "Nike");
  assert.equal(exactManufacturer("NikeCourt Borough"), null);
  assert.equal(extractProductBrand({ title: "NikeCourt Borough Low", storeName: "Nike" }), "Nike");
  assert.equal(extractProductBrand({ title: "NikeSKIMS Rift Satin", storeName: "Nike" }), "Nike");
  assert.equal(extractProductBrand({ title: "Air Jordan 1 Low", storeName: "Nike" }), "Jordan");
  assert.equal(extractProductBrand({ title: "New Balance 9060" }), "New Balance");
  assert.equal(extractProductBrand({ title: "Black trainers", storeName: "ASOS" }), null);
});

test("dropdown data contains canonical manufacturers only", async () => {
  const items = await getAvailableBrands(productModel([
    { title: "NikeCourt Borough Low", storeName: "Nike" },
    { title: "NikeSKIMS Rift", storeName: "Nike" },
    { title: "PUMA Speedcat" },
    { title: "Black trainers", storeName: "ASOS" },
  ]));
  assert.deepEqual(items, ["Nike", "PUMA"]);
});

test("brand migration plans updates without mutating product data", () => {
  const plan = createBrandMigrationPlan([
    { _id: "1", title: "NikeCourt Borough Low", brand: "NikeCourt Borough" },
    { _id: "2", title: "NikeSKIMS Rift", brand: null },
    { _id: "3", title: "Black trainers", brand: null },
  ]);
  assert.deepEqual(plan.updates, [
    { _id: "1", brand: "Nike", previousBrand: "NikeCourt Borough" },
    { _id: "2", brand: "Nike", previousBrand: null },
  ]);
  assert.deepEqual(plan.unresolved, ["3"]);
});

test("brand migration defaults to a dry run", async () => {
  let wrote = false;
  const messages = [];
  const ProductModel = {
    find() {
      return { select() { return this; }, lean: async () => [{ _id: "1", title: "NikeCourt Borough Low", brand: null }] };
    },
    async bulkWrite() { wrote = true; },
  };
  await runBrandMigration({ ProductModel, connect: async () => {}, log: (message) => messages.push(message) });
  assert.equal(wrote, false);
  assert.match(messages[0], /would be normalized/);
});
