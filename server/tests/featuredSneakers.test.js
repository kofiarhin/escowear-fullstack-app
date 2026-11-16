// IDE-135: admin-managed Featured Sneakers (in-memory models; no MongoDB).
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { Types } = require("mongoose");
const { startTestApp, sampleProduct, userToken } = require("./helpers/testApp");
const { ADMIN_SESSION_SECONDS } = require("../middlewares/auth.middleware");
const { createFeaturedSneakersController } = require("../controllers/featuredSneakersController");

const setup = async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const addProducts = (count, overrides = {}) =>
    Promise.all(Array.from({ length: count }, (_, index) => ctx.models.Product.create(sampleProduct({ name: `Pair ${index + 1}`, ...overrides }))));
  const save = (productIds, expectedVersion, options = {}) =>
    ctx.request("PUT", "/api/admin/featured-sneakers", { token, body: { productIds: productIds.map(String), expectedVersion }, ...options });
  return { ctx, admin, token, addProducts, save };
};

test("public and admin reads of an unconfigured selection are empty with version 0", async (t) => {
  const { ctx, token, addProducts } = await setup(t);
  await addProducts(5);

  const publicRead = await ctx.request("GET", "/api/featured-sneakers");
  assert.equal(publicRead.status, 200);
  assert.deepEqual(publicRead.body, { items: [], version: 0 });

  const adminRead = await ctx.request("GET", "/api/admin/featured-sneakers", { token });
  assert.equal(adminRead.status, 200);
  assert.deepEqual(adminRead.body, { item: { productIds: [], version: 0, updatedAt: null, products: [] }, warnings: [] });
  // GET never creates the singleton.
  assert.equal(ctx.models.FeaturedSneakers.docs.length, 0);
});

test("admin saves up to four products and the public read keeps their exact order", async (t) => {
  const { ctx, token, addProducts, save } = await setup(t);
  const products = await addProducts(4);
  const order = [products[2]._id, products[0]._id, products[3]._id, products[1]._id];

  const first = await save(order, 0);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.item.version, 1);
  assert.deepEqual(first.body.item.productIds, order.map(String));
  assert.equal(typeof first.body.item.updatedAt, "string");
  assert.deepEqual(first.body.warnings, []);

  const publicRead = await ctx.request("GET", "/api/featured-sneakers");
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.version, 1);
  assert.deepEqual(publicRead.body.items.map((item) => item.name), ["Pair 3", "Pair 1", "Pair 4", "Pair 2"]);
  assert.equal(publicRead.body.items[0].price, 164.99);
  assert.equal(Object.hasOwn(publicRead.body, "updatedBy"), false);

  const reordered = await save([products[1]._id, products[2]._id], 1);
  assert.equal(reordered.status, 200);
  assert.equal(reordered.body.item.version, 2);
  assert.deepEqual((await ctx.request("GET", "/api/featured-sneakers")).body.items.map((item) => item.name), ["Pair 2", "Pair 3"]);

  // Only references are stored, never copied catalogue fields.
  const stored = ctx.models.FeaturedSneakers.docs[0];
  assert.equal(stored._id, "homepage");
  assert.deepEqual(Object.keys(stored).sort(), ["_id", "createdAt", "productIds", "updatedAt", "updatedBy", "version"].sort());
});

test("admin can intentionally save an empty selection without a catalogue fallback", async (t) => {
  const { ctx, addProducts, save } = await setup(t);
  const products = await addProducts(2);
  assert.equal((await save([products[0]._id], 0)).status, 200);
  const cleared = await save([], 1);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.item.version, 2);
  assert.deepEqual(await (await ctx.request("GET", "/api/featured-sneakers")).body, { items: [], version: 2 });
});

test("featured products reflect current catalogue data, legacy names and sold-out stock", async (t) => {
  const { ctx, addProducts, save } = await setup(t);
  const [current] = await addProducts(1);
  const legacy = await ctx.models.Product.create(sampleProduct({ name: "", title: "Legacy imported pair", status: undefined }));
  const soldOut = await ctx.models.Product.create(sampleProduct({ name: "Sold out pair", inStock: false }));
  assert.equal((await save([current._id, legacy._id, soldOut._id], 0)).status, 200);
  await ctx.models.Product.updateOne({ _id: current._id }, { $set: { price: 199.5, name: "Renamed pair" } });

  const items = (await ctx.request("GET", "/api/featured-sneakers")).body.items;
  assert.deepEqual(items.map((item) => item.name), ["Renamed pair", "Legacy imported pair", "Sold out pair"]);
  assert.equal(items[0].price, 199.5);
  assert.equal(items[2].inStock, false);
});

test("draft and deleted products are hidden publicly, warned to admins, and never back-filled", async (t) => {
  const { ctx, token, addProducts, save } = await setup(t);
  const products = await addProducts(4);
  await ctx.models.Product.create(sampleProduct({ name: "Unselected catalogue pair" }));
  assert.equal((await save(products.map((product) => product._id), 0)).status, 200);
  await ctx.models.Product.updateOne({ _id: products[1]._id }, { $set: { status: "draft" } });
  await ctx.models.Product.deleteOne({ _id: products[2]._id });

  const publicRead = await ctx.request("GET", "/api/featured-sneakers");
  assert.deepEqual(publicRead.body.items.map((item) => item.name), ["Pair 1", "Pair 4"]);
  assert.equal(JSON.stringify(publicRead.body).includes("Pair 2"), false);

  const adminRead = await ctx.request("GET", "/api/admin/featured-sneakers", { token });
  assert.equal(adminRead.status, 200);
  assert.deepEqual(adminRead.body.item.productIds, products.map((product) => String(product._id)));
  assert.deepEqual(adminRead.body.item.products.map((item) => item.name), ["Pair 1", "Pair 2", "Pair 4"]);
  assert.deepEqual(adminRead.body.warnings, [
    { productId: String(products[1]._id), reason: "draft" },
    { productId: String(products[2]._id), reason: "missing" },
  ]);
});

test("admin endpoints require a fresh admin session", async (t) => {
  const { ctx, admin, save } = await setup(t);
  const customer = await ctx.addUser();
  const staleToken = jwt.sign({ id: String(admin._id), iat: Math.floor(Date.now() / 1000) - ADMIN_SESSION_SECONDS - 60 }, process.env.JWT_SECRET, { expiresIn: "30d" });
  const body = { productIds: [], expectedVersion: 0 };

  assert.equal((await ctx.request("GET", "/api/admin/featured-sneakers")).status, 401);
  assert.equal((await ctx.request("PUT", "/api/admin/featured-sneakers", { body })).status, 401);
  assert.equal((await ctx.request("PUT", "/api/admin/featured-sneakers", { body, token: staleToken })).status, 401);
  assert.equal((await ctx.request("GET", "/api/admin/featured-sneakers", { token: userToken(customer._id) })).status, 403);
  assert.equal((await ctx.request("PUT", "/api/admin/featured-sneakers", { body, token: userToken(customer._id) })).status, 403);
  assert.equal(ctx.models.FeaturedSneakers.docs.length, 0);
  assert.equal((await save([], 0)).status, 200);
});

test("invalid selections are rejected with 400 and never mutate the stored selection", async (t) => {
  const { ctx, token, addProducts, save } = await setup(t);
  const products = await addProducts(5);
  assert.equal((await save([products[0]._id], 0)).status, 200);
  const id = String(products[1]._id);
  const put = (body) => ctx.request("PUT", "/api/admin/featured-sneakers", { token, body });

  const cases = [
    [{ productIds: products.map((product) => String(product._id)), expectedVersion: 1 }, "productIds"],
    [{ productIds: [id, id.toUpperCase()], expectedVersion: 1 }, "productIds"],
    [{ productIds: ["not-an-id"], expectedVersion: 1 }, "productIds"],
    [{ productIds: [{ $gt: "" }], expectedVersion: 1 }, "productIds"],
    [{ productIds: id, expectedVersion: 1 }, "productIds"],
    [{ productIds: [id] }, "expectedVersion"],
    [{ productIds: [id], expectedVersion: -1 }, "expectedVersion"],
    [{ productIds: [id], expectedVersion: 1.5 }, "expectedVersion"],
    [{ productIds: [id], expectedVersion: "1" }, "expectedVersion"],
    [{ productIds: [id], expectedVersion: 1, version: 9 }, "version"],
    [[id], "body"],
  ];
  for (const [body, field] of cases) {
    const response = await put(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.code, "INVALID_FEATURED_SELECTION");
    assert.ok(response.body.fields[field], `${JSON.stringify(body)} -> ${JSON.stringify(response.body.fields)}`);
  }
  const malformed = await ctx.request("PUT", "/api/admin/featured-sneakers", { token, body: "{not json" });
  assert.equal(malformed.status, 400);

  const stored = ctx.models.FeaturedSneakers.docs[0];
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.productIds.map(String), [String(products[0]._id)]);
});

test("missing or draft products return 422 without a partial save", async (t) => {
  const { ctx, addProducts, save } = await setup(t);
  const [visible] = await addProducts(1);
  const draft = await ctx.models.Product.create(sampleProduct({ name: "Draft pair", status: "draft" }));
  const missing = new Types.ObjectId();

  const response = await save([visible._id, draft._id, missing], 0);
  assert.equal(response.status, 422);
  assert.equal(response.body.code, "INELIGIBLE_FEATURED_PRODUCTS");
  assert.deepEqual(response.body.unavailable, [String(draft._id), String(missing)]);
  assert.equal(ctx.models.FeaturedSneakers.docs.length, 0);
});

test("stale versions return 409 and concurrent saves of one version yield one winner", async (t) => {
  const { ctx, addProducts, save } = await setup(t);
  const products = await addProducts(3);

  const firstSaves = await Promise.all([save([products[0]._id], 0), save([products[1]._id], 0)]);
  assert.deepEqual(firstSaves.map((response) => response.status).sort(), [200, 409]);
  assert.equal(firstSaves.find((response) => response.status === 409).body.code, "STALE_FEATURED_SELECTION");
  const winner = firstSaves.find((response) => response.status === 200).body.item.productIds;

  const racing = await Promise.all([save([products[2]._id], 1), save([products[0]._id, products[1]._id], 1)]);
  assert.deepEqual(racing.map((response) => response.status).sort(), [200, 409]);
  const stored = ctx.models.FeaturedSneakers.docs[0];
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.productIds.map(String), racing.find((response) => response.status === 200).body.item.productIds);
  assert.notDeepEqual(stored.productIds.map(String), winner);

  const stale = await save([products[2]._id], 1);
  assert.equal(stale.status, 409);
  assert.equal(ctx.models.FeaturedSneakers.docs[0].version, 2);
});

test("read and save failures return safe error codes without internal details", async () => {
  const failing = { findById: () => ({ lean: async () => { throw new Error("db down: secret detail"); } }) };
  const response = () => {
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    return res;
  };
  const controller = createFeaturedSneakersController({ FeaturedSneakers: failing, Product: { find: () => ({ lean: async () => [] }) } });

  const publicRes = response();
  await controller.getPublicFeatured({}, publicRes);
  assert.deepEqual([publicRes.statusCode, publicRes.body], [500, { error: "Unable to load featured sneakers", code: "FEATURED_READ_FAILED" }]);
  const adminRes = response();
  await controller.getAdminFeatured({}, adminRes);
  assert.deepEqual([adminRes.statusCode, adminRes.body], [500, { error: "Unable to load featured selection", code: "FEATURED_READ_FAILED" }]);

  const productId = String(new Types.ObjectId());
  const writer = createFeaturedSneakersController({
    FeaturedSneakers: { findOneAndUpdate: () => ({ lean: async () => { throw new Error("write failed"); } }) },
    Product: { find: () => ({ lean: async () => [{ _id: productId, name: "Pair", status: "active" }] }) },
  });
  const saveRes = response();
  await writer.saveFeatured({ body: { productIds: [productId], expectedVersion: 3 }, user: { _id: "admin" } }, saveRes);
  assert.deepEqual([saveRes.statusCode, saveRes.body], [500, { error: "Unable to save featured selection", code: "FEATURED_SAVE_FAILED" }]);
});
