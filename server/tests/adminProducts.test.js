const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const Product = require("../Models/Product.model");
const { startTestApp, sampleProduct, userToken, validOrderBody, newIdempotencyKey } = require("./helpers/testApp");

const draftPayload = (overrides = {}) => ({ name: "Nike P-6000", price: 124.99, brand: "Nike", category: "Trainers", sizes: ["7", "8"], inStock: true, ...overrides });
const version = (item) => ({ "If-Unmodified-Since": new Date(item.updatedAt).toISOString() });

test("manual draft schema permits absent name and price while imported products retain required fields", async () => {
  await new Product({ source: { provider: "manual" }, status: "draft" }).validate();
  await assert.rejects(() => new Product({ source: { provider: "banging-prices" }, status: "draft" }).validate());
  await assert.rejects(() => new Product({ source: { provider: "manual" }, status: "active" }).validate());
});

test("admin brands are derived, deduplicated, sorted, and enforced on product writes", async (t) => {
  const ctx = await startTestApp(); t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" }); const token = userToken(admin._id);
  await ctx.models.Product.create(sampleProduct({ brand: "nike" }));
  await ctx.models.Product.create(sampleProduct({ brand: "NIKE" }));
  await ctx.models.Product.create(sampleProduct({ brand: "Nike" }));
  await ctx.models.Product.create(sampleProduct({ brand: "adidas" }));
  const brands = await ctx.request("GET", "/api/admin/products/brands", { token });
  assert.equal(brands.status, 200);
  assert.deepEqual(brands.body.items, ["adidas", "Nike"]);
  assert.equal((await ctx.request("GET", "/api/admin/products/brands")).status, 401);
  const created = await ctx.request("POST", "/api/admin/products", { token, body: draftPayload({ brand: "nIkE" }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.brand, "Nike");
  const rejected = await ctx.request("POST", "/api/admin/products", { token, body: draftPayload({ brand: "Unknown Brand" }) });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.fields.brand, "Select a brand from the available brands");
});

test("admin products accept predefined and custom colour selections without losing legacy values", async (t) => {
  const ctx = await startTestApp(); t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" }); const token = userToken(admin._id);
  await ctx.models.Product.create(sampleProduct());
  const created = await ctx.request("POST", "/api/admin/products", { token, body: draftPayload({ colors: ["black", "WHITE", "Red", "Seafoam", "seafoam"] }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.color, "Black");
  assert.deepEqual(created.body.item.colors, ["Black", "White", "Red", "Seafoam"]);
  const reopened = await ctx.request("GET", `/api/admin/products/${created.body.item._id}`, { token });
  assert.deepEqual(reopened.body.item.colors, ["Black", "White", "Red", "Seafoam"]);
  const deduplicated = await ctx.request("POST", "/api/admin/products", { token, body: draftPayload({ colors: ["Black", "black"] }) });
  assert.equal(deduplicated.status, 201);
  assert.deepEqual(deduplicated.body.item.colors, ["Black"]);
});

test("legacy imported product titles supply brands when historical records have no brand field", async (t) => {
  const ctx = await startTestApp(); t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" }); const token = userToken(admin._id);
  await ctx.models.Product.create(sampleProduct({ brand: undefined, title: "New Balance 9060", name: undefined }));
  await ctx.models.Product.create(sampleProduct({ brand: undefined, title: "New Balance 740", name: undefined }));
  await ctx.models.Product.create(sampleProduct({ brand: undefined, title: "Nike Air Max 95", name: undefined }));
  await ctx.models.Product.create(sampleProduct({ brand: undefined, title: "Nike P-6000", name: undefined }));
  const brands = await ctx.request("GET", "/api/admin/products/brands", { token });
  assert.deepEqual(brands.body.items, ["New Balance", "Nike"]);
});

test("manufacturer extraction never exposes product model names as brands", async (t) => {
  const ctx = await startTestApp(); t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" }); const token = userToken(admin._id);
  await ctx.models.Product.create(sampleProduct({ brand: undefined, title: "NikeCourt Borough Low", name: undefined, storeName: "Nike" }));
  await ctx.models.Product.create(sampleProduct({ brand: undefined, title: "NikeSKIMS Rift Satin", name: undefined, storeName: "Nike" }));
  await ctx.models.Product.create(sampleProduct({ brand: undefined, title: "Air Jordan 1 Low", name: undefined, storeName: "Nike" }));
  await ctx.models.Product.create(sampleProduct({ brand: undefined, title: "Black trainers", name: undefined, storeName: "ASOS" }));
  const brands = await ctx.request("GET", "/api/admin/products/brands", { token });
  assert.deepEqual(brands.body.items, ["Jordan", "Nike"]);
  assert.equal(brands.body.items.includes("NikeCourt Borough"), false);
  assert.equal(brands.body.items.includes("NikeSKIMS Rift"), false);
});

test("admin product lifecycle protects imported records and detects stale changes", async (t) => {
  const ctx = await startTestApp(); t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" }); const customer = await ctx.addUser(); const token = userToken(admin._id);
  await ctx.models.Product.create(sampleProduct());
  assert.equal((await ctx.request("GET", "/api/admin/products")).status, 401);
  assert.equal((await ctx.request("GET", "/api/admin/products", { token: userToken(customer._id) })).status, 403);
  assert.equal((await ctx.request("POST", "/api/admin/products", { token, body: { status: "active" } })).status, 400);
  const created = await ctx.request("POST", "/api/admin/products", { token, body: {} });
  assert.equal(created.status, 201); assert.equal(created.body.item.status, "draft"); assert.equal(created.body.item.source.provider, "manual"); assert.equal(created.body.item.inStock, false);
  const id = created.body.item._id;
  const list = await ctx.request("GET", "/api/admin/products?status=draft&source=manual", { token });
  assert.equal(list.status, 200); assert.equal(list.body.items.length, 1);
  const incompletePublish = await ctx.request("PATCH", `/api/admin/products/${id}/publish`, { token, headers: version(created.body.item) });
  assert.equal(incompletePublish.status, 422); assert.ok(incompletePublish.body.fields.name);
  const saved = await ctx.request("PATCH", `/api/admin/products/${id}`, { token, headers: version(created.body.item), body: draftPayload() });
  assert.equal(saved.status, 200); assert.equal(saved.body.item.status, "draft");
  const stale = await ctx.request("PATCH", `/api/admin/products/${id}`, { token, headers: version(created.body.item), body: { color: "Black" } });
  assert.equal(stale.status, 409);
  const imported = await ctx.models.Product.create(sampleProduct({ source: { provider: "banging-prices", canonicalKey: "nike:test" } }));
  const importedEdit = await ctx.request("PATCH", `/api/admin/products/${imported._id}`, { token, headers: version(imported), body: { color: "Black" } });
  assert.equal(importedEdit.status, 409);
});

test("only server-owned images can publish a manual product and drafts stay out of public routes", async (t) => {
  const ctx = await startTestApp(); t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" }); const otherAdmin = await ctx.addUser({ role: "admin" }); const token = userToken(admin._id);
  await ctx.models.Product.create(sampleProduct());
  const pending = await ctx.models.ProductImageUpload.create({ publicId: "escowear/manual-products/one", secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/one.webp", ownerId: admin._id, expiresAt: new Date(Date.now() + 60_000) });
  const body = { ...draftPayload({ sizes: ["9"] }), images: [pending.secureUrl], managedImages: [{ publicId: pending.publicId, secureUrl: pending.secureUrl }] };
  const created = await ctx.request("POST", "/api/admin/products", { token, body });
  assert.equal(created.status, 201); assert.equal(created.body.item.image, pending.secureUrl);
  assert.equal((await ctx.request("GET", "/api/products")).body.items.some((item) => String(item._id) === String(created.body.item._id)), false);
  assert.equal((await ctx.request("GET", `/api/products/${created.body.item._id}`)).status, 404);
  const hijack = await ctx.request("POST", "/api/admin/products", { token: userToken(otherAdmin._id), body: { images: [pending.secureUrl], managedImages: [{ publicId: pending.publicId, secureUrl: pending.secureUrl }] } });
  assert.equal(hijack.status, 422);
  const published = await ctx.request("PATCH", `/api/admin/products/${created.body.item._id}/publish`, { token, headers: version(created.body.item) });
  assert.equal(published.status, 200); assert.equal(published.body.item.status, "active");
  const publicList = await ctx.request("GET", "/api/products");
  assert.equal(publicList.body.items.some((item) => String(item._id) === String(created.body.item._id)), true);
  const order = await ctx.request("POST", "/api/orders", { headers: { "Idempotency-Key": newIdempotencyKey() }, body: validOrderBody(created.body.item._id, { items: [{ productId: String(created.body.item._id), size: "UK 9", quantity: 1 }] }) });
  assert.equal(order.status, 201);
  assert.equal((await ctx.request("GET", `/api/products/${created.body.item._id}`)).status, 200);
  const unpublished = await ctx.request("PATCH", `/api/admin/products/${created.body.item._id}/unpublish`, { token, headers: version(published.body.item) });
  assert.equal(unpublished.status, 200); assert.equal((await ctx.request("GET", `/api/products/${created.body.item._id}`)).status, 404);
});

test("admin galleries retain imported URLs, allow mixed image sources, and keep imported fields read-only", async (t) => {
  const ctx = await startTestApp(); t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" }); const token = userToken(admin._id);
  const imported = await ctx.models.Product.create(sampleProduct({
    name: undefined,
    title: "Nike Air Max 95",
    source: { provider: "banging-prices", canonicalKey: "nike:air-max-95" },
    image: "https://catalogue.example.test/air-max-cover.jpg",
    images: ["https://catalogue.example.test/air-max-cover.jpg", "https://catalogue.example.test/air-max-side.jpg"],
  }));
  const opened = await ctx.request("GET", `/api/admin/products/${imported._id}`, { token });
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body.item.images, imported.images);
  const gallery = ["https://catalogue.example.test/air-max-side.jpg", "https://cdn.example.test/admin-detail.webp"];
  const saved = await ctx.request("PATCH", `/api/admin/products/${imported._id}`, { token, headers: version(opened.body.item), body: { images: gallery, managedImages: [] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.item.images, gallery);
  assert.equal(saved.body.item.image, gallery[0]);
  assert.equal(saved.body.item.title, "Nike Air Max 95");
  assert.equal((await ctx.request("GET", `/api/products/${imported._id}`)).status, 200);
  const nonImageEdit = await ctx.request("PATCH", `/api/admin/products/${imported._id}`, { token, headers: version(saved.body.item), body: { brand: "Nike" } });
  assert.equal(nonImageEdit.status, 409);
  const invalidUrl = await ctx.request("POST", "/api/admin/products", { token, body: draftPayload({ images: ["javascript:alert(1)"], managedImages: [] }) });
  assert.equal(invalidUrl.status, 422);
});

test("admin image endpoint is authenticated before multipart parsing", async (t) => {
  const ctx = await startTestApp(); t.after(ctx.close);
  const response = await fetch(`${ctx.base}/api/admin/products/images`, { method: "POST", body: new FormData() });
  assert.equal(response.status, 401);
});
