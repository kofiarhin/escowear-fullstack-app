// IDE-114 against a real MongoDB (opt-in; see helpers/realDb.js). Covers the
// behaviour the in-memory model cannot prove: real unique indexes under
// concurrency, Mongoose casting/validation, select:false fields, legacy
// documents written in the old shape, and append-only events.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const { connectTestDb, skipReason } = require("./helpers/realDb");
const { newIdempotencyKey, sampleProduct, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");

test("IDE-114 guest orders on real MongoDB", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  const { models } = db;

  const setup = async () => {
    await db.reset();
    const ctx = await startTestApp({ models });
    const product = await models.Product.create(sampleProduct());
    return { ctx, product };
  };
  const place = (ctx, body, key = newIdempotencyKey(), extra = {}) =>
    ctx.request("POST", "/api/orders", { body, headers: { "Idempotency-Key": key }, ...extra });

  await t.test("indexes exist after the additive index step", async () => {
    const orderIndexes = (await models.Order.collection.indexes()).map((index) => index.name);
    ["unique_order_number", "unique_order_idempotency_key", "customer_email_created", "user_created", "status_created"].forEach((name) =>
      assert.ok(orderIndexes.includes(name), name)
    );
    assert.ok((await models.EmailOutbox.collection.indexes()).some((index) => index.name === "unique_email_dedupe_key" && index.unique));
    assert.ok((await models.OrderEvent.collection.indexes()).some((index) => index.name === "unique_event_dedupe_key" && index.unique));
  });

  await t.test("creates a server-priced order and hides internal fields", async () => {
    const { ctx, product } = await setup();
    try {
      const response = await place(ctx, validOrderBody(product._id, { items: [{ productId: String(product._id), size: "9", quantity: 2, price: 0.01 }] }));
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const stored = await models.Order.findById(response.body.orderId).select("+idempotencyKeyHash +requestFingerprint").lean();
      assert.equal(stored.status, "pending_contact");
      assert.equal(stored.items[0].unitPriceGBPMinor, 16499);
      assert.equal(stored.pricing.subtotalGBPMinor, 32998);
      assert.ok(stored.idempotencyKeyHash);
      const plain = await models.Order.findById(response.body.orderId).lean();
      assert.equal(plain.idempotencyKeyHash, undefined, "select:false keeps hashes out of normal reads");
      assert.equal(await models.EmailOutbox.countDocuments({ orderId: stored._id }), 1);
      assert.equal(await models.OrderEvent.countDocuments({ orderId: stored._id, type: "order_created" }), 1);
    } finally {
      await ctx.close();
    }
  });

  await t.test("10 concurrent submits with one key create exactly one order, event and email", async () => {
    const { ctx, product } = await setup();
    try {
      const key = newIdempotencyKey();
      const body = validOrderBody(product._id);
      const responses = await Promise.all(Array.from({ length: 10 }, () => place(ctx, body, key)));
      const statuses = responses.map((response) => response.status).sort();
      assert.equal(statuses.filter((status) => status === 201).length, 1, statuses.join(","));
      assert.ok(statuses.every((status) => status === 200 || status === 201), statuses.join(","));
      assert.equal(new Set(responses.map((response) => response.body.orderId)).size, 1);
      assert.equal(await models.Order.countDocuments({}), 1);
      assert.equal(await models.EmailOutbox.countDocuments({}), 1);
      assert.equal(await models.OrderEvent.countDocuments({ type: "order_created" }), 1);
    } finally {
      await ctx.close();
    }
  });

  await t.test("the database rejects duplicate order numbers and idempotency hashes", async () => {
    await db.reset();
    const base = { status: "pending_contact", orderNumber: "EW-AAAAA-BBBBB", idempotencyKeyHash: "a".repeat(64) };
    await models.Order.create(base);
    await assert.rejects(models.Order.create({ ...base, idempotencyKeyHash: "b".repeat(64) }), (error) => error.code === 11000);
    await assert.rejects(models.Order.create({ ...base, orderNumber: "EW-CCCCC-DDDDD" }), (error) => error.code === 11000);
    // Legacy orders have neither field; partial indexes must allow many of them.
    await models.Order.collection.insertMany([{ status: "Pending" }, { status: "Pending" }]);
  });

  await t.test("legacy documents in the pre-checkout shape stay readable for their owner", async () => {
    const { ctx, product } = await setup();
    try {
      const owner = await ctx.addUser();
      await models.Order.collection.insertOne({
        user: owner._id,
        products: [{ productId: product._id, size: "9", name: "Legacy sneaker", price: 99 }],
        status: "Pending",
        createdAt: new Date("2023-01-01"),
        updatedAt: new Date("2023-01-01"),
      });
      const list = await ctx.request("GET", "/api/orders", { token: userToken(owner._id) });
      assert.equal(list.status, 200);
      assert.equal(list.body.items.length, 1);
      assert.equal(list.body.items[0].legacy, true);
      assert.equal(list.body.items[0].items[0].name, "Legacy sneaker");
      const legacyId = list.body.items[0].id;
      assert.equal((await ctx.request("GET", `/api/orders/${legacyId}`, { token: userToken(owner._id) })).status, 200);
      assert.equal((await ctx.request("GET", `/api/orders/${legacyId}`)).status, 404);
    } finally {
      await ctx.close();
    }
  });

  await t.test("tampered and unavailable items are rejected; nothing is written", async () => {
    const { ctx, product } = await setup();
    try {
      const missing = await place(ctx, validOrderBody(new Types.ObjectId()));
      assert.equal(missing.status, 422);
      const badSize = await place(ctx, validOrderBody(product._id, { items: [{ productId: String(product._id), size: "UK 13", quantity: 1 }] }));
      assert.equal(badSize.status, 422);
      const injection = await place(ctx, validOrderBody(product._id, { items: [{ productId: { $ne: null }, size: "UK 9", quantity: 1 }] }));
      assert.equal(injection.status, 422);
      assert.equal(await models.Order.countDocuments({}), 0);
    } finally {
      await ctx.close();
    }
  });

  await t.test("order events are append-only", async () => {
    await db.reset();
    const event = await models.OrderEvent.create({ orderId: new Types.ObjectId(), actorType: "system", type: "order_created" });
    await assert.rejects(models.OrderEvent.updateOne({ _id: event._id }, { $set: { type: "tampered" } }), /append-only/);
    await assert.rejects(models.OrderEvent.deleteOne({ _id: event._id }), /append-only/);
    assert.equal((await models.OrderEvent.findById(event._id).lean()).type, "order_created");
  });

  await t.test("login refuses query operators", async () => {
    const { ctx } = await setup();
    try {
      await ctx.addUser({ email: "victim@example.test" });
      const response = await ctx.request("POST", "/api/users/login", { body: { email: { $gt: "" }, password: { $gt: "" } } });
      assert.equal(response.status, 400);
    } finally {
      await ctx.close();
    }
  });
});
