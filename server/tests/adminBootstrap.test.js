// Owner admin account from ADMIN_EMAIL / ADMIN_PASSWORD (create-only, never logged).
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { adminSettingsProblems, ensureAdminAccount, maskEmail } = require("../services/adminBootstrap");

const PASSWORD = "Fixture-admin-pass-1";
const env = { ADMIN_EMAIL: " Owner@Example.test ", ADMIN_PASSWORD: PASSWORD };

// Minimal stand-in for the Mongoose model: updateOne with $setOnInsert upsert.
const fakeUsers = (docs = []) => ({
  docs,
  async updateOne(filter, update, options) {
    if (docs.some((doc) => doc.email === filter.email)) return { upsertedCount: 0 };
    assert.equal(options.upsert, true);
    docs.push({ ...update.$setOnInsert });
    return { upsertedCount: 1 };
  },
  findOne(filter) {
    const doc = docs.find((entry) => entry.email === filter.email);
    return { select: () => ({ lean: async () => doc || null }) };
  },
});
const capture = () => {
  const lines = [];
  return { lines, log: (line) => lines.push(line), error: (line) => lines.push(line) };
};

test("creates a hashed admin account once and never logs the password", async () => {
  const UserModel = fakeUsers();
  const logger = capture();
  assert.equal((await ensureAdminAccount({ env, UserModel, logger })).status, "created");
  const [admin] = UserModel.docs;
  assert.equal(admin.email, "owner@example.test");
  assert.equal(admin.role, "admin");
  assert.notEqual(admin.password, PASSWORD);
  assert.ok(await bcrypt.compare(PASSWORD, admin.password));
  assert.ok(!logger.lines.join("\n").includes(PASSWORD));
  assert.ok(!logger.lines.join("\n").includes("owner@example.test"), "email is masked in logs");
});

test("an existing admin is left unchanged: no duplicate, no password reset", async () => {
  const UserModel = fakeUsers([{ email: "owner@example.test", role: "admin", password: "existing-hash" }]);
  const result = await ensureAdminAccount({ env: { ...env, ADMIN_PASSWORD: "A-different-password-2" }, UserModel, logger: capture() });
  assert.equal(result.status, "exists");
  assert.equal(UserModel.docs.length, 1);
  assert.equal(UserModel.docs[0].password, "existing-hash");
});

test("a customer account with the admin email is never promoted", async () => {
  const UserModel = fakeUsers([{ email: "owner@example.test", role: "customer", password: "someone-elses-hash" }]);
  const logger = capture();
  assert.equal((await ensureAdminAccount({ env, UserModel, logger })).status, "customer_exists");
  assert.equal(UserModel.docs[0].role, "customer");
  assert.match(logger.lines.join("\n"), /not promoted/);
});

test("unset settings do nothing; invalid settings are reported by name and create nothing", async () => {
  const UserModel = fakeUsers();
  assert.equal((await ensureAdminAccount({ env: {}, UserModel })).status, "not_configured");
  const logger = capture();
  const short = await ensureAdminAccount({ env: { ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: "short-pw" }, UserModel, logger });
  assert.equal(short.status, "invalid");
  assert.ok(!logger.lines.join("\n").includes("short-pw"));
  assert.deepEqual(adminSettingsProblems({ ADMIN_PASSWORD: PASSWORD }), ["ADMIN_EMAIL must be an email address"]);
  assert.equal(UserModel.docs.length, 0);
  assert.equal(maskEmail("kofi@example.test"), "k***@example.test");
});

test("a concurrent start that loses the unique-index race reports the existing admin", async () => {
  const UserModel = fakeUsers([{ email: "owner@example.test", role: "admin" }]);
  UserModel.updateOne = async () => {
    throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
  };
  assert.equal((await ensureAdminAccount({ env, UserModel, logger: capture() })).status, "exists");
});
