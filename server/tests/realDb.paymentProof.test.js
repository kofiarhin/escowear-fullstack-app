// IDE-129 against a real MongoDB (opt-in; see helpers/realDb.js): proof upload
// with real conditional updates, unique idempotency index, concurrency, and the
// full journey through verification, fulfilment and completion.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { connectTestDb, skipReason } = require("./helpers/realDb");
const { newIdempotencyKey, sampleProduct, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");

const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((name) => fs.statSync(path.join(dir, name)).isFile()) : []);
const png = (width) => sharp({ create: { width, height: 400, channels: 3, background: "#225533" } }).png().toBuffer();

test("IDE-129 payment proof on real MongoDB", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  const { models } = db;
  const env = { ESCOWEAR_PAYMENT_INSTRUCTIONS: "REAL-DB TEST CHANNEL" };

  const setup = async () => {
    await db.reset();
    const ctx = await startTestApp({ models, deps: { admin: { env }, orders: { env } } });
    const product = await models.Product.create(sampleProduct());
    const admin = await ctx.addUser({ role: "admin" });
    const token = userToken(admin._id);
    const placed = await ctx.request("POST", "/api/orders", { body: validOrderBody(product._id), headers: { "Idempotency-Key": newIdempotencyKey() } });
    assert.equal(placed.status, 201);
    const orderId = placed.body.orderId;
    const act = (action, body) => ctx.request("POST", `/api/admin/orders/${orderId}/${action}`, { body, token });
    const quoted = await act("payment-instructions", {
      expectedStatus: "pending_contact",
      quote: { subtotalMinor: 300000, feesMinor: 5000, shippingMinor: 20000, dutiesMinor: 0, expiresAt: new Date(Date.now() + 86400000).toISOString() },
    });
    assert.equal(quoted.status, 200);
    const upload = async (image, { key = newIdempotencyKey(), reference = "REALDB-TXN-1" } = {}) => {
      const form = new FormData();
      form.append("transactionReference", reference);
      form.append("quoteVersion", "1");
      form.append("proofImage", new Blob([image], { type: "image/png" }), "p.png");
      const response = await fetch(`${ctx.base}/api/orders/${orderId}/payment-proof`, {
        method: "POST",
        headers: { "Idempotency-Key": key, "X-Order-Proof-Token": placed.body.trackingHandoff.proofToken },
        body: form,
      });
      return { status: response.status, body: await response.json() };
    };
    return { ctx, token, orderId, act, upload, placed };
  };

  await t.test("concurrent uploads: one proof, one transition, unique idempotency index holds", async () => {
    const { ctx, orderId, upload } = await setup();
    try {
      const images = await Promise.all([300, 310, 320, 330, 340].map(png));
      const results = await Promise.all(images.map((image, index) => upload(image, { reference: `REALDB-${index}` })));
      // Exactly one wins; the rest are refused (409 conflict, or 503 from the in-flight upload cap).
      const statuses = results.map((result) => result.status);
      assert.equal(statuses.filter((status) => status === 201).length, 1, statuses.join(","));
      assert.ok(statuses.every((status) => [201, 409, 503].includes(status)), statuses.join(","));
      assert.equal(await models.PaymentProof.countDocuments({ orderId }), 1);
      assert.equal(files(ctx.proofDir).length, 1);
      const order = await models.Order.findById(orderId).lean();
      assert.equal(order.status, "payment_review");
      assert.equal(order.payment.status, "under_review");

      // Same idempotency key twice in parallel on a fresh order: one record.
      await db.reset();
      const second = await setup();
      const key = newIdempotencyKey();
      const image = await png(360);
      const pair = await Promise.all([second.upload(image, { key }), second.upload(image, { key })]);
      const pairStatuses = pair.map((result) => result.status).sort();
      assert.ok(["200,201", "201,409"].includes(pairStatuses.join(",")), pairStatuses.join(","));
      assert.equal(await models.PaymentProof.countDocuments({}), 1);
      assert.equal(files(second.ctx.proofDir).length, 1);
      await second.ctx.close();
    } finally {
      await ctx.close();
    }
  });

  await t.test("full journey: upload → bank-verified → sourced → dispatched → delivered → completed", async () => {
    const { ctx, token, orderId, act, upload, placed } = await setup();
    try {
      const uploaded = await upload(await png(400));
      assert.equal(uploaded.status, 201);
      assert.equal((await act("fulfilment", { expectedStatus: "payment_review", toStatus: "processing" })).status, 409);
      const verified = await act("verify-payment", {
        expectedStatus: "payment_review",
        amountReceivedGHSMinor: 325000,
        bankReference: "REALDB-TXN-1",
        receivedAt: new Date(Date.now() - 60000).toISOString(),
        bankReceiptConfirmed: true,
      });
      assert.equal(verified.status, 200);
      assert.equal((await models.PaymentProof.findById(uploaded.body.proofId).lean()).reviewStatus, "accepted");
      for (const [expectedStatus, toStatus, extra] of [
        ["confirmed", "processing", { supplierReference: "UK-1" }],
        ["processing", "dispatched", { carrier: "DHL", trackingNumber: "D1" }],
        ["dispatched", "delivered", {}],
        ["delivered", "completed", {}],
      ]) {
        const result = await act("fulfilment", { expectedStatus, toStatus, ...extra });
        assert.equal(result.status, 200, `${toStatus}: ${JSON.stringify(result.body)}`);
      }
      const image = await fetch(`${ctx.base}/api/admin/orders/${orderId}/payment-proof/${uploaded.body.proofId}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(image.status, 200);
      const view = await ctx.request("GET", `/api/orders/${orderId}`, { headers: { "X-Order-Access-Token": placed.body.trackingHandoff.accessToken } });
      assert.equal(view.body.status, "completed");
      assert.deepEqual(
        view.body.history.map((entry) => entry.status),
        ["pending_contact", "awaiting_payment", "payment_review", "confirmed", "processing", "dispatched", "delivered", "completed"]
      );
      const kinds = (await models.EmailOutbox.find({ orderId }).lean()).map((message) => message.kind);
      for (const kind of ["order_received", "payment_instructions", "payment_proof_received", "order_confirmed", "order_status"]) assert.ok(kinds.includes(kind), kind);
      assert.equal(kinds.filter((kind) => kind === "order_confirmed").length, 1);
    } finally {
      await ctx.close();
    }
  });
});
