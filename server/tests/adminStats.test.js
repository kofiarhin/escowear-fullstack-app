// Admin overview stats (in-memory models; no MongoDB).
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, sampleProduct, userToken } = require("./helpers/testApp");
const { ATTENTION_STATUSES } = require("../controllers/adminStatsController");

let sequence = 0;
const seedOrder = (ctx, status, overrides = {}) => {
  sequence += 1;
  return ctx.models.Order.create({
    orderNumber: `EW-STATS-${String(sequence).padStart(5, "0")}`,
    status,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, sequence)),
    customer: { name: `Customer ${sequence}`, email: `c${sequence}@example.test`, emailNormalized: `c${sequence}@example.test`, phone: "+233241234567" },
    shippingAddress: { recipient: "Kojo", phone: "+233207654321", line1: "12 Ring Road", city: "Accra", region: "Greater Accra" },
    items: [{ productId: "p1", name: "Pair", size: "UK 9", quantity: 2 }],
    pricing: { subtotalGBPMinor: 16499 },
    payment: { status: "not_requested", proof: { id: "proof-1" } },
    idempotencyKeyHash: `hash-${sequence}`,
    requestFingerprint: `fingerprint-${sequence}`,
    internalNotes: [{ body: "internal only" }],
    ...overrides,
  });
};

test("admin stats require an admin session", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const customer = await ctx.addUser();

  assert.equal((await ctx.request("GET", "/api/admin/stats")).status, 401);
  assert.equal((await ctx.request("GET", "/api/admin/stats", { token: userToken(customer._id) })).status, 403);
});

test("admin stats report empty counts before anything exists", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });

  const response = await ctx.request("GET", "/api/admin/stats", { token: userToken(admin._id) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.body.orders.total, 0);
  assert.ok(Object.values(response.body.orders.byStatus).every((count) => count === 0));
  assert.deepEqual(response.body.products, { total: 0, published: 0, draft: 0 });
  assert.deepEqual(response.body.heroSlides, { total: 0, active: 0 });
  assert.deepEqual(response.body.featured, { count: 0, max: 4 });
  assert.deepEqual(response.body.recentOrders, []);
  assert.deepEqual(response.body.attentionOrders, []);
});

test("admin stats count orders, catalogue and homepage content with safe order summaries", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });

  for (const status of ["payment_review", "payment_review", "pending_contact", "processing", "completed", "completed", "cancelled", "awaiting_customer"]) await seedOrder(ctx, status);
  // Legacy orders without an order number stay out of every admin figure.
  await ctx.models.Order.create({ status: "Pending", products: [] });

  const products = await Promise.all([
    ctx.models.Product.create(sampleProduct()),
    ctx.models.Product.create(sampleProduct({ name: "Imported, no status", status: undefined })),
    ctx.models.Product.create(sampleProduct({ name: "Manual draft", status: "draft", source: { provider: "manual" } })),
  ]);
  await ctx.models.HeroSlide.create({ productId: products[0]._id, headline: "Live", order: 0, isActive: true });
  await ctx.models.HeroSlide.create({ productId: products[1]._id, headline: "Draft", order: 1, isActive: false });
  await ctx.models.FeaturedSneakers.create({ _id: "homepage", productIds: [products[0]._id, products[1]._id], version: 3 });

  const response = await ctx.request("GET", "/api/admin/stats", { token: userToken(admin._id) });
  assert.equal(response.status, 200);
  const { body } = response;

  assert.equal(body.orders.total, 8);
  assert.equal(body.orders.byStatus.payment_review, 2);
  assert.equal(body.orders.byStatus.pending_contact, 1);
  assert.equal(body.orders.byStatus.completed, 2);
  assert.equal(body.orders.byStatus.refunded, 0);
  assert.deepEqual(body.orders.attentionStatuses, ATTENTION_STATUSES);
  assert.deepEqual(body.products, { total: 3, published: 1, draft: 1 });
  assert.deepEqual(body.heroSlides, { total: 2, active: 1 });
  assert.deepEqual(body.featured, { count: 2, max: 4 });

  assert.equal(body.recentOrders.length, 5);
  assert.equal(body.recentOrders[0].orderNumber, "EW-STATS-00008");
  assert.deepEqual(body.attentionOrders.map((order) => order.status).sort(), ["payment_review", "payment_review", "pending_contact"].sort());
  assert.equal(body.attentionOrders[0].proofAwaitingReview, false);

  // Only the list summary fields leave the server.
  const serialized = JSON.stringify(body);
  for (const secret of ["idempotencyKeyHash", "requestFingerprint", "internalNotes", "internal only", "+233", "Ring Road", "proof-1", "password"]) {
    assert.equal(serialized.includes(secret), false, `stats must not expose ${secret}`);
  }
  assert.deepEqual(Object.keys(body.recentOrders[0].customer).sort(), ["email", "name"]);
});

test("admin stats cap list sizes and the featured count", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  for (let index = 0; index < 7; index += 1) await seedOrder(ctx, "payment_issue");
  await ctx.models.FeaturedSneakers.create({ _id: "homepage", productIds: Array.from({ length: 6 }, () => sampleProduct()._id), version: 1 });

  const { body } = await ctx.request("GET", "/api/admin/stats", { token: userToken(admin._id) });
  assert.equal(body.attentionOrders.length, 5);
  assert.equal(body.recentOrders.length, 5);
  assert.equal(body.featured.count, 4);
});

test("admin stats return a safe error when a model read fails", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  ctx.models.Product.countDocuments = async () => { throw new Error("private storage failure"); };
  const response = await ctx.request("GET", "/api/admin/stats", { token: userToken(admin._id) });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Dashboard figures could not be loaded", code: "SERVER_ERROR" });
});
