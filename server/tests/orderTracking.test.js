const test = require("node:test");
const assert = require("node:assert/strict");
const { newIdempotencyKey, sampleProduct, silentLogger, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");
const { GENERIC_REQUEST_MESSAGE } = require("../services/trackingService");
const { runEmailWorkerTick } = require("../services/emailWorker");

const setup = async (t, options = {}) => {
  let clock = Date.now();
  const ctx = await startTestApp({ deps: { orders: { now: () => new Date(clock) } }, ...options });
  t.after(ctx.close);
  const product = await ctx.models.Product.create(sampleProduct());
  const placed = await ctx.request("POST", "/api/orders", { body: validOrderBody(product._id), headers: { "Idempotency-Key": newIdempotencyKey() } });
  assert.equal(placed.status, 201);
  const requestCode = (body = {}) =>
    ctx.request("POST", "/api/orders/tracking/request", { body: { orderNumber: placed.body.orderNumber, email: "ama.mensah@example.test", ...body } });
  const verifyCode = (code, body = {}) =>
    ctx.request("POST", "/api/orders/tracking/verify", { body: { orderNumber: placed.body.orderNumber, email: "ama.mensah@example.test", code, ...body } });
  // Codes are issued in the background after the 202, so give the work a moment.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  const requestCodeAndSettle = async (...args) => {
    const response = await requestCode(...args);
    await settle();
    return response;
  };
  const latestCode = () => {
    const messages = ctx.models.EmailOutbox.docs.filter((message) => message.kind === "tracking_code");
    return messages.at(-1)?.payload.text.match(/is: (\d{6})/)?.[1];
  };
  return { ...ctx, product, placed, requestCode: requestCodeAndSettle, verifyCode, latestCode, advance: (ms) => (clock += ms), now: () => clock };
};

test("guest requests a code, verifies it once, and gets read access to that order only", async (t) => {
  const ctx = await setup(t);
  const other = await ctx.request("POST", "/api/orders", { body: validOrderBody(ctx.product._id), headers: { "Idempotency-Key": newIdempotencyKey() } });

  const requested = await ctx.requestCode({ orderNumber: ctx.placed.body.orderNumber.toLowerCase(), email: " AMA.MENSAH@example.test " });
  assert.equal(requested.status, 202);
  assert.equal(requested.body.message, GENERIC_REQUEST_MESSAGE);
  const code = ctx.latestCode();
  assert.match(code, /^\d{6}$/);
  const challenge = ctx.models.TrackingChallenge.docs[0];
  assert.ok(!JSON.stringify(challenge).includes(code), "code is stored only as a hash");
  const mail = ctx.models.EmailOutbox.docs.find((message) => message.kind === "tracking_code");
  assert.equal(mail.to, "ama.mensah@example.test");

  const verified = await ctx.verifyCode(code.slice(0, 3) + " " + code.slice(3));
  assert.equal(verified.status, 200);
  assert.equal(verified.body.orderId, ctx.placed.body.orderId);
  assert.equal(verified.body.expiresInMinutes, 30);
  assert.equal(verified.headers.get("cache-control"), "no-store");

  const headers = { "X-Order-Access-Token": verified.body.accessToken };
  const view = await ctx.request("GET", `/api/orders/${ctx.placed.body.orderId}`, { headers });
  assert.equal(view.status, 200);
  assert.equal(view.body.orderNumber, ctx.placed.body.orderNumber);
  assert.equal((await ctx.request("GET", `/api/orders/${other.body.orderId}`, { headers })).status, 404);
  assert.equal((await ctx.request("GET", "/api/orders", { token: verified.body.accessToken })).status, 401);

  // Replay of a used code is rejected.
  const replay = await ctx.verifyCode(code);
  assert.equal(replay.status, 400);
  assert.equal(replay.body.code, "INVALID_CODE");
});

test("unknown order numbers and wrong emails get the same response and no email", async (t) => {
  const ctx = await setup(t);
  const unknown = await ctx.requestCode({ orderNumber: "EW-ZZZZZ-ZZZZZ" });
  const wrongEmail = await ctx.requestCode({ email: "someone.else@example.test" });
  const real = await ctx.requestCode();
  assert.deepEqual([unknown.status, wrongEmail.status, real.status], [202, 202, 202]);
  assert.deepEqual(unknown.body, real.body);
  assert.deepEqual(wrongEmail.body, real.body);
  assert.equal(ctx.models.EmailOutbox.docs.filter((message) => message.kind === "tracking_code").length, 1);

  const malformed = await ctx.requestCode({ orderNumber: "123" });
  assert.equal(malformed.status, 422);
  const verifyUnknown = await ctx.verifyCode("123456", { orderNumber: "EW-ZZZZZ-ZZZZZ" });
  const verifyWrong = await ctx.verifyCode("000000");
  assert.equal(verifyUnknown.status, 400);
  assert.deepEqual(verifyUnknown.body, verifyWrong.status === 400 ? verifyWrong.body : null);
});

test("wrong guesses are limited and lock the code; expired codes are rejected", async (t) => {
  const ctx = await setup(t);
  await ctx.requestCode();
  const code = ctx.latestCode();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await ctx.verifyCode(wrong)).status, 400);
  // Even the correct code no longer works after the attempt limit.
  assert.equal((await ctx.verifyCode(code)).status, 400);
  assert.equal(ctx.models.TrackingChallenge.docs[0].consumedReason, "too_many_attempts");

  await ctx.requestCode();
  const fresh = ctx.latestCode();
  ctx.advance(11 * 60 * 1000);
  assert.equal((await ctx.verifyCode(fresh)).status, 400);
});

test("a new code supersedes the old one and per-order code requests are capped", async (t) => {
  const ctx = await setup(t);
  await ctx.requestCode();
  const first = ctx.latestCode();
  await ctx.requestCode();
  const second = ctx.latestCode();
  if (first !== second) assert.equal((await ctx.verifyCode(first)).status, 400);
  assert.equal((await ctx.verifyCode(second)).status, 200);

  for (let index = 0; index < 4; index += 1) await ctx.requestCode();
  const sent = ctx.models.EmailOutbox.docs.filter((message) => message.kind === "tracking_code").length;
  assert.equal(sent, 5);
  const limited = await ctx.requestCode();
  assert.equal(limited.status, 429);
});

test("parallel guesses cannot exceed the attempt limit", async (t) => {
  const ctx = await setup(t);
  await ctx.requestCode();
  const code = ctx.latestCode();
  const wrong = code === "000000" ? "111111" : "000000";
  const results = await Promise.all(Array.from({ length: 12 }, () => ctx.verifyCode(wrong)));
  assert.ok(results.every((response) => response.status === 400));
  assert.ok(ctx.models.TrackingChallenge.docs[0].attempts <= 5);
});

test("tracking endpoints are rate limited per client", async (t) => {
  const ctx = await setup(t);
  const responses = [];
  for (let index = 0; index < 11; index += 1) responses.push(await ctx.requestCode({ orderNumber: `EW-AAAAA-${String(index).padStart(5, "0")}` }));
  assert.equal(responses[9].status, 202);
  assert.equal(responses[10].status, 429);
});

test("customer view shows dispatch details and history but never internal data", async (t) => {
  const ctx = await setup(t, { deps: { admin: { env: { ESCOWEAR_PAYMENT_INSTRUCTIONS: "TEST CHANNEL" } } } });
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const act = (action, body) => ctx.request("POST", `/api/admin/orders/${ctx.placed.body.orderId}/${action}`, { body, token });
  await act("payment-instructions", {
    expectedStatus: "pending_contact",
    quote: { subtotalMinor: 100000, feesMinor: 0, shippingMinor: 0, dutiesMinor: 0, expiresAt: new Date(Date.now() + 86400000).toISOString() },
  });
  await act("verify-payment", {
    expectedStatus: "awaiting_payment",
    amountReceivedGHSMinor: 100000,
    bankReference: "BANK-SECRET-REF",
    receivedAt: new Date(Date.now() - 1000).toISOString(),
    bankReceiptConfirmed: true,
  });
  await act("fulfilment", { expectedStatus: "confirmed", toStatus: "processing", supplierReference: "SUPPLIER-SECRET" });
  await ctx.request("POST", `/api/admin/orders/${ctx.placed.body.orderId}/notes`, { body: { body: "INTERNAL-NOTE" }, token });

  const before = await ctx.request("GET", `/api/orders/${ctx.placed.body.orderId}`, { headers: { "X-Order-Access-Token": ctx.placed.body.trackingHandoff.accessToken } });
  assert.equal(before.body.fulfilment.carrier, null);
  assert.equal(before.body.statusLabel, "Sourcing your order");

  await act("fulfilment", { expectedStatus: "processing", toStatus: "dispatched", carrier: "DHL", trackingNumber: "JD0001", trackingUrl: "https://dhl.example.test/JD0001" });
  const after = await ctx.request("GET", `/api/orders/${ctx.placed.body.orderId}`, { headers: { "X-Order-Access-Token": ctx.placed.body.trackingHandoff.accessToken } });
  assert.equal(after.body.status, "dispatched");
  assert.equal(after.body.fulfilment.carrier, "DHL");
  assert.equal(after.body.fulfilment.trackingNumber, "JD0001");
  assert.ok(after.body.fulfilment.dispatchedAt);
  assert.deepEqual(after.body.history.map((entry) => entry.status), ["pending_contact", "awaiting_payment", "confirmed", "processing", "dispatched"]);
  const json = JSON.stringify(after.body);
  ["BANK-SECRET-REF", "SUPPLIER-SECRET", "INTERNAL-NOTE", "TEST CHANNEL", "tracking_access_granted", "note_added", "+233"].forEach((secret) =>
    assert.ok(!json.includes(secret), `${secret} leaked`)
  );

  // Exactly one email per committed customer-facing status.
  const statusMails = ctx.models.EmailOutbox.docs.filter((message) => message.kind === "order_status").map((message) => message.dedupeKey.split(":")[2]);
  assert.deepEqual(statusMails, ["processing", "dispatched"]);
});

test("signed-in customers see only their linked orders", async (t) => {
  const ctx = await setup(t);
  const owner = await ctx.addUser();
  const other = await ctx.addUser();
  const mine = await ctx.request("POST", "/api/orders", { body: validOrderBody(ctx.product._id), headers: { "Idempotency-Key": newIdempotencyKey() }, token: userToken(owner._id) });
  const list = await ctx.request("GET", "/api/orders", { token: userToken(owner._id) });
  assert.deepEqual(list.body.items.map((order) => order.id), [mine.body.orderId]);
  assert.equal((await ctx.request("GET", "/api/orders", { token: userToken(other._id) })).body.items.length, 0);
  // Owner can open their order without an access token; a guest order is not theirs.
  assert.equal((await ctx.request("GET", `/api/orders/${mine.body.orderId}`, { token: userToken(owner._id) })).status, 200);
  assert.equal((await ctx.request("GET", `/api/orders/${ctx.placed.body.orderId}`, { token: userToken(owner._id) })).status, 404);
});

test("queued tracking codes that expire before sending are dropped", async (t) => {
  const ctx = await setup(t);
  await ctx.requestCode();
  const message = ctx.models.EmailOutbox.docs.find((entry) => entry.kind === "tracking_code");
  message.createdAt = new Date(Date.now() - 11 * 60 * 1000);
  const sent = [];
  await runEmailWorkerTick({
    ...ctx.models,
    orderService: { ensureCreationSideEffects: async () => {} },
    transport: { send: async (mail) => sent.push(mail) && { providerMessageId: "x" } },
    logger: silentLogger,
  });
  assert.equal(message.state, "failed");
  assert.ok(!/\d{6}/.test(message.payload.text));
  assert.ok(sent.every((mail) => !mail.subject.includes("tracking code")));
});
