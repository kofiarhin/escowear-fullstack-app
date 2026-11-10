const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { createModels, startTestApp, silentLogger } = require("./helpers/testApp");

const GENERIC_MESSAGE = "If an account matches that email address, we have sent password reset instructions.";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

const startResetApp = async ({ send, now, models } = {}) => {
  const sent = [];
  const ctx = await startTestApp({
    models,
    deps: {
      users: {
        publicBaseUrl: "https://shop.example.test",
        logger: silentLogger,
        now,
        transportFactory: () => ({
          send: async (message) => {
            if (send) return send(message);
            sent.push(message);
            return { providerMessageId: "test-message" };
          },
        }),
      },
    },
  });
  return { ...ctx, sent };
};

const resetTokenFrom = (message) => new URL(message.text.match(/https:\/\/shop\.example\.test\/reset-password\?token=([^\s]+)/)[0]).searchParams.get("token");

test("password reset emails use a hashed, 30-minute, single-use token and reset the password", async (t) => {
  const ctx = await startResetApp();
  t.after(ctx.close);
  const originalHash = await bcrypt.hash("original-password", 10);
  const user = await ctx.models.User.create({ name: "Ama", email: "ama@example.test", password: originalHash, role: "admin" });
  const preResetSession = require("jsonwebtoken").sign({ id: String(user._id), sv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

  const requested = await ctx.request("POST", "/api/users/forgot-password", { body: { email: user.email } });
  assert.equal(requested.status, 202);
  assert.deepEqual(requested.body, { message: GENERIC_MESSAGE });
  assert.equal(ctx.sent.length, 1);
  const token = resetTokenFrom(ctx.sent[0]);
  const stored = ctx.models.User.docs.find((entry) => String(entry._id) === String(user._id));
  assert.equal(stored.passwordResetToken, hash(token));
  assert.notEqual(stored.passwordResetToken, token);
  assert.ok(stored.passwordResetExpires > new Date(Date.now() + 29 * 60 * 1000));
  assert.ok(stored.passwordResetExpires <= new Date(Date.now() + 31 * 60 * 1000));

  const reset = await ctx.request("POST", "/api/users/reset-password", { body: { token, password: "a-new-secure-password" } });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.message, "Your password has been reset. You can now sign in.");
  assert.equal(await bcrypt.compare("a-new-secure-password", stored.password), true);
  assert.equal(stored.role, "admin");
  assert.equal(stored.passwordResetToken, undefined);
  assert.equal(stored.passwordResetExpires, undefined);

  const revokedCustomerSession = await ctx.request("GET", "/api/orders", { token: preResetSession });
  assert.equal(revokedCustomerSession.status, 401);
  assert.equal(revokedCustomerSession.body.code, "SESSION_REVOKED");
  const revokedAdminSession = await ctx.request("GET", "/api/admin/orders", { token: preResetSession });
  assert.equal(revokedAdminSession.status, 401);
  assert.equal(revokedAdminSession.body.code, "SESSION_REVOKED");

  const login = await ctx.request("POST", "/api/users/login", { body: { email: user.email, password: "a-new-secure-password" } });
  assert.equal(login.status, 200);
  assert.equal(login.body.role, "admin");
  assert.equal((await ctx.request("GET", "/api/admin/orders", { token: login.body.token })).status, 200);

  const reused = await ctx.request("POST", "/api/users/reset-password", { body: { token, password: "another-secure-password" } });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error, "This password reset link is invalid or has expired.");
});

test("unknown addresses receive the same response as registered addresses", async (t) => {
  const ctx = await startResetApp();
  t.after(ctx.close);
  await ctx.models.User.create({ name: "Ama", email: "ama@example.test", password: await bcrypt.hash("original-password", 10) });

  const known = await ctx.request("POST", "/api/users/forgot-password", { body: { email: "ama@example.test" } });
  const unknown = await ctx.request("POST", "/api/users/forgot-password", { body: { email: "nobody@example.test" } });
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(ctx.sent.length, 1);
});

test("expired and malformed reset tokens cannot change a password", async (t) => {
  const ctx = await startResetApp();
  t.after(ctx.close);
  const originalHash = await bcrypt.hash("original-password", 10);
  const user = await ctx.models.User.create({
    name: "Ama",
    email: "ama@example.test",
    password: originalHash,
    passwordResetToken: hash("f".repeat(64)),
    passwordResetExpires: new Date(Date.now() - 1),
  });

  for (const token of ["f".repeat(64), "not-a-token"]) {
    const result = await ctx.request("POST", "/api/users/reset-password", { body: { token, password: "a-new-secure-password" } });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "This password reset link is invalid or has expired.");
  }
  assert.equal((await ctx.models.User.findById(user._id)).password, originalHash);
});

test("mail delivery failures do not leave a usable reset token", async (t) => {
  const ctx = await startResetApp({ send: async () => { throw new Error("SMTP rejected request"); } });
  t.after(ctx.close);
  const user = await ctx.models.User.create({ name: "Ama", email: "ama@example.test", password: await bcrypt.hash("original-password", 10) });

  const result = await ctx.request("POST", "/api/users/forgot-password", { body: { email: user.email } });
  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { message: GENERIC_MESSAGE });
  const stored = ctx.models.User.docs.find((entry) => String(entry._id) === String(user._id));
  assert.equal(stored.passwordResetToken, undefined);
  assert.equal(stored.passwordResetExpires, undefined);
});

test("shared rate limits cap concurrent abuse and expire cleanly", async (t) => {
  let time = new Date("2026-11-08T12:00:00.000Z");
  const models = createModels();
  const first = await startResetApp({ now: () => time, models });
  const second = await startResetApp({ now: () => time, models });
  t.after(first.close);
  t.after(second.close);
  const requests = await Promise.all(
    Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).request("POST", "/api/users/forgot-password", { body: { email: `unknown-${index}@example.test` } }))
  );
  assert.equal(requests.filter((response) => response.status === 202).length, 10);
  const limited = requests.find((response) => response.status === 429);
  assert.equal(limited.body.code, "RATE_LIMITED");
  assert.ok(limited.headers.get("retry-after"));

  time = new Date(time.getTime() + 16 * 60 * 1000);
  const afterExpiry = await first.request("POST", "/api/users/forgot-password", { body: { email: "after-expiry@example.test" } });
  assert.equal(afterExpiry.status, 202);
});

test("login, registration, and password-reset submission limits are enforced", async (t) => {
  const ctx = await startResetApp();
  t.after(ctx.close);
  for (let index = 0; index < 20; index += 1) {
    assert.equal((await ctx.request("POST", "/api/users/login", { body: { email: `login-${index}@example.test`, password: "invalid-password" } })).status, 400);
  }
  const loginLimited = await ctx.request("POST", "/api/users/login", { body: { email: "login-limited@example.test", password: "invalid-password" } });
  assert.equal(loginLimited.status, 429);

  for (let index = 0; index < 10; index += 1) {
    assert.equal((await ctx.request("POST", "/api/users/register", { body: {} })).status, 400);
  }
  assert.equal((await ctx.request("POST", "/api/users/register", { body: {} })).status, 429);

  for (let index = 0; index < 20; index += 1) {
    assert.equal((await ctx.request("POST", "/api/users/reset-password", { body: { token: "a".repeat(64), password: "a-new-secure-password" } })).status, 400);
  }
  const resetLimited = await ctx.request("POST", "/api/users/reset-password", { body: { token: "a".repeat(64), password: "a-new-secure-password" } });
  assert.equal(resetLimited.status, 429);
  assert.equal(resetLimited.body.code, "RATE_LIMITED");
});
