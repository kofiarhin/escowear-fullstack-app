const test = require("node:test");
const assert = require("node:assert/strict");
const { connectTestDb, skipReason } = require("./helpers/realDb");
const { startTestApp, silentLogger } = require("./helpers/testApp");

const startRateLimitApp = (models, now, RateLimit = models.RateLimit) =>
  startTestApp({
    models,
    deps: {
      users: {
        RateLimit,
        now,
        logger: silentLogger,
        publicBaseUrl: "https://shop.example.test",
        transportFactory: () => ({ send: async () => ({ providerMessageId: "test" }) }),
      },
    },
  });

test("persistent authentication rate limits use one real-Mongo counter across app instances", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  let time = new Date("2026-11-10T12:00:00.000Z");
  const first = await startRateLimitApp(db.models, () => time);
  const second = await startRateLimitApp(db.models, () => time);
  t.after(first.close);
  t.after(second.close);

  const requests = await Promise.all(
    Array.from({ length: 10 }, (_, index) => (index % 2 ? first : second).request("POST", "/api/users/forgot-password", { body: { email: `unknown-${index}@example.test` } }))
  );
  assert.equal(requests.filter((response) => response.status === 202).length, 10);

  const overLimit = await Promise.all([
    first.request("POST", "/api/users/forgot-password", { body: { email: "over-1@example.test" } }),
    second.request("POST", "/api/users/forgot-password", { body: { email: "over-2@example.test" } }),
  ]);
  overLimit.forEach((response) => {
    assert.equal(response.status, 429);
    assert.equal(response.body.code, "RATE_LIMITED");
    assert.ok(response.headers.get("retry-after"));
  });

  time = new Date(time.getTime() + 16 * 60 * 1000);
  const afterExpiry = await second.request("POST", "/api/users/forgot-password", { body: { email: "after-expiry@example.test" } });
  assert.equal(afterExpiry.status, 202);
});

test("persistent authentication rate limiting returns 503 for a database failure", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  const unavailable = { findOneAndUpdate: async () => { throw new Error("database unavailable"); } };
  const ctx = await startRateLimitApp(db.models, () => new Date(), unavailable);
  t.after(ctx.close);

  const response = await ctx.request("POST", "/api/users/forgot-password", { body: { email: "unknown@example.test" } });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "RATE_LIMIT_UNAVAILABLE");
});
