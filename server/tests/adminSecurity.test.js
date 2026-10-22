// IDE-125: admin account hardening.
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { startTestApp, userToken } = require("./helpers/testApp");
const { ADMIN_SESSION_SECONDS } = require("../middlewares/auth.middleware");

const tokenIssuedAgo = (userId, seconds) =>
  jwt.sign({ id: String(userId), iat: Math.floor(Date.now() / 1000) - seconds }, process.env.JWT_SECRET, { expiresIn: "30d" });

test("admin APIs need a sign-in from the last 12 hours", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const customer = await ctx.addUser();

  assert.equal((await ctx.request("GET", "/api/admin/orders", { token: userToken(admin._id) })).status, 200);
  assert.equal((await ctx.request("GET", "/api/admin/orders", { token: tokenIssuedAgo(admin._id, ADMIN_SESSION_SECONDS - 60) })).status, 200);
  const stale = await ctx.request("GET", "/api/admin/orders", { token: tokenIssuedAgo(admin._id, ADMIN_SESSION_SECONDS + 60) });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.code, "ADMIN_REAUTH_REQUIRED");
  // Customer tokens are unaffected by the admin rule (and still cannot reach admin APIs).
  assert.equal((await ctx.request("GET", "/api/admin/orders", { token: tokenIssuedAgo(customer._id, 20 * 86400) })).status, 403);
  assert.equal((await ctx.request("GET", "/api/orders", { token: tokenIssuedAgo(customer._id, 20 * 86400) })).status, 200);
});
