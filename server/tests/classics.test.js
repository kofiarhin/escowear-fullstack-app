// IDE-149: admin-managed homepage Classics cards (in-memory models; no MongoDB).
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { Types } = require("mongoose");
const { startTestApp, sampleProduct, userToken } = require("./helpers/testApp");
const { ADMIN_SESSION_SECONDS } = require("../middlewares/auth.middleware");
const { createClassicsController } = require("../controllers/classicsController");

const setup = async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const addProducts = (count, overrides = {}) =>
    Promise.all(Array.from({ length: count }, (_, index) => ctx.models.Product.create(sampleProduct({ name: `Pair ${index + 1}`, image: `https://example.test/${index + 1}.jpg`, ...overrides }))));
  const card = (product, index = 0) => ({ title: `Card ${index + 1}`, searchTerm: `term ${index + 1}`, productId: String(product._id) });
  const save = (entries, expectedVersion) => ctx.request("PUT", "/api/admin/classics", { token, body: { entries, expectedVersion } });
  return { ctx, admin, token, addProducts, card, save };
};

test("before the first save, defaults resolve one published product per term without creating config", async (t) => {
  const { ctx, token } = await setup(t);
  const older = await ctx.models.Product.create(sampleProduct({ name: "Nike Air Force 1 '07", createdAt: new Date("2026-01-01") }));
  const newer = await ctx.models.Product.create(sampleProduct({ name: "Nike Air Force 1 Low", createdAt: new Date("2026-06-01"), image: "", images: ["", "https://example.test/af1.jpg"] }));
  await ctx.models.Product.create(sampleProduct({ name: "Adidas Samba OG draft", status: "draft", createdAt: new Date("2026-07-01") }));
  const samba = await ctx.models.Product.create(sampleProduct({ name: "Adidas Samba OG", createdAt: new Date("2026-02-01") }));

  const publicRead = await ctx.request("GET", "/api/classics");
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.configured, false);
  assert.equal(publicRead.body.version, 0);
  assert.deepEqual(publicRead.body.items.map((item) => [item.title, item.searchTerm]), [
    ["Air Force 1", "air force"], ["Dunk", "dunk"], ["Air Max", "air max"], ["Samba", "samba"], ["Spezial", "spezial"], ["Campus", "campus"],
  ]);
  // Newest match wins, the cover falls back to the first gallery image, drafts never appear.
  assert.deepEqual(publicRead.body.items[0].product, { _id: String(newer._id), name: "Nike Air Force 1 Low", image: "https://example.test/af1.jpg" });
  assert.equal(publicRead.body.items[3].product._id, String(samba._id));
  assert.equal(publicRead.body.items[1].product, null);
  assert.notEqual(publicRead.body.items[0].product._id, String(older._id));
  // Only tile fields are public.
  assert.deepEqual(Object.keys(publicRead.body.items[3].product).sort(), ["_id", "image", "name"]);

  const adminRead = await ctx.request("GET", "/api/admin/classics", { token });
  assert.equal(adminRead.status, 200);
  assert.equal(adminRead.body.item.configured, false);
  assert.equal(adminRead.body.item.version, 0);
  assert.deepEqual(adminRead.body.item.entries[0], { title: "Air Force 1", searchTerm: "air force", productId: String(newer._id) });
  assert.deepEqual(adminRead.body.item.entries[1], { title: "Dunk", searchTerm: "dunk", productId: null });
  assert.deepEqual(adminRead.body.warnings, []);
  assert.equal(ctx.models.HomepageClassics.docs.length, 0);
});

test("defaults never reuse one product for two cards, so they stay saveable", async (t) => {
  const { ctx, token, save } = await setup(t);
  // Matches both "air force" (name) and "air max" (category) and is the newest of each.
  const shared = await ctx.models.Product.create(sampleProduct({ name: "Nike Air Force 1", source: { category: "Air Max" }, createdAt: new Date("2026-09-01") }));
  const airMax = await ctx.models.Product.create(sampleProduct({ name: "Nike Air Max 90", createdAt: new Date("2026-03-01") }));

  const items = (await ctx.request("GET", "/api/classics")).body.items;
  assert.equal(items[0].product._id, String(shared._id));
  assert.equal(items[2].product._id, String(airMax._id));

  const adminRead = await ctx.request("GET", "/api/admin/classics", { token });
  const entries = adminRead.body.item.entries.filter((entry) => entry.productId);
  assert.equal((await save(entries, 0)).status, 200);
});

test("admin saves up to six cards and the public read keeps their order, copy and current cover", async (t) => {
  const { ctx, token, addProducts, card, save } = await setup(t);
  const products = await addProducts(6);
  const entries = [3, 0, 5, 1, 4, 2].map((index, position) => card(products[index], position));

  const first = await save(entries, 0);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.item.version, 1);
  assert.equal(first.body.item.configured, true);
  assert.deepEqual(first.body.item.entries, entries);
  assert.equal(typeof first.body.item.updatedAt, "string");
  assert.deepEqual(first.body.warnings, []);

  await ctx.models.Product.updateOne({ _id: products[3]._id }, { $set: { image: "https://example.test/new-cover.jpg", name: "Renamed pair" } });
  const publicRead = await ctx.request("GET", "/api/classics");
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.configured, true);
  assert.equal(publicRead.body.version, 1);
  assert.deepEqual(publicRead.body.items.map((item) => item.title), ["Card 1", "Card 2", "Card 3", "Card 4", "Card 5", "Card 6"]);
  assert.deepEqual(publicRead.body.items[0], { title: "Card 1", searchTerm: "term 1", product: { _id: String(products[3]._id), name: "Renamed pair", image: "https://example.test/new-cover.jpg" } });

  const adminRead = await ctx.request("GET", "/api/admin/classics", { token });
  assert.deepEqual(adminRead.body.item.entries, entries);
  assert.equal(adminRead.body.item.products.length, 6);

  // Only card copy and product references are stored, never product fields.
  const stored = ctx.models.HomepageClassics.docs[0];
  assert.equal(stored._id, "homepage");
  assert.deepEqual(Object.keys(stored).sort(), ["_id", "createdAt", "entries", "updatedAt", "updatedBy", "version"].sort());
  assert.deepEqual(Object.keys(stored.entries[0]).sort(), ["productId", "searchTerm", "title"]);
});

test("titles and search terms are trimmed and product ids normalized before storing", async (t) => {
  const { ctx, addProducts, save } = await setup(t);
  const [product] = await addProducts(1);
  const response = await save([{ title: "  Jordan 4  ", searchTerm: " jordan 4 ", productId: String(product._id).toUpperCase() }], 0);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.item.entries, [{ title: "Jordan 4", searchTerm: "jordan 4", productId: String(product._id) }]);
  assert.deepEqual((await ctx.request("GET", "/api/classics")).body.items.map((item) => item.searchTerm), ["jordan 4"]);
});

test("an intentional empty selection replaces the defaults", async (t) => {
  const { ctx, addProducts, card, save } = await setup(t);
  await ctx.models.Product.create(sampleProduct({ name: "Adidas Samba OG" }));
  const [product] = await addProducts(1);
  assert.equal((await save([card(product)], 0)).status, 200);
  const cleared = await save([], 1);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.item.entries, []);
  assert.deepEqual((await ctx.request("GET", "/api/classics")).body, { items: [], configured: true, version: 2 });
});

test("draft and deleted products are hidden publicly, warned to admins, and never back-filled", async (t) => {
  const { ctx, token, addProducts, card, save } = await setup(t);
  const products = await addProducts(4);
  assert.equal((await save(products.map(card), 0)).status, 200);
  await ctx.models.Product.updateOne({ _id: products[1]._id }, { $set: { status: "draft" } });
  await ctx.models.Product.deleteOne({ _id: products[2]._id });

  const publicRead = await ctx.request("GET", "/api/classics");
  assert.deepEqual(publicRead.body.items.map((item) => item.title), ["Card 1", "Card 4"]);
  assert.equal(JSON.stringify(publicRead.body).includes("Pair 2"), false);

  const adminRead = await ctx.request("GET", "/api/admin/classics", { token });
  assert.equal(adminRead.status, 200);
  assert.deepEqual(adminRead.body.item.entries.map((entry) => entry.title), ["Card 1", "Card 2", "Card 3", "Card 4"]);
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
  const body = { entries: [], expectedVersion: 0 };

  assert.equal((await ctx.request("GET", "/api/admin/classics")).status, 401);
  assert.equal((await ctx.request("PUT", "/api/admin/classics", { body })).status, 401);
  assert.equal((await ctx.request("PUT", "/api/admin/classics", { body, token: staleToken })).status, 401);
  assert.equal((await ctx.request("GET", "/api/admin/classics", { token: userToken(customer._id) })).status, 403);
  assert.equal((await ctx.request("PUT", "/api/admin/classics", { body, token: userToken(customer._id) })).status, 403);
  assert.equal(ctx.models.HomepageClassics.docs.length, 0);
  assert.equal((await save([], 0)).status, 200);
});

test("invalid selections are rejected with 400 and never mutate the stored selection", async (t) => {
  const { ctx, token, addProducts, card, save } = await setup(t);
  const products = await addProducts(7);
  assert.equal((await save([card(products[0])], 0)).status, 200);
  const id = String(products[1]._id);
  const valid = { title: "Jordan 4", searchTerm: "jordan 4", productId: id };
  const put = (body) => ctx.request("PUT", "/api/admin/classics", { token, body });

  const cases = [
    [{ entries: products.map(card), expectedVersion: 1 }, "entries"],
    [{ entries: [valid, { ...valid, title: "Other", productId: id.toUpperCase() }], expectedVersion: 1 }, "entries"],
    [{ entries: [{ ...valid, productId: "not-an-id" }], expectedVersion: 1 }, "entries.0.productId"],
    [{ entries: [{ ...valid, productId: { $gt: "" } }], expectedVersion: 1 }, "entries.0.productId"],
    [{ entries: [{ ...valid, productId: undefined }], expectedVersion: 1 }, "entries.0.productId"],
    [{ entries: [valid, { ...valid, title: "   " }], expectedVersion: 1 }, "entries.1.title"],
    [{ entries: [{ ...valid, title: "x".repeat(41) }], expectedVersion: 1 }, "entries.0.title"],
    [{ entries: [{ ...valid, title: 42 }], expectedVersion: 1 }, "entries.0.title"],
    [{ entries: [{ ...valid, title: "Bad\u0000title" }], expectedVersion: 1 }, "entries.0.title"],
    [{ entries: [{ ...valid, searchTerm: "" }], expectedVersion: 1 }, "entries.0.searchTerm"],
    [{ entries: [{ ...valid, searchTerm: "x".repeat(61) }], expectedVersion: 1 }, "entries.0.searchTerm"],
    [{ entries: [{ ...valid, searchTerm: "line\nbreak" }], expectedVersion: 1 }, "entries.0.searchTerm"],
    [{ entries: [{ ...valid, image: "https://evil.test/x.jpg" }], expectedVersion: 1 }, "entries.0.image"],
    [{ entries: ["card"], expectedVersion: 1 }, "entries.0"],
    [{ entries: valid, expectedVersion: 1 }, "entries"],
    [{ entries: [valid] }, "expectedVersion"],
    [{ entries: [valid], expectedVersion: -1 }, "expectedVersion"],
    [{ entries: [valid], expectedVersion: 1.5 }, "expectedVersion"],
    [{ entries: [valid], expectedVersion: "1" }, "expectedVersion"],
    [{ entries: [valid], expectedVersion: 1, version: 9 }, "version"],
    [[valid], "body"],
  ];
  for (const [body, field] of cases) {
    const response = await put(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.code, "INVALID_CLASSICS_SELECTION");
    assert.ok(response.body.fields[field], `${JSON.stringify(body)} -> ${JSON.stringify(response.body.fields)}`);
  }
  const malformed = await ctx.request("PUT", "/api/admin/classics", { token, body: "{not json" });
  assert.equal(malformed.status, 400);

  const stored = ctx.models.HomepageClassics.docs[0];
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.entries.map((entry) => String(entry.productId)), [String(products[0]._id)]);
});

test("missing or draft products return 422 without a partial save", async (t) => {
  const { ctx, addProducts, card, save } = await setup(t);
  const [visible] = await addProducts(1);
  const draft = await ctx.models.Product.create(sampleProduct({ name: "Draft pair", status: "draft" }));
  const missing = { _id: new Types.ObjectId() };

  const response = await save([card(visible, 0), card(draft, 1), card(missing, 2)], 0);
  assert.equal(response.status, 422);
  assert.equal(response.body.code, "INELIGIBLE_CLASSICS_PRODUCTS");
  assert.deepEqual(response.body.unavailable, [String(draft._id), String(missing._id)]);
  assert.equal(ctx.models.HomepageClassics.docs.length, 0);
});

test("stale versions return 409 and concurrent saves of one version yield one winner", async (t) => {
  const { ctx, addProducts, card, save } = await setup(t);
  const products = await addProducts(3);

  const firstSaves = await Promise.all([save([card(products[0])], 0), save([card(products[1])], 0)]);
  assert.deepEqual(firstSaves.map((response) => response.status).sort(), [200, 409]);
  assert.equal(firstSaves.find((response) => response.status === 409).body.code, "STALE_CLASSICS_SELECTION");

  const racing = await Promise.all([save([card(products[2])], 1), save([card(products[0]), card(products[1], 1)], 1)]);
  assert.deepEqual(racing.map((response) => response.status).sort(), [200, 409]);
  const stored = ctx.models.HomepageClassics.docs[0];
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.entries.map((entry) => String(entry.productId)), racing.find((response) => response.status === 200).body.item.entries.map((entry) => entry.productId));

  const stale = await save([card(products[2])], 1);
  assert.equal(stale.status, 409);
  assert.equal(ctx.models.HomepageClassics.docs[0].version, 2);
});

test("saving Classics leaves the Featured Sneakers selection untouched", async (t) => {
  const { ctx, token, addProducts, card, save } = await setup(t);
  const products = await addProducts(2);
  const featured = await ctx.request("PUT", "/api/admin/featured-sneakers", { token, body: { productIds: [String(products[0]._id)], expectedVersion: 0 } });
  assert.equal(featured.status, 200);
  assert.equal((await save([card(products[1])], 0)).status, 200);
  const publicFeatured = await ctx.request("GET", "/api/featured-sneakers");
  assert.deepEqual(publicFeatured.body.items.map((item) => item.name), ["Pair 1"]);
  assert.equal(publicFeatured.body.version, 1);
  assert.equal(ctx.models.FeaturedSneakers.docs.length, 1);
});

test("read and save failures return safe error codes without internal details", async () => {
  const failing = { findById: () => ({ lean: async () => { throw new Error("db down: secret detail"); } }) };
  const response = () => ({ statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } });
  const controller = createClassicsController({ HomepageClassics: failing, Product: { find: () => ({ lean: async () => [] }) } });

  const publicRes = response();
  await controller.getPublicClassics({}, publicRes);
  assert.deepEqual([publicRes.statusCode, publicRes.body], [500, { error: "Unable to load classics", code: "CLASSICS_READ_FAILED" }]);
  const adminRes = response();
  await controller.getAdminClassics({}, adminRes);
  assert.deepEqual([adminRes.statusCode, adminRes.body], [500, { error: "Unable to load classics selection", code: "CLASSICS_READ_FAILED" }]);

  const productId = String(new Types.ObjectId());
  const writer = createClassicsController({
    HomepageClassics: { findOneAndUpdate: () => ({ lean: async () => { throw new Error("write failed"); } }) },
    Product: { find: () => ({ lean: async () => [{ _id: productId, name: "Pair", status: "active" }] }) },
  });
  const saveRes = response();
  await writer.saveClassics({ body: { entries: [{ title: "Pair", searchTerm: "pair", productId }], expectedVersion: 3 }, user: { _id: "admin" } }, saveRes);
  assert.deepEqual([saveRes.statusCode, saveRes.body], [500, { error: "Unable to save classics selection", code: "CLASSICS_SAVE_FAILED" }]);
});
