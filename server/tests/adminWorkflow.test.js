const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const { newIdempotencyKey, sampleProduct, silentLogger, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");
const { processOutboxBatch, backoffMs } = require("../services/emailOutbox");
const { runEmailWorkerTick } = require("../services/emailWorker");
const { TRANSITIONS, allowedActions } = require("../services/orderWorkflow");
const { createTransportFromEnv } = require("../emails/transports");
const { run: setRole } = require("../scripts/setUserRole");

const TEST_CHANNEL = "TEST PAYMENT CHANNEL\\nNot a real account";

const setup = async (t, { env = { ESCOWEAR_PAYMENT_INSTRUCTIONS: TEST_CHANNEL } } = {}) => {
  const ctx = await startTestApp({ deps: { admin: { env } } });
  t.after(ctx.close);
  const product = await ctx.models.Product.create(sampleProduct());
  const admin = await ctx.addUser({ role: "admin", name: "Esco Admin" });
  const customer = await ctx.addUser();
  const adminToken = userToken(admin._id);
  const placed = await ctx.request("POST", "/api/orders", {
    body: validOrderBody(product._id),
    headers: { "Idempotency-Key": newIdempotencyKey() },
  });
  assert.equal(placed.status, 201);
  const orderId = placed.body.orderId;
  const act = (action, body, token = adminToken) => ctx.request("POST", `/api/admin/orders/${orderId}/${action}`, { body, token });
  const detail = async () => (await ctx.request("GET", `/api/admin/orders/${orderId}`, { token: adminToken })).body;
  return { ...ctx, product, admin, customer, adminToken, orderId, placed, act, detail };
};

const futureIso = (hours = 48) => new Date(Date.now() + hours * 3600 * 1000).toISOString();
const quote = (overrides = {}) => ({
  subtotalMinor: 520000,
  feesMinor: 15000,
  shippingMinor: 30000,
  dutiesMinor: 0,
  expiresAt: futureIso(),
  rateSnapshot: "admin-entered",
  ...overrides,
});

const sendQuote = (ctx, overrides) =>
  ctx.act("payment-instructions", { expectedStatus: "pending_contact", quote: quote(overrides), message: "Size UK 9 confirmed in stock." });

const verify = (ctx, overrides = {}) =>
  ctx.act("verify-payment", {
    expectedStatus: "payment_review",
    amountReceivedGHSMinor: 565000,
    bankReference: "TXN-TEST-001",
    receivedAt: new Date(Date.now() - 60000).toISOString(),
    bankReceiptConfirmed: true,
    ...overrides,
  });

test("admin endpoints deny anonymous, customers, order tokens and forged roles", async (t) => {
  const ctx = await setup(t);
  const forged = await ctx.addUser({ role: "superadmin" });
  const endpoints = [
    ["GET", "/api/admin/orders"],
    ["GET", `/api/admin/orders/${ctx.orderId}`],
    ["POST", `/api/admin/orders/${ctx.orderId}/payment-instructions`],
    ["POST", `/api/admin/orders/${ctx.orderId}/verify-payment`],
    ["POST", `/api/admin/orders/${ctx.orderId}/fulfilment`],
    ["POST", `/api/admin/orders/${ctx.orderId}/cancel`],
    ["POST", `/api/admin/orders/${ctx.orderId}/notes`],
    ["POST", `/api/admin/emails/${new Types.ObjectId()}/retry`],
  ];
  for (const [method, path] of endpoints) {
    assert.equal((await ctx.request(method, path, { body: method === "POST" ? {} : undefined })).status, 401, path);
    assert.equal((await ctx.request(method, path, { token: userToken(ctx.customer._id), body: method === "POST" ? {} : undefined })).status, 403, path);
    assert.equal((await ctx.request(method, path, { token: userToken(forged._id), body: method === "POST" ? {} : undefined })).status, 403, path);
    assert.equal((await ctx.request(method, path, { token: ctx.placed.body.trackingHandoff.accessToken })).status, 401, path);
  }
  assert.equal(ctx.models.Order.docs[0].status, "pending_contact");
});

test("admin role cannot be self-assigned and is provisioned only by the operator script", async (t) => {
  const ctx = await setup(t);
  // Registration ignores role (covered in guestOrders tests); the script updates without re-saving.
  const updates = [];
  const UserModel = {
    updateOne: async (filter, update) => {
      updates.push({ filter, update });
      return { matchedCount: filter.email === "staff@example.test" ? 1 : 0 };
    },
  };
  await assert.rejects(setRole({ email: "staff@example.test", role: "admin" }, { UserModel, connect: async () => {} }), /--confirm/);
  await assert.rejects(setRole({ email: "staff@example.test", role: "owner", confirm: true }, { UserModel, connect: async () => {} }), /Usage/);
  await assert.rejects(setRole({ email: "nobody@example.test", role: "admin", confirm: true }, { UserModel, connect: async () => {} }), /No user/);
  await setRole({ email: " Staff@Example.test ", role: "admin", confirm: true }, { UserModel, connect: async () => {}, log: () => {} });
  assert.deepEqual(updates.at(-1), { filter: { email: "staff@example.test" }, update: { $set: { role: "admin" } } });
  assert.equal(ctx.models.User.docs.filter((user) => user.role === "admin").length, 1);
});

test("full manual payment workflow: quote → review → bank-verified → fulfilment, with audit and emails", async (t) => {
  const ctx = await setup(t);

  const list = await ctx.request("GET", "/api/admin/orders?status=pending_contact", { token: ctx.adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].orderNumber, ctx.placed.body.orderNumber);
  const search = await ctx.request("GET", `/api/admin/orders?q=${ctx.placed.body.orderNumber.slice(0, 6)}`, { token: ctx.adminToken });
  assert.equal(search.body.items.length, 1);
  const byEmail = await ctx.request("GET", "/api/admin/orders?q=AMA.MENSAH@example.test", { token: ctx.adminToken });
  assert.equal(byEmail.body.items.length, 1);

  let detail = await ctx.detail();
  assert.deepEqual(detail.allowedActions, ["payment-instructions", "awaiting-customer", "cancel"]);
  assert.equal(detail.paymentChannelConfigured, true);
  assert.equal(detail.idempotencyKeyHash, undefined);
  assert.equal(detail.requestFingerprint, undefined);

  const quoted = await sendQuote(ctx);
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.equal(quoted.body.status, "awaiting_payment");
  assert.equal(quoted.body.email.queued, true);
  let order = ctx.models.Order.docs[0];
  assert.equal(order.pricing.finalGHS.totalMinor, 565000);
  assert.equal(order.pricing.finalGHS.quoteVersion, 1);
  assert.equal(String(order.pricing.finalGHS.quotedBy), String(ctx.admin._id));
  assert.equal(order.payment.status, "awaiting_payment");
  assert.equal(order.email.paymentInstructionState, "queued");
  const instructions = ctx.models.EmailOutbox.docs.find((message) => message.kind === "payment_instructions");
  assert.match(instructions.payload.text, /GH₵5,650\.00|GHS\s?5,650\.00/);
  assert.match(instructions.payload.text, /TEST PAYMENT CHANNEL\nNot a real account/);
  assert.match(instructions.payload.text, /upload your payment screenshot/i);
  assert.match(instructions.payload.text, new RegExp(`payment reference: ${ctx.placed.body.orderNumber}`));

  // Duplicate click with the now-stale expected status cannot double-send.
  const duplicate = await sendQuote(ctx);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "STALE_STATUS");
  assert.equal(ctx.models.EmailOutbox.docs.filter((message) => message.kind === "payment_instructions").length, 1);

  // A screenshot arriving only moves the order to review; it never verifies payment.
  const review = await ctx.act("payment-review", { expectedStatus: "awaiting_payment", note: "Screenshot received by email" });
  assert.equal(review.status, 200);
  order = ctx.models.Order.docs[0];
  assert.equal(order.status, "payment_review");
  assert.equal(order.payment.status, "under_review");

  const noAttestation = await verify(ctx, { bankReceiptConfirmed: undefined });
  assert.equal(noAttestation.status, 422);
  assert.ok(noAttestation.body.fields.bankReceiptConfirmed);
  const wrongAmount = await verify(ctx, { amountReceivedGHSMinor: 500000 });
  assert.equal(wrongAmount.status, 422);
  assert.equal(wrongAmount.body.code, "AMOUNT_MISMATCH");
  const noReference = await verify(ctx, { bankReference: "" });
  assert.equal(noReference.status, 422);
  const futureReceipt = await verify(ctx, { receivedAt: futureIso(1) });
  assert.equal(futureReceipt.status, 422);
  assert.equal(ctx.models.Order.docs[0].status, "payment_review");

  const verified = await verify(ctx);
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  order = ctx.models.Order.docs[0];
  assert.equal(order.status, "confirmed");
  assert.equal(order.payment.status, "verified");
  assert.equal(order.payment.amountReceivedGHSMinor, 565000);
  assert.equal(order.payment.bankReference, "TXN-TEST-001");
  assert.equal(String(order.payment.verifiedBy), String(ctx.admin._id));
  assert.ok(order.payment.verifiedAt);
  assert.equal(ctx.models.EmailOutbox.docs.filter((message) => message.kind === "order_confirmed").length, 1);
  const again = await verify(ctx);
  assert.equal(again.status, 409);
  assert.equal(ctx.models.EmailOutbox.docs.filter((message) => message.kind === "order_confirmed").length, 1);

  assert.equal((await ctx.act("fulfilment", { expectedStatus: "confirmed", toStatus: "dispatched" })).status, 409);
  assert.equal((await ctx.act("fulfilment", { expectedStatus: "confirmed", toStatus: "processing", supplierReference: "RET-123" })).status, 200);
  const dispatched = await ctx.act("fulfilment", {
    expectedStatus: "processing",
    toStatus: "dispatched",
    carrier: "Test Courier",
    trackingNumber: "TC123",
    trackingUrl: "https://courier.example.test/TC123",
  });
  assert.equal(dispatched.status, 200);
  assert.equal((await ctx.act("fulfilment", { expectedStatus: "dispatched", toStatus: "delivered" })).status, 200);
  assert.equal((await ctx.act("fulfilment", { expectedStatus: "delivered", toStatus: "completed" })).status, 200);
  order = ctx.models.Order.docs[0];
  assert.equal(order.status, "completed");
  assert.equal(order.fulfilment.carrier, "Test Courier");
  assert.equal(order.fulfilment.supplierReference, "RET-123");

  const kinds = ctx.models.EmailOutbox.docs.map((message) => message.dedupeKey.split(":")[0] + (message.kind === "order_status" ? `:${message.dedupeKey.split(":")[2]}` : ""));
  assert.deepEqual(kinds, ["order_received", "payment_instructions", "order_confirmed", "status:processing", "status:dispatched", "status:delivered", "status:completed"]);
  const dispatchMail = ctx.models.EmailOutbox.docs.find((message) => message.dedupeKey.endsWith(":dispatched"));
  assert.match(dispatchMail.payload.text, /Tracking number: TC123/);

  detail = await ctx.detail();
  assert.deepEqual(
    detail.events.map((event) => event.type),
    ["order_created", "quote_sent", "payment_proof_received", "payment_verified", "fulfilment_processing", "fulfilment_dispatched", "fulfilment_delivered", "fulfilment_completed"]
  );
  assert.ok(detail.events.slice(1).every((event) => event.actorId === String(ctx.admin._id) && event.actorType === "admin"));
  assert.deepEqual(detail.allowedActions, []);
  assert.ok(!JSON.stringify(detail.events).includes("TEST PAYMENT CHANNEL"), "payment channel never stored in events");

  // Customer-facing view shows status history but none of the admin/payment internals.
  const customerView = await ctx.request("GET", `/api/orders/${ctx.orderId}`, {
    headers: { "X-Order-Access-Token": ctx.placed.body.trackingHandoff.accessToken },
  });
  assert.equal(customerView.status, 200);
  assert.deepEqual(
    customerView.body.history.map((entry) => entry.status),
    ["pending_contact", "awaiting_payment", "payment_review", "confirmed", "processing", "dispatched", "delivered", "completed"]
  );
  assert.equal(customerView.body.fulfilment.trackingNumber, "TC123");
  assert.equal(customerView.body.pricing.finalGHS.totalMinor, 565000);
  const serialized = JSON.stringify(customerView.body);
  ["TXN-TEST-001", "RET-123", "Screenshot received", "verifiedBy", "bankReference", "internalNotes", "supplierReference"].forEach((secret) =>
    assert.ok(!serialized.includes(secret), `${secret} leaked to customer view`)
  );
});

test("payment instructions require a configured channel and a valid future quote", async (t) => {
  const unconfigured = await setup(t, { env: {} });
  const refused = await sendQuote(unconfigured);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "PAYMENT_CHANNEL_NOT_CONFIGURED");
  assert.equal(unconfigured.models.Order.docs[0].status, "pending_contact");
  assert.equal((await unconfigured.detail()).paymentChannelConfigured, false);

  const ctx = await setup(t);
  for (const bad of [{ expiresAt: new Date(Date.now() - 1000).toISOString() }, { subtotalMinor: 12.5 }, { feesMinor: -1 }, { subtotalMinor: 0, feesMinor: 0, shippingMinor: 0 }, { expiresAt: "soon" }]) {
    const response = await sendQuote(ctx, bad);
    assert.equal(response.status, 422, JSON.stringify(bad));
  }
  const missingExpected = await ctx.act("payment-instructions", { quote: quote() });
  assert.equal(missingExpected.status, 400);
  assert.equal(ctx.models.Order.docs[0].status, "pending_contact");
});

test("re-quotes create a new version and a new email; a stale re-quote is rejected", async (t) => {
  const ctx = await setup(t);
  await sendQuote(ctx);
  const stale = await ctx.act("payment-instructions", { expectedStatus: "awaiting_payment", quote: quote({ shippingMinor: 40000 }) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "STALE_QUOTE");
  const revised = await ctx.act("payment-instructions", { expectedStatus: "awaiting_payment", expectedQuoteVersion: 1, quote: quote({ shippingMinor: 40000 }) });
  // A duplicate click with the same expected version cannot send a third quote.
  assert.equal((await ctx.act("payment-instructions", { expectedStatus: "awaiting_payment", expectedQuoteVersion: 1, quote: quote({ shippingMinor: 40000 }) })).status, 409);
  assert.equal(revised.status, 200);
  const order = ctx.models.Order.docs[0];
  assert.equal(order.pricing.finalGHS.quoteVersion, 2);
  assert.equal(order.pricing.finalGHS.totalMinor, 575000);
  assert.deepEqual(
    ctx.models.EmailOutbox.docs.filter((message) => message.kind === "payment_instructions").map((message) => message.dedupeKey.split(":")[2]),
    ["v1", "v2"]
  );
  assert.equal((await ctx.detail()).events.at(-1).type, "quote_revised");
});

test("concurrent admin actions on the same order: only one wins", async (t) => {
  const ctx = await setup(t);
  await sendQuote(ctx);
  await ctx.act("payment-review", { expectedStatus: "awaiting_payment" });
  const results = await Promise.all([verify(ctx), verify(ctx), ctx.act("payment-issue", { expectedStatus: "payment_review", customerMessage: "The amount received does not match." })]);
  const statuses = results.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 409, 409]);
  const confirmations = ctx.models.EmailOutbox.docs.filter((message) => message.kind === "order_confirmed").length;
  const issues = ctx.models.EmailOutbox.docs.filter((message) => message.kind === "payment_issue").length;
  assert.equal(confirmations + issues, 1);
});

test("payment issue, retry path, cancellation and refund are explicit and audited", async (t) => {
  const ctx = await setup(t);
  await sendQuote(ctx);
  await ctx.act("payment-review", { expectedStatus: "awaiting_payment" });
  const issue = await ctx.act("payment-issue", {
    expectedStatus: "payment_review",
    customerMessage: "We received GHS 5,000.00 but the quote was GHS 5,650.00. Please send the balance.",
    note: "short payment",
  });
  assert.equal(issue.status, 200);
  assert.equal(ctx.models.Order.docs[0].payment.status, "rejected");
  const issueMail = ctx.models.EmailOutbox.docs.find((message) => message.kind === "payment_issue");
  assert.match(issueMail.payload.text, /Please send the balance/);
  assert.ok(!issueMail.payload.text.includes("short payment"), "internal note not emailed");

  assert.equal((await verify(ctx, { expectedStatus: "payment_issue" })).status, 200);
  // Paid orders cannot be plainly cancelled: they become refund_pending.
  const cancelPaid = await ctx.act("cancel", { expectedStatus: "confirmed", reason: "Customer changed their mind" });
  assert.equal(cancelPaid.status, 200);
  assert.equal(ctx.models.Order.docs[0].status, "refund_pending");
  assert.equal(ctx.models.Order.docs[0].payment.status, "refund_pending");

  const refundMissing = await ctx.act("refund", { expectedStatus: "refund_pending", refundReference: "RF-1", amountRefundedGHSMinor: 565000 });
  assert.equal(refundMissing.status, 422);
  const refunded = await ctx.act("refund", {
    expectedStatus: "refund_pending",
    refundReference: "RF-1",
    amountRefundedGHSMinor: 565000,
    refundSentConfirmed: true,
  });
  assert.equal(refunded.status, 200);
  assert.equal(ctx.models.Order.docs[0].status, "refunded");
  assert.equal(ctx.models.Order.docs[0].payment.status, "refunded");
  assert.equal((await ctx.act("cancel", { expectedStatus: "refunded", reason: "again" })).status, 409);
});

test("unpaid orders can be cancelled or put on hold; sourcing failure requires a reason", async (t) => {
  const ctx = await setup(t);
  assert.equal((await ctx.act("awaiting-customer", { expectedStatus: "pending_contact" })).status, 422);
  assert.equal((await ctx.act("awaiting-customer", { expectedStatus: "pending_contact", note: "Asked if UK 10 is OK" })).status, 200);
  assert.equal((await ctx.act("fulfilment", { expectedStatus: "awaiting_customer", toStatus: "processing" })).status, 409);
  const cancelled = await ctx.act("cancel", { expectedStatus: "awaiting_customer", reason: "Size unavailable", customerMessage: "Sorry, that size sold out." });
  assert.equal(cancelled.status, 200);
  assert.equal(ctx.models.Order.docs[0].status, "cancelled");
  assert.equal(ctx.models.Order.docs[0].payment.status, "not_requested");
  assert.ok(ctx.models.EmailOutbox.docs.some((message) => message.dedupeKey.endsWith(":cancelled")));

  const second = await setup(t);
  await sendQuote(second);
  await second.act("payment-review", { expectedStatus: "awaiting_payment" });
  await verify(second);
  assert.equal((await second.act("fulfilment", { expectedStatus: "confirmed", toStatus: "sourcing_failed" })).status, 422);
  assert.equal((await second.act("fulfilment", { expectedStatus: "confirmed", toStatus: "sourcing_failed", note: "Retailer sold out" })).status, 200);
  assert.equal((await second.act("cancel", { expectedStatus: "sourcing_failed", reason: "Could not source" })).status, 200);
  assert.equal(second.models.Order.docs[0].status, "refund_pending");
});

test("internal notes are admin-only", async (t) => {
  const ctx = await setup(t);
  assert.equal((await ctx.request("POST", `/api/admin/orders/${ctx.orderId}/notes`, { token: ctx.adminToken, body: { body: "Customer called" } })).status, 201);
  const detail = await ctx.detail();
  assert.equal(detail.internalNotes[0].body, "Customer called");
  const customerView = await ctx.request("GET", `/api/orders/${ctx.orderId}`, { headers: { "X-Order-Access-Token": ctx.placed.body.trackingHandoff.accessToken } });
  assert.ok(!JSON.stringify(customerView.body).includes("Customer called"));
});

test("transition table has no path to confirmed except from payment states", () => {
  Object.entries(TRANSITIONS).forEach(([from, targets]) => {
    if (targets.includes("confirmed")) assert.ok(["awaiting_payment", "payment_review", "payment_issue"].includes(from), from);
  });
  assert.deepEqual(allowedActions("completed"), []);
});

// --- Outbox delivery ---------------------------------------------------------

const makeTransport = (behaviour) => {
  const sent = [];
  return {
    sent,
    async send(message) {
      const result = behaviour(message, sent.length);
      if (result instanceof Error) throw result;
      sent.push(message);
      return { providerMessageId: `test-${sent.length}` };
    },
  };
};

test("provider outage keeps orders, retries with backoff, then fails visibly; admin retry sends once", async (t) => {
  const ctx = await setup(t);
  const { EmailOutbox, Order } = ctx.models;
  let clock = Date.now();
  const now = () => new Date(clock);
  const down = makeTransport(() => new Error("SMTP 421 service unavailable"));

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await processOutboxBatch({ EmailOutbox, Order, transport: down, now, logger: silentLogger });
    assert.equal(result.sent, 0);
    clock += backoffMs(attempt) + 1000;
  }
  const ack = EmailOutbox.docs.find((message) => message.kind === "order_received");
  assert.equal(ack.state, "failed");
  assert.equal(ack.attempts, 5);
  assert.match(ack.lastError, /421/);
  assert.equal(Order.docs[0].email.acknowledgementState, "failed");
  assert.equal(Order.docs.length, 1);
  assert.equal(Order.docs[0].status, "pending_contact");

  const detail = await ctx.detail();
  assert.equal(detail.emails[0].state, "failed");
  assert.match(detail.emails[0].lastError, /421/);

  const retry = await ctx.request("POST", `/api/admin/emails/${ack._id}/retry`, { token: ctx.adminToken });
  assert.equal(retry.status, 200);
  assert.equal((await ctx.request("POST", `/api/admin/emails/${ack._id}/retry`, { token: ctx.adminToken })).status, 409);

  const up = makeTransport(() => null);
  await processOutboxBatch({ EmailOutbox, Order, transport: up, now, logger: silentLogger });
  await processOutboxBatch({ EmailOutbox, Order, transport: up, now, logger: silentLogger });
  assert.equal(up.sent.length, 1);
  assert.equal(up.sent[0].idempotencyKey, `order_received:${ctx.orderId}`);
  assert.equal(EmailOutbox.docs[0].state, "sent");
  assert.equal(Order.docs[0].email.acknowledgementState, "sent");
});

test("sent payment-instruction bodies are purged and interrupted sends are not auto-resent", async (t) => {
  const ctx = await setup(t);
  const { EmailOutbox, Order } = ctx.models;
  await sendQuote(ctx);
  const transport = makeTransport(() => null);
  await processOutboxBatch({ EmailOutbox, Order, transport, logger: silentLogger });
  assert.equal(transport.sent.length, 2);
  const instructions = EmailOutbox.docs.find((message) => message.kind === "payment_instructions");
  assert.equal(instructions.state, "sent");
  assert.ok(!instructions.payload.text.includes("TEST PAYMENT CHANNEL"));
  assert.equal(Order.docs[0].email.paymentInstructionState, "sent");

  // Simulate a crash mid-send.
  await ctx.act("payment-review", { expectedStatus: "awaiting_payment" });
  await verify(ctx);
  const confirmation = EmailOutbox.docs.find((message) => message.kind === "order_confirmed");
  confirmation.state = "sending";
  confirmation.lockedUntil = new Date(Date.now() - 1000);
  const result = await processOutboxBatch({ EmailOutbox, Order, transport, logger: silentLogger });
  assert.equal(result.stuck, 1);
  assert.equal(confirmation.state, "failed");
  assert.equal(transport.sent.length, 2);
});

test("queue outage during an admin action keeps the change and the email can be requeued from the event", async (t) => {
  const ctx = await setup(t);
  const original = ctx.models.EmailOutbox.create;
  ctx.models.EmailOutbox.create = async () => {
    throw new Error("outbox unavailable");
  };
  const quoted = await sendQuote(ctx);
  assert.equal(quoted.status, 200);
  assert.equal(quoted.body.email.queued, false);
  assert.equal(ctx.models.Order.docs[0].status, "awaiting_payment");
  ctx.models.EmailOutbox.create = original;

  const event = (await ctx.detail()).events.find((entry) => entry.type === "quote_sent");
  const requeue = await ctx.request("POST", `/api/admin/orders/${ctx.orderId}/events/${event.id}/requeue-email`, { token: ctx.adminToken });
  assert.equal(requeue.status, 200);
  const again = await ctx.request("POST", `/api/admin/orders/${ctx.orderId}/events/${event.id}/requeue-email`, { token: ctx.adminToken });
  assert.equal(again.status, 200);
  assert.equal(ctx.models.EmailOutbox.docs.filter((message) => message.kind === "payment_instructions").length, 1);
});

test("worker tick repairs missing acknowledgements", async (t) => {
  const ctx = await setup(t);
  const { Order, EmailOutbox } = ctx.models;
  EmailOutbox.docs.length = 0;
  Order.docs[0].email.acknowledgementState = "not_queued";
  const transport = makeTransport(() => null);
  const orderService = { ensureCreationSideEffects: async (order) => {
    const { createOrderService } = require("../services/orderService");
    return createOrderService({ ...ctx.models, config: ctx.config }).ensureCreationSideEffects(order);
  } };
  await runEmailWorkerTick({ Order, EmailOutbox, orderService, transport, logger: silentLogger });
  assert.equal(transport.sent.length, 1);
  assert.equal(Order.docs[0].email.acknowledgementState, "sent");
});

test("transport configuration", () => {
  assert.equal(createTransportFromEnv({}), null);
  assert.equal(createTransportFromEnv({ EMAIL_TRANSPORT: "none" }), null);
  assert.equal(createTransportFromEnv({ EMAIL_TRANSPORT: "log", NODE_ENV: "development" }, silentLogger).name, "log");
  assert.throws(() => createTransportFromEnv({ EMAIL_TRANSPORT: "log", NODE_ENV: "production" }), /not allowed in production/);
  assert.throws(() => createTransportFromEnv({ EMAIL_TRANSPORT: "carrier-pigeon" }), /Unsupported/);
  assert.throws(() => createTransportFromEnv({ EMAIL_TRANSPORT: "smtp" }), /Invalid SMTP configuration/);
});

test("users default to customer role, reject unknown roles, and re-saving does not re-hash", async () => {
  const User = require("../Models/User.model");
  assert.equal(new User({ name: "A", email: "a@example.test", password: "x" }).role, "customer");
  assert.ok(new User({ name: "A", email: "b@example.test", password: "x", role: "root" }).validateSync().errors.role);

  const existing = User.hydrate({ _id: new Types.ObjectId(), name: "A", email: "c@example.test", password: "$2a$10$existinghash", role: "admin" });
  const hook = User.schema.s.hooks._pres.get("save").find((entry) => entry.fn.toString().includes('isModified("password")'));
  let nextCalled = false;
  await hook.fn.call(existing, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(existing.password, "$2a$10$existinghash");
});

test("cancelling while funds are uncertain requires an explicit refund decision", async (t) => {
  const ctx = await setup(t);
  await sendQuote(ctx);
  await ctx.act("payment-review", { expectedStatus: "awaiting_payment" });
  await ctx.act("payment-issue", { expectedStatus: "payment_review", customerMessage: "We received less than the quoted amount." });
  const undecided = await ctx.act("cancel", { expectedStatus: "payment_issue", reason: "Customer cannot pay the balance" });
  assert.equal(undecided.status, 422);
  assert.ok(undecided.body.fields.refundRequired);
  const withRefund = await ctx.act("cancel", { expectedStatus: "payment_issue", reason: "Customer cannot pay the balance", refundRequired: true });
  assert.equal(withRefund.status, 200);
  assert.equal(ctx.models.Order.docs[0].status, "refund_pending");
  assert.equal(ctx.models.Order.docs[0].payment.status, "refund_pending");
  const refunded = await ctx.act("refund", { expectedStatus: "refund_pending", refundReference: "RF-9", amountRefundedGHSMinor: 500000, refundSentConfirmed: true });
  assert.equal(refunded.status, 200);
  assert.equal(ctx.models.Order.docs[0].payment.amountRefundedGHSMinor, 500000);

  const other = await setup(t);
  await sendQuote(other);
  await other.act("payment-review", { expectedStatus: "awaiting_payment" });
  const noMoney = await other.act("cancel", { expectedStatus: "payment_review", reason: "Screenshot was for another order", refundRequired: false });
  assert.equal(noMoney.status, 200);
  assert.equal(other.models.Order.docs[0].status, "cancelled");
});
