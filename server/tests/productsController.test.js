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
  assert.equal(searchFilters.length, 4);
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
