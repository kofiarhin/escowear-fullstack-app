const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { connectTestDb, skipReason } = require("./helpers/realDb");
const { newIdempotencyKey, sampleProduct, silentLogger, startTestApp, validOrderBody } = require("./helpers/testApp");
const { createEmailVerificationService } = require("../services/emailVerificationService");
const { runAccountLifecycleTick } = require("../services/accountLifecycle");
const { processOutboxBatch } = require("../services/emailOutbox");

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "a-secure-password";

test("IDE-152 email verification on real MongoDB", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  const { models } = db;
  const clock = { now: new Date() };
  const now = () => new Date(clock.now);
  const advance = (ms) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };

  const setup = async (config = {}) => {
    await db.reset();
    clock.now = new Date();
    require("../routes/usersRoute").resetRateLimits();
    return startTestApp({ models, config, deps: { users: { now, publicBaseUrl: "https://shop.example.test" }, orders: { now } } });
  };
  const register = (ctx, email = "ama@example.test") =>
    ctx.request("POST", "/api/users/register", { body: { name: "Ama", email, password: PASSWORD, passwordConfirmation: PASSWORD } });
  const latestLink = async (to = "ama@example.test") => {
    const message = await models.EmailOutbox.findOne({ kind: "account_verification", to, state: "queued" }).sort({ createdAt: -1 }).lean();
    return new URL(message.payload.text.match(/https:\/\/shop\.example\.test\/verify-email\?token=\S+/)[0]).searchParams.get("token");
  };

  await t.test("register, resend, correct, verify and sign in", async () => {
    const ctx = await setup();
    try {
      const registered = await register(ctx, "ama@exmaple.test");
      assert.equal(registered.status, 201);
      const pending = registered.body.verification.pendingToken;
      const stored = await models.User.findOne({ email: "ama@exmaple.test" }).select("+emailVerificationTokenHash").lean();
      assert.notEqual(stored.password, PASSWORD, "password is hashed");
      assert.match(stored.emailVerificationTokenHash, /^[a-f0-9]{64}$/);

      const blocked = await ctx.request("POST", "/api/users/login", { body: { email: "ama@exmaple.test", password: PASSWORD } });
      assert.equal(blocked.body.code, "EMAIL_NOT_VERIFIED");

      advance(61 * 1000);
      assert.equal((await ctx.request("POST", "/api/users/verification/resend", { token: pending })).status, 200);
      assert.equal((await ctx.request("POST", "/api/users/verification/resend", { token: pending })).status, 429);
      advance(61 * 1000);
      const changed = await ctx.request("PATCH", "/api/users/verification/email", { token: pending, body: { email: "ama@example.test" } });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.resendsRemaining, 1);
      const after = await models.User.findOne({ email: "ama@example.test" }).lean();
      assert.equal(after.verificationDeadline.getTime(), stored.verificationDeadline.getTime());
      assert.equal(after.verificationEmailSends.length, 2);

      assert.equal((await ctx.request("POST", "/api/users/verify-email", { body: { token: await latestLink() } })).status, 200);
      const signedIn = await ctx.request("POST", "/api/users/login", { body: { email: "ama@example.test", password: PASSWORD } });
      assert.equal(signedIn.status, 200);
      assert.equal((await ctx.request("GET", "/api/orders", { token: signedIn.body.token })).status, 200);
    } finally {
      await ctx.close();
    }
  });

  await t.test("cleanup deletes only accepted, expired new accounts and keeps everything else", async () => {
    const ctx = await setup();
    try {
      const service = createEmailVerificationService({ User: models.User, EmailOutbox: models.EmailOutbox, publicBaseUrl: "https://shop.example.test", now, logger: silentLogger });
      await register(ctx, "accepted@example.test");
      // Queued messages are due from the real time they were created.
      advance(1000);
      await processOutboxBatch({ EmailOutbox: models.EmailOutbox, Order: models.Order, transport: { send: async () => ({ providerMessageId: "ok" }) }, now, logger: silentLogger });
      await register(ctx, "undelivered@example.test");
      await register(ctx, "verified@example.test");
      assert.equal((await ctx.request("POST", "/api/users/verify-email", { body: { token: await latestLink("verified@example.test") } })).status, 200);
      await models.User.create({ name: "Existing", email: "existing@example.test", password: await bcrypt.hash(PASSWORD, 4) });
      const accepted = await models.User.findOne({ email: "accepted@example.test" }).lean();
      // Raw insert: only the user link matters for this check.
      await models.Order.collection.insertOne({ orderNumber: "EW-AAAAA-BBBBB", user: accepted._id });

      const tick = () => runAccountLifecycleTick({ User: models.User, EmailOutbox: models.EmailOutbox, verificationService: service, now, logger: silentLogger });
      advance(6 * DAY + 60 * 1000);
      const day6 = await tick();
      assert.equal(day6.warned, 2);
      advance(DAY);
      const day7 = await tick();
      assert.equal(day7.deleted, 1);
      assert.equal(day7.paused, 1);

      const emails = (await models.User.find({}).lean()).map((user) => user.email).sort();
      assert.deepEqual(emails, ["existing@example.test", "undelivered@example.test", "verified@example.test"]);
      assert.equal(await models.Order.countDocuments({ user: accepted._id }), 1, "orders are kept");
      const paused = await models.User.findOne({ email: "undelivered@example.test" }).lean();
      assert.ok(paused.verificationExpiredAt);
    } finally {
      await ctx.close();
    }
  });

  await t.test("guest checkout email code with real challenge storage", async () => {
    const ctx = await setup({ guestEmailVerification: true });
    try {
      const product = await models.Product.create(sampleProduct());
      const key = newIdempotencyKey();
      assert.equal((await ctx.request("POST", "/api/orders", { body: validOrderBody(product._id), headers: { "Idempotency-Key": key } })).status, 403);
      assert.equal((await ctx.request("POST", "/api/orders/checkout-email/request", { body: { email: "ama.mensah@example.test", checkoutIntent: key } })).status, 202);
      const message = await models.EmailOutbox.findOne({ kind: "checkout_email_code" }).lean();
      const code = message.payload.text.match(/is: (\d{6})/)[1];
      const verified = await ctx.request("POST", "/api/orders/checkout-email/verify", { body: { email: "ama.mensah@example.test", checkoutIntent: key, code } });
      assert.equal(verified.status, 200);
      const placed = await ctx.request("POST", "/api/orders", { body: validOrderBody(product._id), headers: { "Idempotency-Key": key, "X-Checkout-Email-Proof": verified.body.proof } });
      assert.equal(placed.status, 201);
      const replay = await ctx.request("POST", "/api/orders", { body: validOrderBody(product._id), headers: { "Idempotency-Key": key, "X-Checkout-Email-Proof": verified.body.proof } });
      assert.equal(replay.body.orderId, placed.body.orderId);
    } finally {
      await ctx.close();
    }
  });
});
