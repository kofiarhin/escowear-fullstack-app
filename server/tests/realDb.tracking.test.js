// IDE-117 against a real MongoDB (opt-in; see helpers/realDb.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { connectTestDb, skipReason } = require("./helpers/realDb");
const { newIdempotencyKey, sampleProduct, startTestApp, validOrderBody } = require("./helpers/testApp");

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

test("IDE-117 tracking codes on real MongoDB", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  const { models } = db;
  const setup = async () => {
    await db.reset();
    const ctx = await startTestApp({ models });
    const product = await models.Product.create(sampleProduct());
    const placed = await ctx.request("POST", "/api/orders", { body: validOrderBody(product._id), headers: { "Idempotency-Key": newIdempotencyKey() } });
    const identity = { orderNumber: placed.body.orderNumber, email: "ama.mensah@example.test" };
    const request = async () => {
      const response = await ctx.request("POST", "/api/orders/tracking/request", { body: identity });
      await settle();
      return response;
    };
    const verify = (code) => ctx.request("POST", "/api/orders/tracking/verify", { body: { ...identity, code } });
    const latestCode = async () => (await models.EmailOutbox.findOne({ kind: "tracking_code" }).sort({ createdAt: -1 }).lean())?.payload.text.match(/is: (\d{6})/)?.[1];
    return { ctx, placed, request, verify, latestCode };
  };

  await t.test("TTL index on challenges exists", async () => {
    const ttl = (await models.TrackingChallenge.collection.indexes()).find((index) => index.name === "expire_challenges");
    assert.equal(ttl.expireAfterSeconds, 86400);
  });

  await t.test("code issue, single use and scoped access", async () => {
    const { ctx, placed, request, verify, latestCode } = await setup();
    try {
      assert.equal((await request()).status, 202);
      const code = await latestCode();
      assert.match(code, /^\d{6}$/);
      const challenge = await models.TrackingChallenge.findOne({}).lean();
      assert.ok(!JSON.stringify(challenge).includes(code));
      const ok = await verify(code);
      assert.equal(ok.status, 200);
      assert.equal((await verify(code)).status, 400, "replay rejected");
      const view = await ctx.request("GET", `/api/orders/${placed.body.orderId}`, { headers: { "X-Order-Access-Token": ok.body.accessToken } });
      assert.equal(view.status, 200);
    } finally {
      await ctx.close();
    }
  });

  await t.test("20 parallel wrong guesses never exceed the attempt limit", async () => {
    const { ctx, request, verify, latestCode } = await setup();
    try {
      await request();
      const code = await latestCode();
      const wrong = code === "000000" ? "111111" : "000000";
      const results = await Promise.all(Array.from({ length: 20 }, () => verify(wrong)));
      assert.ok(results.every((response) => response.status === 400 || response.status === 429));
      const challenge = await models.TrackingChallenge.findOne({}).lean();
      assert.ok(challenge.attempts <= 5, `attempts=${challenge.attempts}`);
      assert.equal(challenge.consumedReason, "too_many_attempts");
      // Locked (400) or, after 20 tries from this IP, rate limited (429): never 200.
      assert.ok([400, 429].includes((await verify(code)).status), "locked code no longer works");
    } finally {
      await ctx.close();
    }
  });

  await t.test("10 parallel verifies of the correct code grant access exactly once", async () => {
    const { ctx, request, verify, latestCode } = await setup();
    try {
      await request();
      const code = await latestCode();
      const results = await Promise.all(Array.from({ length: 10 }, () => verify(code)));
      assert.equal(results.filter((response) => response.status === 200).length, 1, results.map((r) => r.status).join(","));
    } finally {
      await ctx.close();
    }
  });

  await t.test("unknown orders get the same response and create nothing", async () => {
    const { ctx } = await setup();
    try {
      const response = await ctx.request("POST", "/api/orders/tracking/request", { body: { orderNumber: "EW-ZZZZZ-ZZZZZ", email: "x@example.test" } });
      await settle();
      assert.equal(response.status, 202);
      assert.equal(await models.TrackingChallenge.countDocuments({}), 0);
    } finally {
      await ctx.close();
    }
  });
});
