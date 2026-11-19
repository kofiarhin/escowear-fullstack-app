// IDE-151: admin-managed homepage Latest Releases (in-memory models; no MongoDB).
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { Types } = require("mongoose");
const { startTestApp, sampleProduct, userToken } = require("./helpers/testApp");
const { ADMIN_SESSION_SECONDS } = require("../middlewares/auth.middleware");
const { createLatestReleasesController } = require("../controllers/latestReleasesController");

const ENDPOINT = "/api/admin/latest-releases";

const setup = async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  // Pair 1 is the oldest; each later pair is one day newer.
  const addProducts = (count, overrides = {}) =>
    Promise.all(Array.from({ length: count }, (_, index) => ctx.models.Product.create(sampleProduct({ name: `Pair ${index + 1}`, createdAt: new Date(Date.UTC(2026, 0, index + 1)), ...overrides }))));
  const ids = (products) => products.map((product) => String(product._id));
  const save = (products, expectedVersion) => ctx.request("PUT", ENDPOINT, { token, body: { productIds: ids(products), expectedVersion } });
  const names = (response) => response.body.items.map((item) => item.name);
  return { ctx, admin, token, addProducts, ids, save, names };
};

test("before the first save, the newest four published products are shown, unchanged from today", async (t) => {
  const { ctx, token, addProducts, ids, names } = await setup(t);
  const products = await addProducts(6);
  await ctx.models.Product.create(sampleProduct({ name: "Newest draft", status: "draft", createdAt: new Date("2026-12-01") }));
  // Legacy records keep their title and no status; they stay visible.
  await ctx.models.Product.create(sampleProduct({ name: undefined, title: "Legacy pair", status: undefined, createdAt: new Date("2026-02-01") }));

  const publicRead = await ctx.request("GET", "/api/latest-releases");
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.configured, false);
  assert.equal(publicRead.body.version, 0);
  assert.deepEqual(names(publicRead), ["Legacy pair", "Pair 6", "Pair 5", "Pair 4"]);
  // Items are full catalogue records, as the shared Product card expects.
  assert.equal(publicRead.body.items[1].price, 164.99);
  assert.deepEqual(publicRead.body.items[1].sizes, ["8", "9", "UK 10"]);

  // Matches the catalogue's own first page.
  const catalogue = await ctx.request("GET", "/api/products?limit=4&page=1");
  assert.deepEqual(catalogue.body.items.map((item) => item.name), names(publicRead));

  const adminRead = await ctx.request("GET", ENDPOINT, { token });
  assert.equal(adminRead.status, 200);
  assert.equal(adminRead.body.item.configured, false);
  assert.equal(adminRead.body.item.version, 0);
  assert.equal(adminRead.body.item.productIds.length, 4);
  assert.deepEqual(adminRead.body.item.productIds.slice(1), ids([products[5], products[4], products[3]]));
  assert.deepEqual(adminRead.body.warnings, []);
  assert.equal(ctx.models.HomepageLatestReleases.docs.length, 0);
});

test("an empty catalogue before the first save returns no items", async (t) => {
  const { ctx } = await setup(t);
  assert.deepEqual((await ctx.request("GET", "/api/latest-releases")).body, { items: [], configured: false, version: 0 });
});

test("admin saves up to eight products and the public read keeps that order with current product details", async (t) => {
  const { ctx, token, addProducts, ids, save, names } = await setup(t);
  const products = await addProducts(9);
  const picked = [2, 7, 0, 5, 1, 4, 6, 3].map((index) => products[index]);

  const first = await save(picked, 0);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.item.version, 1);
  assert.equal(first.body.item.configured, true);
  assert.deepEqual(first.body.item.productIds, ids(picked));
  assert.equal(typeof first.body.item.updatedAt, "string");
  assert.deepEqual(first.body.warnings, []);

  // A newer product never appears automatically once a selection is saved.
  await ctx.models.Product.create(sampleProduct({ name: "Brand new pair", createdAt: new Date("2026-12-31") }));
  await ctx.models.Product.updateOne({ _id: picked[0]._id }, { $set: { price: 99, name: "Renamed pair" } });

  const publicRead = await ctx.request("GET", "/api/latest-releases");
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.configured, true);
  assert.equal(publicRead.body.version, 1);
  assert.deepEqual(names(publicRead), ["Renamed pair", "Pair 8", "Pair 1", "Pair 6", "Pair 2", "Pair 5", "Pair 7", "Pair 4"]);
  assert.equal(publicRead.body.items[0].price, 99);

  const adminRead = await ctx.request("GET", ENDPOINT, { token });
  assert.deepEqual(adminRead.body.item.productIds, ids(picked));
  assert.equal(adminRead.body.item.products.length, 8);

  // Only product references are stored, never product fields.
  const stored = ctx.models.HomepageLatestReleases.docs[0];
  assert.equal(stored._id, "homepage");
  assert.deepEqual(Object.keys(stored).sort(), ["_id", "createdAt", "productIds", "updatedAt", "updatedBy", "version"].sort());

  const reordered = await save([picked[7], picked[0]], 1);
  assert.equal(reordered.status, 200);
  assert.deepEqual(names(await ctx.request("GET", "/api/latest-releases")), ["Pair 4", "Renamed pair"]);
});

test("saving the untouched defaults pins them, and product ids are normalized", async (t) => {
  const { ctx, token, addProducts } = await setup(t);
  await addProducts(5);
  const defaults = (await ctx.request("GET", ENDPOINT, { token })).body.item.productIds;
  const response = await ctx.request("PUT", ENDPOINT, { token, body: { productIds: defaults.map((id) => id.toUpperCase()), expectedVersion: 0 } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.item.productIds, defaults);

  await ctx.models.Product.create(sampleProduct({ name: "Later pair", createdAt: new Date("2026-12-31") }));
  const publicRead = await ctx.request("GET", "/api/latest-releases");
  assert.equal(publicRead.body.configured, true);
  assert.deepEqual(publicRead.body.items.map((item) => String(item._id)), defaults);
});

test("an intentional empty selection replaces the newest-four default", async (t) => {
  const { ctx, addProducts, save } = await setup(t);
  await addProducts(4);
  const cleared = await save([], 0);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.item.productIds, []);
  assert.deepEqual((await ctx.request("GET", "/api/latest-releases")).body, { items: [], configured: true, version: 1 });
});

test("draft and deleted products are hidden publicly, warned to admins, and never back-filled", async (t) => {
  const { ctx, token, addProducts, ids, save, names } = await setup(t);
  const products = await addProducts(5);
  assert.equal((await save(products.slice(0, 4), 0)).status, 200);
  await ctx.models.Product.updateOne({ _id: products[1]._id }, { $set: { status: "draft" } });
  await ctx.models.Product.deleteOne({ _id: products[2]._id });

  const publicRead = await ctx.request("GET", "/api/latest-releases");
  assert.deepEqual(names(publicRead), ["Pair 1", "Pair 4"]);

  const adminRead = await ctx.request("GET", ENDPOINT, { token });
  assert.equal(adminRead.status, 200);
  assert.deepEqual(adminRead.body.item.productIds, ids(products.slice(0, 4)));
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

  assert.equal((await ctx.request("GET", ENDPOINT)).status, 401);
  assert.equal((await ctx.request("PUT", ENDPOINT, { body })).status, 401);
  assert.equal((await ctx.request("PUT", ENDPOINT, { body, token: staleToken })).status, 401);
  assert.equal((await ctx.request("GET", ENDPOINT, { token: userToken(customer._id) })).status, 403);
  assert.equal((await ctx.request("PUT", ENDPOINT, { body, token: userToken(customer._id) })).status, 403);
  assert.equal(ctx.models.HomepageLatestReleases.docs.length, 0);
  assert.equal((await save([], 0)).status, 200);
});

test("invalid selections are rejected with 400 and never mutate the stored selection", async (t) => {
  const { ctx, token, addProducts, ids, save } = await setup(t);
  const products = await addProducts(9);
  assert.equal((await save([products[0]], 0)).status, 200);
  const id = String(products[1]._id);
  const put = (body) => ctx.request("PUT", ENDPOINT, { token, body });

  const cases = [
    [{ productIds: ids(products), expectedVersion: 1 }, "productIds"],
    [{ productIds: [id, id.toUpperCase()], expectedVersion: 1 }, "productIds"],
    [{ productIds: ["not-an-id"], expectedVersion: 1 }, "productIds"],
    [{ productIds: [{ $gt: "" }], expectedVersion: 1 }, "productIds"],
    [{ productIds: [42], expectedVersion: 1 }, "productIds"],
    [{ productIds: id, expectedVersion: 1 }, "productIds"],
    [{ expectedVersion: 1 }, "productIds"],
    [{ productIds: [id] }, "expectedVersion"],
    [{ productIds: [id], expectedVersion: -1 }, "expectedVersion"],
    [{ productIds: [id], expectedVersion: 1.5 }, "expectedVersion"],
    [{ productIds: [id], expectedVersion: "1" }, "expectedVersion"],
    [{ productIds: [id], expectedVersion: 1, configured: true }, "configured"],
    [[id], "body"],
  ];
  for (const [body, field] of cases) {
    const response = await put(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.code, "INVALID_LATEST_RELEASES_SELECTION");
    assert.ok(response.body.fields[field], `${JSON.stringify(body)} -> ${JSON.stringify(response.body.fields)}`);
  }
  assert.equal((await put("{not json")).status, 400);

  const stored = ctx.models.HomepageLatestReleases.docs[0];
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.productIds.map(String), [String(products[0]._id)]);
});

test("missing or draft products return 422 without a partial save", async (t) => {
  const { ctx, addProducts, save } = await setup(t);
  const [visible] = await addProducts(1);
  const draft = await ctx.models.Product.create(sampleProduct({ name: "Draft pair", status: "draft" }));
  const missing = { _id: new Types.ObjectId() };

  const response = await save([visible, draft, missing], 0);
  assert.equal(response.status, 422);
  assert.equal(response.body.code, "INELIGIBLE_LATEST_RELEASES_PRODUCTS");
  assert.deepEqual(response.body.unavailable, [String(draft._id), String(missing._id)]);
  assert.equal(ctx.models.HomepageLatestReleases.docs.length, 0);
});

test("stale versions return 409 and concurrent saves of one version yield one winner", async (t) => {
  const { ctx, addProducts, save } = await setup(t);
  const products = await addProducts(3);

  const firstSaves = await Promise.all([save([products[0]], 0), save([products[1]], 0)]);
  assert.deepEqual(firstSaves.map((response) => response.status).sort(), [200, 409]);
  assert.equal(firstSaves.find((response) => response.status === 409).body.code, "STALE_LATEST_RELEASES_SELECTION");

  const racing = await Promise.all([save([products[2]], 1), save([products[0], products[1]], 1)]);
  assert.deepEqual(racing.map((response) => response.status).sort(), [200, 409]);
  const stored = ctx.models.HomepageLatestReleases.docs[0];
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.productIds.map(String), racing.find((response) => response.status === 200).body.item.productIds);

  const stale = await save([products[2]], 1);
  assert.equal(stale.status, 409);
  assert.equal(ctx.models.HomepageLatestReleases.docs[0].version, 2);
});

test("Latest Releases, Featured Sneakers and Classics saves stay independent", async (t) => {
  const { ctx, token, addProducts, save, names } = await setup(t);
  const products = await addProducts(3);
  const featured = await ctx.request("PUT", "/api/admin/featured-sneakers", { token, body: { productIds: [String(products[0]._id)], expectedVersion: 0 } });
  assert.equal(featured.status, 200);
  const classics = await ctx.request("PUT", "/api/admin/classics", { token, body: { entries: [{ title: "Card", searchTerm: "pair", productId: String(products[1]._id) }], expectedVersion: 0 } });
  assert.equal(classics.status, 200);

  // The same product may appear in every section; each keeps its own version.
  assert.equal((await save([products[2], products[0]], 0)).status, 200);
  assert.deepEqual(names(await ctx.request("GET", "/api/latest-releases")), ["Pair 3", "Pair 1"]);

  const publicFeatured = await ctx.request("GET", "/api/featured-sneakers");
  assert.deepEqual(publicFeatured.body.items.map((item) => item.name), ["Pair 1"]);
  assert.equal(publicFeatured.body.version, 1);
  const publicClassics = await ctx.request("GET", "/api/classics");
  assert.deepEqual(publicClassics.body.items.map((item) => item.product.name), ["Pair 2"]);
  assert.equal(publicClassics.body.version, 1);
  assert.equal(ctx.models.FeaturedSneakers.docs.length, 1);
  assert.equal(ctx.models.HomepageClassics.docs.length, 1);
  assert.equal(ctx.models.HomepageLatestReleases.docs.length, 1);
});

test("read and save failures return safe error codes without internal details", async () => {
  const failing = { findById: () => ({ lean: async () => { throw new Error("db down: secret detail"); } }) };
  const response = () => ({ statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } });
  const controller = createLatestReleasesController({ HomepageLatestReleases: failing, Product: { find: () => ({ lean: async () => [] }) } });

  const publicRes = response();
  await controller.getPublicLatestReleases({}, publicRes);
  assert.deepEqual([publicRes.statusCode, publicRes.body], [500, { error: "Unable to load latest releases", code: "LATEST_RELEASES_READ_FAILED" }]);
  const adminRes = response();
  await controller.getAdminLatestReleases({}, adminRes);
  assert.deepEqual([adminRes.statusCode, adminRes.body], [500, { error: "Unable to load latest releases selection", code: "LATEST_RELEASES_READ_FAILED" }]);

  const productId = String(new Types.ObjectId());
  const writer = createLatestReleasesController({
    HomepageLatestReleases: { findOneAndUpdate: () => ({ lean: async () => { throw new Error("write failed"); } }) },
    Product: { find: () => ({ lean: async () => [{ _id: productId, name: "Pair", status: "active" }] }) },
  });
  const saveRes = response();
  await writer.saveLatestReleases({ body: { productIds: [productId], expectedVersion: 3 }, user: { _id: "admin" } }, saveRes);
  assert.deepEqual([saveRes.statusCode, saveRes.body], [500, { error: "Unable to save latest releases selection", code: "LATEST_RELEASES_SAVE_FAILED" }]);
});
