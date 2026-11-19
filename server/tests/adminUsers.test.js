// Admin user management (in-memory models; no MongoDB).
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { startTestApp, userToken } = require("./helpers/testApp");

const sessionToken = (user) => jwt.sign({ id: String(user._id), sv: user.sessionVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

const setup = async (t, options) => {
  const ctx = await startTestApp(options);
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin", email: "admin@example.test", name: "Esco Admin" });
  return { ctx, admin, token: userToken(admin._id) };
};

test("admin user endpoints require an admin session", async (t) => {
  const { ctx } = await setup(t);
  const customer = await ctx.addUser();
  const customerToken = userToken(customer._id);

  assert.equal((await ctx.request("GET", "/api/admin/users")).status, 401);
  assert.equal((await ctx.request("GET", "/api/admin/users", { token: customerToken })).status, 403);
  assert.equal((await ctx.request("PATCH", `/api/admin/users/${customer._id}/block`, { token: customerToken, body: { blocked: true } })).status, 403);
  assert.equal((await ctx.request("DELETE", `/api/admin/users/${customer._id}`, { token: customerToken })).status, 403);
  assert.equal(await ctx.models.User.countDocuments({ _id: customer._id }), 1);
});

test("admin lists users newest first with safe fields only", async (t) => {
  const { ctx, token } = await setup(t);
  await ctx.addUser({ email: "ama@example.test", name: "Ama", passwordResetToken: "reset-digest", sessionVersion: 3 });
  await ctx.addUser({ email: "kojo@example.test", name: "Kojo", blocked: true, blockedAt: new Date("2026-11-01T00:00:00Z") });

  const response = await ctx.request("GET", "/api/admin/users", { token });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.body.items.map((user) => user.email), ["kojo@example.test", "ama@example.test", "admin@example.test"]);
  assert.deepEqual(Object.keys(response.body.items[0]).sort(), ["blocked", "blockedAt", "createdAt", "email", "id", "name", "role"]);
  assert.equal(response.body.items[0].blocked, true);
  assert.equal(response.body.items[1].blocked, false);
  assert.equal(response.body.items[2].role, "admin");
  assert.deepEqual(response.body.pagination, { total: 3, page: 1, limit: 20, pages: 1 });

  const serialized = JSON.stringify(response.body);
  for (const secret of ["password", "hashed", "reset-digest", "sessionVersion"]) assert.equal(serialized.includes(secret), false, `must not expose ${secret}`);
});

test("admin can search users by email, case-insensitively and literally", async (t) => {
  const { ctx, token } = await setup(t);
  await ctx.addUser({ email: "ama.mensah@example.test" });
  await ctx.addUser({ email: "amaXmensah@example.test" });

  const byPart = await ctx.request("GET", "/api/admin/users?q=AMA.MENSAH", { token });
  assert.equal(byPart.status, 200);
  // "." is matched literally, not as a regex wildcard.
  assert.deepEqual(byPart.body.items.map((user) => user.email), ["ama.mensah@example.test"]);

  const none = await ctx.request("GET", "/api/admin/users?q=nobody", { token });
  assert.deepEqual(none.body.items, []);
  assert.equal(none.body.pagination.total, 0);
});

test("blocking a customer revokes their session and stops sign-in until unblocked", async (t) => {
  const { ctx, token } = await setup(t, { deps: { users: {} } });
  const password = "correct-horse-battery";
  const customer = await ctx.addUser({ email: "ama@example.test", password: await bcrypt.hash(password, 4) });
  const customerSession = sessionToken(customer);
  assert.equal((await ctx.request("GET", "/api/orders", { token: customerSession })).status, 200);

  const blocked = await ctx.request("PATCH", `/api/admin/users/${customer._id}/block`, { token, body: { blocked: true } });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.item.blocked, true);
  assert.ok(blocked.body.item.blockedAt);

  assert.equal((await ctx.request("GET", "/api/orders", { token: customerSession })).status, 401);
  const login = await ctx.request("POST", "/api/users/login", { body: { email: "ama@example.test", password } });
  assert.equal(login.status, 403);
  assert.equal(login.body.code, "ACCOUNT_BLOCKED");
  // A wrong password still gets the generic answer.
  assert.equal((await ctx.request("POST", "/api/users/login", { body: { email: "ama@example.test", password: "wrong-password" } })).status, 400);

  const unblocked = await ctx.request("PATCH", `/api/admin/users/${customer._id}/block`, { token, body: { blocked: false } });
  assert.equal(unblocked.status, 200);
  assert.equal(unblocked.body.item.blocked, false);
  assert.equal(unblocked.body.item.blockedAt, null);
  // The pre-block token stays revoked; a fresh sign-in works again.
  assert.equal((await ctx.request("GET", "/api/orders", { token: customerSession })).status, 401);
  const relogin = await ctx.request("POST", "/api/users/login", { body: { email: "ama@example.test", password } });
  assert.equal(relogin.status, 200);
  assert.equal((await ctx.request("GET", "/api/orders", { token: relogin.body.token })).status, 200);
});

test("a blocked flag rejects even a token with the current session version", async (t) => {
  const { ctx } = await setup(t);
  const customer = await ctx.addUser({ blocked: true });
  const response = await ctx.request("GET", "/api/orders", { token: sessionToken(customer) });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "ACCOUNT_BLOCKED");
});

test("block validates its input and target", async (t) => {
  const { ctx, admin, token } = await setup(t);
  const customer = await ctx.addUser();
  const otherAdmin = await ctx.addUser({ role: "admin" });

  for (const body of [{}, { blocked: "true" }, { blocked: 1 }]) {
    const response = await ctx.request("PATCH", `/api/admin/users/${customer._id}/block`, { token, body });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "VALIDATION_ERROR");
  }
  assert.equal((await ctx.request("PATCH", "/api/admin/users/not-an-id/block", { token, body: { blocked: true } })).status, 404);
  assert.equal((await ctx.request("PATCH", "/api/admin/users/672b0e3a1a2b3c4d5e6f7002/block", { token, body: { blocked: true } })).status, 404);

  const self = await ctx.request("PATCH", `/api/admin/users/${admin._id}/block`, { token, body: { blocked: true } });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, "SELF_ACTION");
  const peer = await ctx.request("PATCH", `/api/admin/users/${otherAdmin._id}/block`, { token, body: { blocked: true } });
  assert.equal(peer.status, 409);
  assert.equal(peer.body.code, "ADMIN_ACCOUNT");
  assert.equal(await ctx.models.User.countDocuments({ blocked: true }), 0);
});

test("admin can delete a customer but not themselves or another admin", async (t) => {
  const { ctx, admin, token } = await setup(t);
  const customer = await ctx.addUser();
  const otherAdmin = await ctx.addUser({ role: "admin" });

  const deleted = await ctx.request("DELETE", `/api/admin/users/${customer._id}`, { token });
  assert.equal(deleted.status, 204);
  assert.equal(await ctx.models.User.countDocuments({ _id: customer._id }), 0);
  assert.equal((await ctx.request("DELETE", `/api/admin/users/${customer._id}`, { token })).status, 404);
  assert.equal((await ctx.request("DELETE", "/api/admin/users/not-an-id", { token })).status, 404);

  // A session for the deleted account is signed out, not left half-working.
  const deletedSession = await ctx.request("GET", "/api/orders", { token: userToken(customer._id) });
  assert.equal(deletedSession.status, 401);
  assert.equal(deletedSession.body.code, "ACCOUNT_NOT_FOUND");

  assert.equal((await ctx.request("DELETE", `/api/admin/users/${admin._id}`, { token })).body.code, "SELF_ACTION");
  assert.equal((await ctx.request("DELETE", `/api/admin/users/${otherAdmin._id}`, { token })).body.code, "ADMIN_ACCOUNT");
  assert.equal(await ctx.models.User.countDocuments({ role: "admin" }), 2);
});

test("admin user endpoints return a safe error when storage fails", async (t) => {
  const { ctx, token } = await setup(t);
  ctx.models.User.countDocuments = async () => { throw new Error("private storage failure"); };
  const response = await ctx.request("GET", "/api/admin/users", { token });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Users could not be loaded", code: "SERVER_ERROR" });
});
