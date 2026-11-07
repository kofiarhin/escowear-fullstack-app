const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const { startTestApp, sampleProduct, userToken } = require("./helpers/testApp");

const createSlide = (productId, overrides = {}) => ({
  productId: String(productId),
  headline: "A SHOE WORTH THE JOURNEY",
  description: "Authentic pairs sourced in the UK.",
  desktopImage: "",
  mobileImage: "",
  order: 0,
  isActive: false,
  ...overrides,
});

test("public hero slides return only active, resolved products in stable order", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const first = await ctx.models.Product.create(sampleProduct({ name: "First pair", image: "https://images.example.test/first.jpg" }));
  const second = await ctx.models.Product.create(sampleProduct({ title: "Legacy pair", name: "", image: "", images: ["https://images.example.test/second.jpg"] }));
  await ctx.models.HeroSlide.create(createSlide(first._id, { order: 3, isActive: true }));
  await ctx.models.HeroSlide.create(createSlide(second._id, { order: 1, isActive: true, desktopImage: "/images/hero/second.jpg" }));
  await ctx.models.HeroSlide.create(createSlide(new Types.ObjectId(), { order: 0, isActive: true }));
  const draft = await ctx.models.Product.create(sampleProduct({ name: "Draft", status: "draft" }));
  await ctx.models.HeroSlide.create(createSlide(draft._id, { order: 0, isActive: true }));

  const response = await ctx.request("GET", "/api/hero-slides");
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 2);
  assert.deepEqual(response.body.items.map((item) => item.productName), ["Legacy pair", "First pair"]);
  assert.equal(response.body.items[0].desktopImage, "/images/hero/second.jpg");
  assert.equal(response.body.items[0].mobileImage, "/images/hero/second.jpg");
  assert.equal(response.body.items[0].productInStock, true);
  assert.deepEqual(Object.keys(response.body.items[0]).sort(), ["description", "desktopImage", "headline", "id", "mobileImage", "order", "productId", "productInStock", "productName"].sort());
});

test("admin hero CRUD validates fields, product references, images and duplicate products", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const product = await ctx.models.Product.create(sampleProduct());
  const alternate = await ctx.models.Product.create(sampleProduct({ name: "Alternate pair" }));
  const token = userToken(admin._id);

  assert.equal((await ctx.request("GET", "/api/admin/hero-slides")).status, 401);
  assert.equal((await ctx.request("GET", "/api/admin/hero-slides", { token: userToken((await ctx.addUser())._id) })).status, 403);
  assert.equal((await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(product._id, { desktopImage: "javascript:alert(1)" }) })).status, 400);
  assert.equal((await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(new Types.ObjectId()) })).status, 404);

  const created = await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(product._id, { order: 2, desktopImage: "https://cdn.example.test/hero.jpg" }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.product.name, "Nike Air Max Dn8");
  const id = created.body.item.id;
  assert.equal((await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(product._id, { order: 1 }) })).status, 409);
  assert.equal((await ctx.request("PATCH", `/api/admin/hero-slides/${id}`, { token, body: { unknown: true } })).status, 400);
  assert.equal((await ctx.request("PATCH", `/api/admin/hero-slides/not-an-id`, { token, body: { headline: "Valid" } })).status, 400);
  const updated = await ctx.request("PATCH", `/api/admin/hero-slides/${id}`, { token, body: { productId: String(alternate._id), headline: "UPDATED HEADLINE", description: "", mobileImage: "/images/hero/mobile.jpg", isActive: true } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.productId, String(alternate._id));
  assert.equal(updated.body.item.isActive, true);
  assert.equal((await ctx.request("DELETE", `/api/admin/hero-slides/${id}`, { token })).status, 204);
  assert.equal((await ctx.request("GET", "/api/admin/hero-slides", { token })).body.items.length, 0);
});

test("admin rejects a ninth active slide without partial writes, including concurrent requests", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const products = await Promise.all(Array.from({ length: 10 }, (_, index) => ctx.models.Product.create(sampleProduct({ name: `Pair ${index}` }))));
  for (let index = 0; index < 7; index += 1) {
    const result = await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(products[index]._id, { order: index, isActive: true }) });
    assert.equal(result.status, 201);
  }
  const results = await Promise.all([7, 8, 9].map((index) => ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(products[index]._id, { order: index, isActive: true }) })));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 409).length, 2);
  assert.equal(ctx.models.HeroSlide.docs.filter((slide) => slide.isActive).length, 8);
});
