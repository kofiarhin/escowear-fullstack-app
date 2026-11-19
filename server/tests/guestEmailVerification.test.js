const test = require("node:test");
const assert = require("node:assert/strict");
const { newIdempotencyKey, sampleProduct, startTestApp, userToken, validOrderBody } = require("./helpers/testApp");

const EMAIL = "ama.mensah@example.test";

// Production behaviour: guest orders need a verified email code.
const setup = async (t) => {
  const clock = { now: new Date("2026-11-20T10:00:00Z") };
  const now = () => new Date(clock.now);
  const ctx = await startTestApp({ config: { guestEmailVerification: true }, deps: { orders: { now } } });
  t.after(ctx.close);
  const product = await ctx.models.Product.create(sampleProduct());
  const advance = (ms) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { ...ctx, product, advance };
};

const requestCode = (ctx, checkoutIntent, email = EMAIL) => ctx.request("POST", "/api/orders/checkout-email/request", { body: { email, checkoutIntent } });
const verifyCode = (ctx, checkoutIntent, code, email = EMAIL) =>
  ctx.request("POST", "/api/orders/checkout-email/verify", { body: { email, checkoutIntent, code } });
const latestCode = (ctx) =>
  ctx.models.EmailOutbox.docs.filter((message) => message.kind === "checkout_email_code").at(-1).payload.text.match(/is: (\d{6})/)[1];
const placeOrder = (ctx, key, proof, body = validOrderBody(ctx.product._id), extra = {}) =>
  ctx.request("POST", "/api/orders", { body, headers: { "Idempotency-Key": key, ...(proof ? { "X-Checkout-Email-Proof": proof } : {}) }, ...extra });
const wrongCode = (code) => String((Number(code) + 1) % 1000000).padStart(6, "0");

test("a guest order without a verified email code is refused by the server", async (t) => {
  const ctx = await setup(t);
  const response = await placeOrder(ctx, newIdempotencyKey());
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "EMAIL_VERIFICATION_REQUIRED");
  const forged = await placeOrder(ctx, newIdempotencyKey(), "not-a-proof");
  assert.equal(forged.status, 403);
  assert.equal(ctx.models.Order.docs.length, 0);
});

test("guest verifies a 6-digit code, then places the order; retries stay idempotent", async (t) => {
  const ctx = await setup(t);
  const key = newIdempotencyKey();
  const requested = await requestCode(ctx, key, "Ama.Mensah@Example.test");
  assert.equal(requested.status, 202);
  assert.equal(requested.body.expiresInMinutes, 10);
  const code = latestCode(ctx);
  const [message] = ctx.models.EmailOutbox.docs;
  assert.equal(message.to, EMAIL);

  // Only an HMAC of the code is stored.
  const [challenge] = ctx.models.CheckoutEmailChallenge.docs;
  assert.equal(JSON.stringify(challenge).includes(code), false);

  const wrong = await verifyCode(ctx, key, wrongCode(code));
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, "INVALID_CODE");

  const verified = await verifyCode(ctx, key, code);
  assert.equal(verified.status, 200);
  assert.ok(verified.body.proof);
  assert.equal((await verifyCode(ctx, key, code)).status, 400, "codes are single-use");

  const created = await placeOrder(ctx, key, verified.body.proof);
  assert.equal(created.status, 201);
  assert.ok(created.body.trackingHandoff.accessToken, "tracking handoff unchanged");
  const replay = await placeOrder(ctx, key, verified.body.proof);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.orderId, created.body.orderId);
  assert.equal(ctx.models.Order.docs.length, 1);
});

test("the proof is bound to the order email and to this exact checkout attempt", async (t) => {
  const ctx = await setup(t);
  const key = newIdempotencyKey();
  await requestCode(ctx, key);
  const { proof } = (await verifyCode(ctx, key, latestCode(ctx))).body;

  const otherEmail = validOrderBody(ctx.product._id, { customer: { name: "Ama Mensah", email: "someone.else@example.test", phone: "024 123 4567" } });
  assert.equal((await placeOrder(ctx, key, proof, otherEmail)).status, 403);
  assert.equal((await placeOrder(ctx, newIdempotencyKey(), proof)).status, 403);
  assert.equal(ctx.models.Order.docs.length, 0);

  // A code for one checkout attempt cannot be verified for another.
  const other = newIdempotencyKey();
  await requestCode(ctx, key);
  assert.equal((await verifyCode(ctx, other, latestCode(ctx))).status, 400);
});

test("codes expire after 10 minutes and lock after 5 wrong attempts; a new code replaces the old", async (t) => {
  const ctx = await setup(t);
  const key = newIdempotencyKey();
  await requestCode(ctx, key);
  const expiring = latestCode(ctx);
  ctx.advance(10 * 60 * 1000 + 1000);
  assert.equal((await verifyCode(ctx, key, expiring)).status, 400);

  await requestCode(ctx, key);
  const first = latestCode(ctx);
  await requestCode(ctx, key);
  const second = latestCode(ctx);
  if (first !== second) assert.equal((await verifyCode(ctx, key, first)).status, 400, "superseded code no longer works");

  await requestCode(ctx, key);
  const locked = latestCode(ctx);
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await verifyCode(ctx, key, wrongCode(locked))).status, 400);
  assert.equal((await verifyCode(ctx, key, locked)).status, 400, "the right code fails after 5 wrong attempts");
});

test("code requests and checks validate their input", async (t) => {
  const ctx = await setup(t);
  assert.equal((await requestCode(ctx, newIdempotencyKey(), "bad")).status, 422);
  assert.equal((await requestCode(ctx, "short")).status, 422);
  assert.equal((await verifyCode(ctx, newIdempotencyKey(), "12ab")).status, 422);
  assert.equal(ctx.models.EmailOutbox.docs.length, 0);
});

test("signed-in customers with a verified or existing account need no email code", async (t) => {
  const ctx = await setup(t);
  const existing = await ctx.addUser({ email: "existing@example.test" });
  const verified = await ctx.addUser({ email: "verified@example.test", verificationRequired: true, emailVerifiedAt: new Date(), verificationDeadline: new Date(Date.now() + 1000) });
  for (const user of [existing, verified]) {
    const response = await placeOrder(ctx, newIdempotencyKey(), null, validOrderBody(ctx.product._id), { token: userToken(user._id) });
    assert.equal(response.status, 201);
  }
});
