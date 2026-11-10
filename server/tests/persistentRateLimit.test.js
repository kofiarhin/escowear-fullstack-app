const test = require("node:test");
const assert = require("node:assert/strict");
const { createPersistentRateLimiter } = require("../middlewares/persistentRateLimit");
const { createMemoryModel } = require("./helpers/memoryModel");

test("contention never turns an under-limit request into a false 429", async () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  const base = createMemoryModel({ uniques: ["key"] });
  await base.create({ key: "login:ip:127.0.0.1", count: 0, resetAt: new Date(now.getTime() + 60_000) });
  let postponedUpdates = 8;
  const RateLimit = {
    ...base,
    findOneAndUpdate(...args) {
      if (postponedUpdates-- > 0) return Promise.resolve(null);
      return base.findOneAndUpdate(...args);
    },
  };
  const limiter = createPersistentRateLimiter({ RateLimit, windowMs: 60_000, max: 2, now: () => now });

  const result = await limiter.consume("login:ip:127.0.0.1");
  assert.equal(result.allowed, true);
  assert.equal(base.docs[0].count, 1);
});

test("database errors remain a 503 instead of a 429", async () => {
  const limiter = createPersistentRateLimiter({
    RateLimit: { findOneAndUpdate: async () => { throw new Error("database unavailable"); } },
    windowMs: 60_000,
    max: 2,
  });
  const response = {
    statusCode: null,
    body: null,
    set() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await limiter({ ip: "127.0.0.1" }, response, () => assert.fail("next must not run"));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, "RATE_LIMIT_UNAVAILABLE");
});
