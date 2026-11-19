const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { startTestApp, silentLogger, userToken } = require("./helpers/testApp");
const { processOutboxBatch } = require("../services/emailOutbox");

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "a-secure-password";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// One controllable clock for the users and admin routes.
const startApp = async (t) => {
  const clock = { now: new Date("2026-11-20T10:00:00Z") };
  const now = () => new Date(clock.now);
  const ctx = await startTestApp({ deps: { users: { now, publicBaseUrl: "https://shop.example.test" }, admin: { now } } });
  t.after(ctx.close);
  const advance = (ms) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { ...ctx, clock, now, advance };
};

const register = (ctx, overrides = {}) =>
  ctx.request("POST", "/api/users/register", {
    body: { name: "Ama Mensah", email: "Ama@Example.test", password: PASSWORD, passwordConfirmation: PASSWORD, ...overrides },
  });

const userDoc = (ctx, email = "ama@example.test") => ctx.models.User.docs.find((user) => user.email === email);
const verificationEmails = (ctx) => ctx.models.EmailOutbox.docs.filter((message) => message.kind === "account_verification");
const tokenFrom = (message) => new URL(message.payload.text.match(/https:\/\/shop\.example\.test\/verify-email\?token=\S+/)[0]).searchParams.get("token");
const latestToken = (ctx) => tokenFrom(verificationEmails(ctx).at(-1));

// The in-memory model has no Mongoose save hook, so store a real hash for login.
const hashPassword = async (ctx, email = "ama@example.test") => {
  userDoc(ctx, email).password = await bcrypt.hash(PASSWORD, 4);
};

const login = (ctx, email = "ama@example.test") => ctx.request("POST", "/api/users/login", { body: { email, password: PASSWORD } });

test("registration validates name, email, password and confirmation, and rejects duplicates", async (t) => {
  const ctx = await startApp(t);
  const cases = [
    [{ name: " " }, "name"],
    [{ email: "not-an-email" }, "email"],
    [{ password: "short", passwordConfirmation: "short" }, "password"],
    [{ passwordConfirmation: "something-else-entirely" }, "passwordConfirmation"],
    [{ name: "x".repeat(101) }, "name"],
  ];
  for (const [overrides, field] of cases) {
    const response = await register(ctx, overrides);
    assert.equal(response.status, 400, field);
    assert.equal(response.body.code, "VALIDATION_FAILED");
    assert.ok(response.body.fields[field], field);
  }
  assert.equal(ctx.models.User.docs.length, 0);

  assert.equal((await register(ctx)).status, 201);
  const duplicate = await register(ctx, { email: "ama@example.test" });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.code, "EMAIL_IN_USE");
  assert.equal(ctx.models.User.docs.length, 1);
});

test("a new account starts unverified with a fixed 7-day deadline, no session and a hashed single link", async (t) => {
  const ctx = await startApp(t);
  const response = await register(ctx);
  assert.equal(response.status, 201);
  assert.equal(response.body.token, undefined);
  assert.equal(response.body.user.email, "ama@example.test");
  assert.ok(response.body.verification.pendingToken);
  assert.equal(new Date(response.body.verification.deadline).getTime(), ctx.now().getTime() + 7 * DAY);

  const user = userDoc(ctx);
  assert.equal(user.verificationRequired, true);
  assert.equal(user.role, "customer");
  assert.equal(user.emailVerifiedAt, undefined);
  assert.equal(user.verificationDeadline.getTime(), ctx.now().getTime() + 7 * DAY);
  assert.equal(user.emailVerificationExpires.getTime(), ctx.now().getTime() + DAY);

  const [message] = verificationEmails(ctx);
  assert.equal(message.to, "ama@example.test");
  assert.equal(message.state, "queued");
  assert.equal(String(message.userId), String(user._id));
  assert.equal(String(user.verificationDeliveryEmailId), String(message._id));
  const token = tokenFrom(message);
  assert.equal(user.emailVerificationTokenHash, sha256(token));
  assert.equal(JSON.stringify(ctx.models.User.docs).includes(token), false, "plaintext token must not be stored on the user");

  // The pending credential is not a session.
  assert.equal((await ctx.request("GET", "/api/orders", { token: response.body.verification.pendingToken })).status, 401);
});

test("login is blocked until the link is used once; then normal sign-in works", async (t) => {
  const ctx = await startApp(t);
  await register(ctx);
  await hashPassword(ctx);

  const wrong = await ctx.request("POST", "/api/users/login", { body: { email: "ama@example.test", password: "wrong-password-123" } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "Invalid email or password");

  const blocked = await login(ctx);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(blocked.body.token, undefined);
  assert.ok(blocked.body.verification.pendingToken);

  const token = latestToken(ctx);
  const verified = await ctx.request("POST", "/api/users/verify-email", { body: { token } });
  assert.equal(verified.status, 200);
  assert.equal(userDoc(ctx).emailVerifiedAt.getTime(), ctx.now().getTime());
  assert.equal(userDoc(ctx).emailVerificationTokenHash, undefined);

  const reused = await ctx.request("POST", "/api/users/verify-email", { body: { token } });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.code, "INVALID_LINK");

  const signedIn = await login(ctx);
  assert.equal(signedIn.status, 200);
  assert.ok(signedIn.body.token);
  assert.equal((await ctx.request("GET", "/api/orders", { token: signedIn.body.token })).status, 200);
});

test("malformed, unknown and expired links fail safely", async (t) => {
  const ctx = await startApp(t);
  await register(ctx);
  for (const token of [undefined, "", "abc", { $gt: "" }, "f".repeat(64)]) {
    const response = await ctx.request("POST", "/api/users/verify-email", { body: { token } });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "INVALID_LINK");
  }
  const token = latestToken(ctx);
  ctx.advance(DAY + 1000);
  const expired = await ctx.request("POST", "/api/users/verify-email", { body: { token } });
  assert.equal(expired.status, 400);
  assert.equal(userDoc(ctx).emailVerifiedAt, undefined);
});

test("resends: newest link only, 60-second cooldown, 3 per rolling 24 hours, deadline unchanged", async (t) => {
  const ctx = await startApp(t);
  const { body } = await register(ctx);
  const pending = body.verification.pendingToken;
  const deadline = userDoc(ctx).verificationDeadline.getTime();
  const firstToken = latestToken(ctx);
  const resend = () => ctx.request("POST", "/api/users/verification/resend", { token: pending });

  // The registration email starts the cooldown but is not counted as a resend.
  assert.equal((await resend()).body.code, "RESEND_COOLDOWN");
  ctx.advance(61 * 1000);
  const first = await resend();
  assert.equal(first.status, 200);
  assert.equal(first.body.resendsRemaining, 2);
  // The superseded queued email is withdrawn and its link stops working.
  const [original] = verificationEmails(ctx);
  assert.equal(original.state, "failed");
  assert.equal(original.payload.text, "[removed: superseded]");
  assert.equal((await ctx.request("POST", "/api/users/verify-email", { body: { token: firstToken } })).status, 400);

  const cooling = await resend();
  assert.equal(cooling.status, 429);
  assert.equal(cooling.body.code, "RESEND_COOLDOWN");
  assert.ok(Number(cooling.headers.get("retry-after")) >= 1);

  ctx.advance(61 * 1000);
  assert.equal((await resend()).status, 200);
  ctx.advance(61 * 1000);
  assert.equal((await resend()).status, 200);
  ctx.advance(61 * 1000);
  const limited = await resend();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "RESEND_LIMIT");

  // Rolling window: the first resend ages out after 24 hours.
  ctx.advance(DAY - 2 * 61 * 1000);
  const renewed = await ctx.request("POST", "/api/users/verification/resend", {
    token: (await (async () => {
      await hashPassword(ctx);
      return (await login(ctx)).body.verification.pendingToken;
    })()),
  });
  assert.equal(renewed.status, 200);
  assert.equal(userDoc(ctx).verificationDeadline.getTime(), deadline);

  const status = await ctx.request("GET", "/api/users/verification", { token: pending });
  assert.equal(status.status, 200);
  assert.equal(status.body.state, "pending");
  assert.equal(new Date(status.body.deadline).getTime(), deadline);

  assert.equal((await ctx.request("POST", "/api/users/verify-email", { body: { token: latestToken(ctx) } })).status, 200);
});

test("email correction moves the account to the new address without extending the deadline", async (t) => {
  const ctx = await startApp(t);
  const { body } = await register(ctx, { email: "ama@exmaple.test" });
  const pending = body.verification.pendingToken;
  const deadline = userDoc(ctx, "ama@exmaple.test").verificationDeadline.getTime();
  const oldToken = latestToken(ctx);
  await ctx.addUser({ email: "taken@example.test" });
  const change = (email) => ctx.request("PATCH", "/api/users/verification/email", { token: pending, body: { email } });

  assert.equal((await change("bad")).status, 400);
  assert.equal((await change("ama@exmaple.test")).status, 400);
  assert.equal((await change("ama@example.test")).body.code, "RESEND_COOLDOWN");
  ctx.advance(61 * 1000);
  const taken = await change("taken@example.test");
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, "EMAIL_IN_USE");

  const changed = await change("Ama@Example.test");
  assert.equal(changed.status, 200);
  assert.equal(changed.body.email, "ama@example.test");
  const user = userDoc(ctx);
  assert.equal(user.verificationDeadline.getTime(), deadline);
  const latest = verificationEmails(ctx).at(-1);
  assert.equal(latest.to, "ama@example.test");
  assert.equal(String(user.verificationDeliveryEmailId), String(latest._id));

  assert.equal((await ctx.request("POST", "/api/users/verify-email", { body: { token: oldToken } })).status, 400);
  assert.equal((await ctx.request("POST", "/api/users/verify-email", { body: { token: latestToken(ctx) } })).status, 200);

  const after = await change("other@example.test");
  assert.equal(after.status, 409);
  assert.equal(after.body.code, "ALREADY_VERIFIED");
});

test("verification credentials are restricted, expire and are revoked by a password reset", async (t) => {
  const ctx = await startApp(t);
  const { body } = await register(ctx);
  const pending = body.verification.pendingToken;
  assert.equal((await ctx.request("GET", "/api/users/verification")).status, 401);
  assert.equal((await ctx.request("GET", "/api/users/verification", { token: userToken(userDoc(ctx)._id) })).status, 401);

  userDoc(ctx).sessionVersion = 1;
  const revoked = await ctx.request("POST", "/api/users/verification/resend", { token: pending });
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.code, "VERIFICATION_SESSION_EXPIRED");

  const stale = jwt.sign({ id: String(userDoc(ctx)._id), sv: 1 }, process.env.JWT_SECRET, { audience: "email-verification", expiresIn: -10 });
  assert.equal((await ctx.request("GET", "/api/users/verification", { token: stale })).status, 401);
});

test("after the deadline the account cannot sign in or verify, and the address can be registered again", async (t) => {
  const ctx = await startApp(t);
  await register(ctx);
  await hashPassword(ctx);
  const token = latestToken(ctx);
  ctx.advance(7 * DAY);

  const expired = await login(ctx);
  assert.equal(expired.status, 403);
  assert.equal(expired.body.code, "ACCOUNT_EXPIRED");
  assert.equal((await ctx.request("POST", "/api/users/verify-email", { body: { token } })).status, 400);

  const oldId = String(userDoc(ctx)._id);
  const again = await register(ctx);
  assert.equal(again.status, 201);
  assert.equal(ctx.models.User.docs.length, 1);
  assert.notEqual(String(userDoc(ctx)._id), oldId);
});

test("sessions for unverified accounts are refused, including registered checkout; existing accounts are unaffected", async (t) => {
  const ctx = await startApp(t);
  await register(ctx);
  const unverifiedSession = userToken(userDoc(ctx)._id);
  const refused = await ctx.request("GET", "/api/orders", { token: unverifiedSession });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "EMAIL_NOT_VERIFIED");
  const checkout = await ctx.request("POST", "/api/orders", { token: unverifiedSession, body: {}, headers: { "Idempotency-Key": crypto.randomUUID() } });
  assert.equal(checkout.status, 403);
  assert.equal(ctx.models.Order.docs.length, 0);

  // An existing account has no verification fields and keeps working as before.
  const legacy = await ctx.addUser({ email: "existing@example.test", password: await bcrypt.hash(PASSWORD, 4) });
  const legacyLogin = await login(ctx, "existing@example.test");
  assert.equal(legacyLogin.status, 200);
  assert.equal((await ctx.request("GET", "/api/orders", { token: userToken(legacy._id) })).status, 200);
  const stored = userDoc(ctx, "existing@example.test");
  assert.equal(stored.verificationRequired, undefined);
  assert.equal(stored.verificationDeadline, undefined);
});

test("the queued link is removed from the outbox once the mail server accepts it", async (t) => {
  const ctx = await startApp(t);
  await register(ctx);
  const sent = [];
  const transport = { send: async (message) => (sent.push(message), { providerMessageId: "accepted-1" }) };
  await processOutboxBatch({ EmailOutbox: ctx.models.EmailOutbox, Order: ctx.models.Order, transport, logger: silentLogger, now: ctx.now });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /verify-email\?token=/);
  const [message] = verificationEmails(ctx);
  assert.equal(message.state, "sent");
  assert.equal(message.payload.text, "[removed after sending]");
});

test("admins see verification state and can resend for pending accounts only", async (t) => {
  const ctx = await startApp(t);
  const admin = await ctx.addUser({ email: "admin@example.test", role: "admin" });
  const adminToken = userToken(admin._id);
  await register(ctx);
  await ctx.addUser({ email: "existing@example.test" });

  const list = await ctx.request("GET", "/api/admin/users", { token: adminToken });
  const byEmail = Object.fromEntries(list.body.items.map((item) => [item.email, item]));
  assert.equal(byEmail["existing@example.test"].verification.state, "not_required");
  const pending = byEmail["ama@example.test"].verification;
  assert.equal(pending.state, "pending");
  assert.equal(pending.deliveryAccepted, false);
  assert.equal(pending.deletionPaused, true);
  assert.equal(pending.deliveryEmail.state, "queued");
  assert.equal(new Date(pending.deadline).getTime(), ctx.now().getTime() + 7 * DAY);
  assert.equal(JSON.stringify(list.body).includes("emailVerificationTokenHash"), false);

  const id = byEmail["ama@example.test"].id;
  const cooling = await ctx.request("POST", `/api/admin/users/${id}/resend-verification`, { token: adminToken });
  assert.equal(cooling.status, 429);
  ctx.advance(61 * 1000);
  const resent = await ctx.request("POST", `/api/admin/users/${id}/resend-verification`, { token: adminToken });
  assert.equal(resent.status, 200);
  assert.equal(resent.body.item.verification.latestEmail.state, "queued");
  assert.equal((await ctx.request("POST", `/api/admin/users/${id}/resend-verification`, { token: adminToken })).status, 429);
  assert.equal(userDoc(ctx).verificationEmailSends, undefined, "admin resends do not use the customer's limit");

  const legacyId = byEmail["existing@example.test"].id;
  const notNeeded = await ctx.request("POST", `/api/admin/users/${legacyId}/resend-verification`, { token: adminToken });
  assert.equal(notNeeded.status, 409);
  assert.equal(notNeeded.body.code, "ALREADY_VERIFIED");
});
