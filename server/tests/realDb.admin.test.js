// IDE-116 against a real MongoDB (opt-in; see helpers/realDb.js): admin
// workflow, compare-and-set under real concurrency, concurrent outbox workers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { connectTestDb, skipReason } = require("./helpers/realDb");
const { newIdempotencyKey, sampleProduct, silentLogger, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");
const { processOutboxBatch } = require("../services/emailOutbox");

test("IDE-116 admin manual payment on real MongoDB", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  const { models } = db;
  const env = { ESCOWEAR_PAYMENT_INSTRUCTIONS: "REAL-DB TEST CHANNEL" };

  const setup = async () => {
    await db.reset();
    const ctx = await startTestApp({ models, deps: { admin: { env } } });
    const product = await models.Product.create(sampleProduct());
    const admin = await ctx.addUser({ role: "admin" });
    const placed = await ctx.request("POST", "/api/orders", { body: validOrderBody(product._id), headers: { "Idempotency-Key": newIdempotencyKey() } });
    assert.equal(placed.status, 201);
    const token = userToken(admin._id);
    const act = (action, body) => ctx.request("POST", `/api/admin/orders/${placed.body.orderId}/${action}`, { body, token });
    return { ctx, admin, token, placed, act };
  };
  const quote = (overrides = {}) => ({
    subtotalMinor: 300000, feesMinor: 5000, shippingMinor: 20000, dutiesMinor: 0,
    expiresAt: new Date(Date.now() + 86400000).toISOString(), ...overrides,
  });

  await t.test("role checks use the stored role; registration cannot grant admin", async () => {
    const { ctx, placed } = await setup();
    try {
      const customer = await ctx.addUser();
      assert.equal((await ctx.request("GET", "/api/admin/orders", { token: userToken(customer._id) })).status, 403);
      const registered = await ctx.request("POST", "/api/users/register", { body: { name: "Mallory", email: "mallory@example.test", password: "pw-123456", role: "admin" } });
      assert.equal(registered.status, 201);
      const stored = await models.User.findOne({ email: "mallory@example.test" }).lean();
      assert.equal(stored.role, "customer");
      assert.equal((await ctx.request("GET", `/api/admin/orders/${placed.body.orderId}`, { token: userToken(stored._id) })).status, 403);
    } finally {
      await ctx.close();
    }
  });

  await t.test("full flow persists quote, verification, fulfilment and audit trail", async () => {
    const { ctx, act, admin, placed, token } = await setup();
    try {
      assert.equal((await act("payment-instructions", { expectedStatus: "pending_contact", quote: quote() })).status, 200);
      assert.equal((await act("payment-review", { expectedStatus: "awaiting_payment", note: "screenshot" })).status, 200);
      const verified = await act("verify-payment", {
        expectedStatus: "payment_review", amountReceivedGHSMinor: 325000, bankReference: "RDB-1",
        receivedAt: new Date(Date.now() - 1000).toISOString(), bankReceiptConfirmed: true,
      });
      assert.equal(verified.status, 200, JSON.stringify(verified.body));
      assert.equal((await act("fulfilment", { expectedStatus: "confirmed", toStatus: "processing" })).status, 200);
      assert.equal((await act("fulfilment", { expectedStatus: "processing", toStatus: "dispatched", carrier: "C", trackingNumber: "T1" })).status, 200);
      assert.equal((await ctx.request("POST", `/api/admin/orders/${placed.body.orderId}/notes`, { token, body: { body: "internal" } })).status, 201);

      const order = await models.Order.findById(placed.body.orderId).select("+internalNotes").lean();
      assert.equal(order.status, "dispatched");
      assert.equal(order.pricing.finalGHS.totalMinor, 325000);
      assert.equal(String(order.pricing.finalGHS.quotedBy), String(admin._id));
      assert.ok(order.pricing.finalGHS.expiresAt instanceof Date);
      assert.equal(order.payment.status, "verified");
      assert.equal(String(order.payment.verifiedBy), String(admin._id));
      assert.equal(order.internalNotes[0].body, "internal");
      assert.equal((await models.Order.findById(placed.body.orderId).lean()).internalNotes, undefined, "notes are select:false");
      const types = (await models.OrderEvent.find({ orderId: order._id }).sort({ createdAt: 1 }).lean()).map((event) => event.type);
      assert.deepEqual(types, ["order_created", "quote_sent", "payment_proof_received", "payment_verified", "fulfilment_processing", "fulfilment_dispatched", "note_added"]);

      const detail = await ctx.request("GET", `/api/admin/orders/${placed.body.orderId}`, { token });
      assert.equal(detail.status, 200);
      assert.equal(detail.body.idempotencyKeyHash, undefined);
      const customer = await ctx.request("GET", `/api/orders/${placed.body.orderId}`, { headers: { "X-Order-Access-Token": placed.body.trackingHandoff.accessToken } });
      assert.ok(!/RDB-1|internal|REAL-DB TEST CHANNEL/.test(JSON.stringify(customer.body)));
    } finally {
      await ctx.close();
    }
  });

  await t.test("concurrent verify / issue / re-quote: exactly one wins per state", async () => {
    const { ctx, act } = await setup();
    try {
      const quotes = await Promise.all(Array.from({ length: 5 }, () => act("payment-instructions", { expectedStatus: "pending_contact", quote: quote() })));
      assert.deepEqual(quotes.map((response) => response.status).sort(), [200, 409, 409, 409, 409]);
      const requotes = await Promise.all(Array.from({ length: 5 }, () => act("payment-instructions", { expectedStatus: "awaiting_payment", expectedQuoteVersion: 1, quote: quote({ feesMinor: 6000 }) })));
      assert.equal(requotes.filter((response) => response.status === 200).length, 1, requotes.map((r) => r.status).join(","));
      await act("payment-review", { expectedStatus: "awaiting_payment" });
      const order = await models.Order.findOne({}).lean();
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () =>
          act("verify-payment", {
            expectedStatus: "payment_review", amountReceivedGHSMinor: order.pricing.finalGHS.totalMinor, bankReference: "RDB-2",
            receivedAt: new Date(Date.now() - 1000).toISOString(), bankReceiptConfirmed: true,
          })
        ),
        act("payment-issue", { expectedStatus: "payment_review", customerMessage: "Something is wrong with this payment." }),
      ]);
      assert.equal(results.filter((response) => response.status === 200).length, 1, results.map((r) => r.status).join(","));
      assert.equal(await models.EmailOutbox.countDocuments({ kind: { $in: ["order_confirmed", "payment_issue"] } }), 1);
      assert.equal(await models.EmailOutbox.countDocuments({ kind: "payment_instructions" }), 2);
    } finally {
      await ctx.close();
    }
  });

  await t.test("three concurrent workers send each queued email exactly once", async () => {
    const { ctx, act } = await setup();
    try {
      await act("payment-instructions", { expectedStatus: "pending_contact", quote: quote() });
      const sent = [];
      const transport = { send: async (message) => { sent.push(message.idempotencyKey); await new Promise((resolve) => setTimeout(resolve, 20)); return { providerMessageId: "x" }; } };
      await Promise.all(Array.from({ length: 3 }, () => processOutboxBatch({ EmailOutbox: models.EmailOutbox, Order: models.Order, transport, logger: silentLogger })));
      assert.equal(sent.length, 2);
      assert.equal(new Set(sent).size, 2);
      const instructions = await models.EmailOutbox.findOne({ kind: "payment_instructions" }).lean();
      assert.equal(instructions.state, "sent");
      assert.ok(!instructions.payload.text.includes("REAL-DB TEST CHANNEL"), "body purged after send");
      assert.equal((await models.Order.findOne({}).lean()).email.paymentInstructionState, "sent");
    } finally {
      await ctx.close();
    }
  });

  await t.test("login does not reveal whether an account exists", async () => {
    const { ctx } = await setup();
    try {
      await ctx.request("POST", "/api/users/register", { body: { name: "Real", email: "real@example.test", password: "correct-horse" } });
      const unknown = await ctx.request("POST", "/api/users/login", { body: { email: "nobody@example.test", password: "x" } });
      const wrong = await ctx.request("POST", "/api/users/login", { body: { email: "real@example.test", password: "x" } });
      assert.deepEqual([unknown.status, unknown.body], [wrong.status, wrong.body]);
      const ok = await ctx.request("POST", "/api/users/login", { body: { email: "REAL@example.test", password: "correct-horse" } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.role, "customer");
    } finally {
      await ctx.close();
    }
  });
});
