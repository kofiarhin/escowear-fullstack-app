const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSneakerSourceProduct,
  mapSourceProduct,
  planImport,
} = require("../importers/bangingPricesSneakers");

const sourceProduct = (overrides = {}) => ({
  _id: "source-product-1",
  canonicalKey: "nike:source-product-1",
  store: "nike",
  storeName: "Nike",
  title: "Nike Air Max Dn8",
  price: 164.99,
  currency: "GBP",
  image: "https://example.test/primary.jpg",
  images: [
    "https://example.test/primary.jpg",
    "https://example.test/secondary.jpg",
  ],
  productUrl: "https://example.test/products/air-max-dn8",
  category: "lifestyle-shoes",
  colors: ["Black", "Black"],
  sizesRaw: ["UK 8", "UK 9"],
  sizes: ["8", "9"],
  inStock: true,
  status: "active",
  ...overrides,
});

test("selects configured sneaker categories and qualified legacy shoes", () => {
  assert.equal(
    isSneakerSourceProduct(sourceProduct({ category: "trainers" })),
    true,
  );
  assert.equal(
    isSneakerSourceProduct(sourceProduct({ category: "running-shoes" })),
    true,
  );
  assert.equal(
    isSneakerSourceProduct(
      sourceProduct({ category: "shoes", title: "Leather trainers" }),
    ),
    true,
  );
  assert.equal(
    isSneakerSourceProduct(
      sourceProduct({ category: "shoes", title: "Leather loafers" }),
    ),
    false,
  );
  assert.equal(
    isSneakerSourceProduct(sourceProduct({ category: "boots" })),
    false,
  );
});

test("maps Banging Prices fields and preserves source identity", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const result = mapSourceProduct(sourceProduct(), now);

  assert.equal(result.error, null);
  assert.deepEqual(result.product, {
    name: "Nike Air Max Dn8",
    price: 164.99,
    currency: "GBP",
    originalPrice: null,
    discountPercent: null,
    image: "https://example.test/primary.jpg",
    images: [
      "https://example.test/primary.jpg",
      "https://example.test/secondary.jpg",
    ],
    sizes: ["8", "9"],
    sizesRaw: ["UK 8", "UK 9"],
    color: "Black",
    colors: ["Black"],
    category: "shoes",
    brand: "Nike",
    retailer: { slug: "nike", name: "Nike" },
    productUrl: "https://example.test/products/air-max-dn8",
    saleUrl: null,
    gender: null,
    inStock: true,
    status: "active",
    source: {
      provider: "banging-prices",
      productId: "source-product-1",
      canonicalKey: "nike:source-product-1",
      category: "lifestyle-shoes",
    },
    sourceLastSeenAt: null,
    createdAt: now,
    updatedAt: now,
  });
});

test("rejects incomplete products and skips existing source references", () => {
  const invalid = sourceProduct({ canonicalKey: null });
  const existing = sourceProduct();
  const fresh = sourceProduct({
    _id: "source-product-2",
    canonicalKey: "nike:source-product-2",
  });
  const plan = planImport(
    [invalid, existing, fresh, fresh],
    ["nike:source-product-1"],
  );

  assert.deepEqual(plan.summary, {
    candidates: 4,
    valid: 3,
    invalid: 1,
    duplicateSourceRecords: 1,
    alreadyImported: 1,
    wouldInsert: 1,
  });
  assert.equal(plan.documents.length, 1);
  assert.equal(
    plan.documents[0].source.canonicalKey,
    "nike:source-product-2",
  );
});
