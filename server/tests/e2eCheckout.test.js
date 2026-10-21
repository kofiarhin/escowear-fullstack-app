// IDE-118: one end-to-end journey through the real HTTP app with in-memory
// models and a capturing mail transport. Uses no real money, emails or DB.
const test = require("node:test");
const assert = require("node:assert/strict");
const { newIdempotencyKey, sampleProduct, silentLogger, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");
const { runEmailWorkerTick } = require("../services/emailWorker");
const { createOrderService } = require("../services/orderService");

test("cart → guest order → acknowledgement → quote → proof → bank verification → fulfilment → tracking", async (t) => {
  const ctx = await startTestApp({ deps: { admin: { env: { ESCOWEAR_PAYMENT_INSTRUCTIONS: "E2E TEST CHANNEL — not a real account" } } } });
  t.after(ctx.close);
  const { models } = ctx;
  const product = await models.Product.create(sampleProduct({ price: 120.5, sizes: ["8", "9"] }));
  const admin = await ctx.addUser({ role: "admin" });
  const adminToken = userToken(admin._id);
  const inbox = [];
  let providerUp = false;
  const transport = {
    async send(message) {
      if (!providerUp) throw new Error("provider outage (simulated)");
      inbox.push(message);
      return { providerMessageId: `e2e-${inbox.length}` };
    },
  };
  const orderService = createOrderService({ ...models, config: ctx.config, logger: silentLogger });
  const deliver = () => runEmailWorkerTick({ ...models, orderService, transport, logger: silentLogger });

  // Storefront reads come from the same catalogue the order is priced from.
  const catalogue = await ctx.request("GET", "/api/products");
  assert.equal(catalogue.status, 200);
  assert.equal(catalogue.body.items[0].price, 120.5);
  assert.equal((await ctx.request("GET", `/api/products/${product._id}`)).body.name, product.name);

  // 1. Guest places an order (double click: same key twice).
  const key = newIdempotencyKey();
  const body = validOrderBody(product._id, { items: [{ productId: String(product._id), size: "UK 8", quantity: 2, price: 1 }] });
  const [first, second] = await Promise.all([
    ctx.request("POST", "/api/orders", { body, headers: { "Idempotency-Key": key } }),
    ctx.request("POST", "/api/orders", { body, headers: { "Idempotency-Key": key } }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(first.body.orderId, second.body.orderId);
  assert.equal(models.Order.docs.length, 1);
  const { orderId, orderNumber } = first.body;
  assert.equal(models.Order.docs[0].pricing.subtotalGBPMinor, 24100);

  // 2. Mail provider outage: the order survives and the email is retried later.
  await deliver();
  assert.equal(inbox.length, 0);
  assert.equal(models.EmailOutbox.docs[0].state, "queued");
  assert.equal(models.EmailOutbox.docs[0].attempts, 1);
  providerUp = true;
  models.EmailOutbox.docs[0].nextAttemptAt = new Date(Date.now() - 1000);
  await deliver();
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].subject, new RegExp(`order received — #${orderNumber}`));
  assert.match(inbox[0].text, /not a payment request/);

  // 3. Admin quotes in GHS and sends payment instructions.
  const act = (action, payload) => ctx.request("POST", `/api/admin/orders/${orderId}/${action}`, { body: payload, token: adminToken });
  assert.equal(
    (
      await act("payment-instructions", {
        expectedStatus: "pending_contact",
        quote: { subtotalMinor: 400000, feesMinor: 10000, shippingMinor: 25000, dutiesMinor: 5000, expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() },
      })
    ).status,
    200
  );
  await deliver();
  const instructions = inbox.find((mail) => /payment details/.test(mail.subject));
  assert.match(instructions.text, /E2E TEST CHANNEL/);
  assert.match(instructions.text, /reply to this email with a screenshot/i);

  // 4. Customer emails a screenshot (outside the app); admin records review, then the bank receipt.
  assert.equal((await act("payment-review", { expectedStatus: "awaiting_payment", note: "screenshot in mailbox" })).status, 200);
  assert.equal(models.Order.docs[0].payment.status, "under_review");
  const verify = await act("verify-payment", {
    expectedStatus: "payment_review",
    amountReceivedGHSMinor: 440000,
    bankReference: "E2E-BANK-REF",
    receivedAt: new Date(Date.now() - 60000).toISOString(),
    bankReceiptConfirmed: true,
  });
  assert.equal(verify.status, 200);
  await deliver();
  assert.ok(inbox.some((mail) => /order confirmed/.test(mail.subject)));

  // 5. Fulfilment.
  assert.equal((await act("fulfilment", { expectedStatus: "confirmed", toStatus: "processing", supplierReference: "E2E-SUPPLIER" })).status, 200);
  assert.equal((await act("fulfilment", { expectedStatus: "processing", toStatus: "dispatched", carrier: "E2E Courier", trackingNumber: "E2E123" })).status, 200);
  await deliver();
  assert.ok(inbox.some((mail) => /dispatched/.test(mail.text) && /E2E123/.test(mail.text)));

  // 6. Guest tracks with order number + email + emailed code.
  assert.equal(
    (await ctx.request("POST", "/api/orders/tracking/request", { body: { orderNumber, email: "ama.mensah@example.test" } })).status,
    202
  );
  await new Promise((resolve) => setTimeout(resolve, 50)); // code is issued after the 202
  await deliver();
  const codeMail = inbox.find((mail) => /tracking code/.test(mail.subject));
  const code = codeMail.text.match(/is: (\d{6})/)[1];
  assert.ok(!JSON.stringify(models.EmailOutbox.docs).includes(code), "code purged from the outbox after sending");
  const verified = await ctx.request("POST", "/api/orders/tracking/verify", { body: { orderNumber, email: "ama.mensah@example.test", code } });
  assert.equal(verified.status, 200);
  const view = await ctx.request("GET", `/api/orders/${orderId}`, { headers: { "X-Order-Access-Token": verified.body.accessToken } });
  assert.equal(view.status, 200);
  assert.equal(view.body.status, "dispatched");
  assert.equal(view.body.fulfilment.trackingNumber, "E2E123");
  assert.ok(!JSON.stringify(view.body).match(/E2E-BANK-REF|E2E-SUPPLIER|E2E TEST CHANNEL|screenshot in mailbox/));

  // 7. Delivery and completion; every email was sent exactly once.
  assert.equal((await act("fulfilment", { expectedStatus: "dispatched", toStatus: "delivered" })).status, 200);
  assert.equal((await act("fulfilment", { expectedStatus: "delivered", toStatus: "completed" })).status, 200);
  await deliver();
  await deliver();
  const subjects = inbox.map((mail) => mail.subject);
  assert.equal(new Set(subjects.map((subject, index) => `${subject}|${inbox[index].text}`)).size, subjects.length, "no duplicate sends");
  assert.equal(models.EmailOutbox.docs.every((message) => message.state === "sent"), true);
  assert.equal(models.Order.docs[0].status, "completed");
});
