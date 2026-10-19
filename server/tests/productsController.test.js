const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductFilter,
  createProductsController,
  parsePagination,
} = require("../controllers/productsController");

test("parsePagination applies defaults and limits oversized pages", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 24, skip: 0 });
  assert.deepEqual(parsePagination({ page: "3", limit: "12" }), {
    page: 3,
    limit: 12,
    skip: 24,
  });
  assert.deepEqual(parsePagination({ page: "0", limit: "500" }), {
    page: 1,
    limit: 60,
    skip: 0,
  });
});

test("buildProductFilter escapes search input and matches category exactly", () => {
  const filter = buildProductFilter({
    category: "shoes",
    search: "Air Max.*",
  });

  assert.equal(filter.$and.length, 2);
  assert.equal(filter.$and[0].category.source, "^shoes$");
  assert.equal(filter.$and[0].category.flags, "i");

  const searchFilters = filter.$and[1].$or;
  assert.equal(searchFilters.length, 5);
  assert.ok(searchFilters.some((entry) => Object.hasOwn(entry, "title")));
  searchFilters.forEach((entry) => {
    const regex = Object.values(entry)[0];
    assert.equal(regex.source, "Air Max\\.\\*");
    assert.equal(regex.flags, "i");
  });
});

test("getProducts returns a paginated response", async () => {
  let capturedFilter;

  const query = {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => [{ _id: "product-1", name: "Air Max Dn8" }],
  };
  const ProductModel = {
    find(filter) {
      capturedFilter = filter;
      return query;
    },
    countDocuments: async () => 25,
  };
  const { getProducts } = createProductsController(ProductModel);
  const req = { query: { page: "2", limit: "12", category: "shoes" } };
  const response = {};
  const res = {
    status(code) {
      response.status = code;
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
  };

  await getProducts(req, res);

  assert.equal(capturedFilter.category.source, "^shoes$");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    items: [{ _id: "product-1", name: "Air Max Dn8" }],
    pagination: { total: 25, page: 2, limit: 12, pages: 3 },
  });
});

test("catalogue exposes legacy titles as names without changing stored products", async () => {
  const legacy = { _id: "legacy-1", title: "ASICS GEL-KAYANO 14 Women's", price: 165 };
  const named = { _id: "named-1", name: "Canonical name", title: "Old title" };
  const query = { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [legacy, named] };
  const { getProducts } = createProductsController({ find: () => query, countDocuments: async () => 2 });
  let body;
  const res = { status(code) { assert.equal(code, 200); return this; }, json(value) { body = value; } };
  await getProducts({ query: {} }, res);
  assert.equal(body.items[0].name, legacy.title);
  assert.equal(body.items[1].name, named.name);
  assert.equal(Object.hasOwn(legacy, "name"), false);
});

test("product details normalize legacy titles and preserve canonical names", async () => {
  for (const product of [
    { _id: "legacy-1", title: "Nike Air Force 1 Low Women's", price: 120 },
    { _id: "blank-1", name: "  ", title: "Legacy sneaker" },
    { _id: "named-1", name: "Canonical name", title: "Old title" },
  ]) {
    const before = { ...product };
    const { getProduct } = createProductsController({ findById: () => ({ lean: async () => product }) });
    let body;
    const res = { status(code) { assert.equal(code, 200); return this; }, json(value) { body = value; } };
    await getProduct({ params: { id: product._id } }, res);
    assert.equal(body.name, product.name?.trim() ? product.name : product.title);
    assert.deepEqual(product, before);
  }
});
