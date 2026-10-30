// Admin bootstrap against a real MongoDB (opt-in; see helpers/realDb.js):
// login through the existing auth route, no duplicates, no reset, no promotion.
const test = require("node:test");
const assert = require("node:assert/strict");
const { connectTestDb, skipReason } = require("./helpers/realDb");
const { startTestApp, silentLogger } = require("./helpers/testApp");
const { ensureAdminAccount } = require("../services/adminBootstrap");

const PASSWORD = "Fixture-admin-pass-1";
const env = { ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: PASSWORD };

test("admin bootstrap on real MongoDB", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  const { models } = db;
  const login = (ctx, email, password) => ctx.request("POST", "/api/users/login", { body: { email, password } });

  await t.test("created admin signs in with the existing login and reaches admin APIs", async () => {
    await db.reset();
    require("../routes/usersRoute").resetRateLimits();
    assert.equal((await ensureAdminAccount({ env, UserModel: models.User, logger: silentLogger })).status, "created");
    const stored = await models.User.findOne({ email: env.ADMIN_EMAIL }).lean();
    assert.notEqual(stored.password, PASSWORD);
    assert.ok(stored.createdAt);
    const ctx = await startTestApp({ models });
    try {
      const signedIn = await login(ctx, "OWNER@example.test", PASSWORD);
      assert.equal(signedIn.status, 200);
      assert.equal(signedIn.body.role, "admin");
      assert.equal((await ctx.request("GET", "/api/admin/orders", { token: signedIn.body.token })).status, 200);
      assert.equal((await login(ctx, env.ADMIN_EMAIL, "Wrong-password-123")).status, 400);
    } finally {
      await ctx.close();
    }
  });

  await t.test("restarts and concurrent starts never duplicate or reset the admin", async () => {
    const before = await models.User.findOne({ email: env.ADMIN_EMAIL }).lean();
    const changedEnv = { ...env, ADMIN_PASSWORD: "A-new-env-password-9" };
    const results = await Promise.all([1, 2, 3].map(() => ensureAdminAccount({ env: changedEnv, UserModel: models.User, logger: silentLogger })));
    assert.deepEqual(results.map((r) => r.status), ["exists", "exists", "exists"]);
    assert.equal(await models.User.countDocuments({ email: env.ADMIN_EMAIL }), 1);
    assert.equal((await models.User.findOne({ email: env.ADMIN_EMAIL }).lean()).password, before.password);
  });

  await t.test("fresh concurrent starts create exactly one admin", async () => {
    await db.reset();
    const results = await Promise.all([1, 2, 3, 4].map(() => ensureAdminAccount({ env, UserModel: models.User, logger: silentLogger })));
    assert.equal(results.filter((r) => r.status === "created").length, 1);
    assert.equal(await models.User.countDocuments({ email: env.ADMIN_EMAIL }), 1);
  });

  await t.test("customer registration is unchanged and an existing customer email is not promoted", async () => {
    await db.reset();
    require("../routes/usersRoute").resetRateLimits();
    const ctx = await startTestApp({ models });
    try {
      const registered = await ctx.request("POST", "/api/users/register", { body: { name: "Early Bird", email: env.ADMIN_EMAIL, password: "customer-pw-123", role: "admin" } });
      assert.equal(registered.status, 201);
      assert.equal((await ensureAdminAccount({ env, UserModel: models.User, logger: silentLogger })).status, "customer_exists");
      const stored = await models.User.findOne({ email: env.ADMIN_EMAIL }).lean();
      assert.equal(stored.role, "customer");
      const signedIn = await login(ctx, env.ADMIN_EMAIL, "customer-pw-123");
      assert.equal(signedIn.body.role, "customer");
      assert.equal((await login(ctx, env.ADMIN_EMAIL, PASSWORD)).status, 400);
      assert.equal((await ctx.request("GET", "/api/admin/orders", { token: signedIn.body.token })).status, 403);
    } finally {
      await ctx.close();
    }
  });
});
