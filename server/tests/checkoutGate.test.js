const test = require("node:test");
const assert = require("node:assert/strict");
const { assertCheckoutReadiness } = require("../server");
const { getOrderConfig } = require("../config/orders");
const { checkReleaseConfig } = require("../scripts/releaseCheck");
const { newIdempotencyKey, sampleProduct, startTestApp, validOrderBody } = require("./helpers/testApp");

test("checkout is closed unless ESCOWEAR_CHECKOUT_OPEN is exactly true", () => {
  assert.equal(getOrderConfig({}).checkoutOpen, false);
  assert.equal(getOrderConfig({ ESCOWEAR_CHECKOUT_OPEN: "yes" }).checkoutOpen, false);
  assert.equal(getOrderConfig({ ESCOWEAR_CHECKOUT_OPEN: "true" }).checkoutOpen, true);
});

test("a closed checkout refuses new orders but still replays an existing one", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const product = await ctx.models.Product.create(sampleProduct());
  const key = newIdempotencyKey();
  const body = validOrderBody(product._id);
  const place = (k) => ctx.request("POST", "/api/orders", { body, headers: { "Idempotency-Key": k } });
  assert.equal((await place(key)).status, 201);

  ctx.config.checkoutOpen = false;
  const status = await ctx.request("GET", "/api/orders/checkout-status");
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { open: false });
  assert.equal(status.headers.get("cache-control"), "no-store");

  const refused = await place(newIdempotencyKey());
  assert.equal(refused.status, 503);
  assert.equal(refused.body.code, "CHECKOUT_CLOSED");
  assert.equal((await place(key)).status, 200, "retry of the earlier order replays");
  assert.equal(ctx.models.Order.docs.length, 1);
});

test("the server refuses to start with checkout open while launch requirements are missing", () => {
  const open = { ESCOWEAR_CHECKOUT_OPEN: "true" };
  assert.throws(() => assertCheckoutReadiness(open, () => ["ESCOWEAR_PAYMENT_INSTRUCTIONS is missing"]), /1 launch requirement/);
  assert.doesNotThrow(() => assertCheckoutReadiness(open, () => []));
  for (const value of [undefined, "false", "TRUE"]) {
    assert.doesNotThrow(() => assertCheckoutReadiness({ ESCOWEAR_CHECKOUT_OPEN: value }, () => ["missing"]));
  }
  // The default check uses the real release gates, which fail with no settings.
  assert.throws(() => assertCheckoutReadiness(open), /launch requirement/);
});

test("release check rejects placeholder or test payment details", () => {
  const problems = (instructions) => checkReleaseConfig({ ESCOWEAR_PAYMENT_INSTRUCTIONS: instructions }, []);
  const rejected = [
    "PLACEHOLDER — set real details",
    "TEST MOMO CHANNEL\\nNot a real account",
    "Example number",
    // The layout from .env.example, pasted unchanged.
    "MTN Mobile Money\\nNumber: 0XX XXX XXXX\\nName: <account name>",
    "TESTING ONLY",
    "Fake number 0240000000",
    "Sample account",
    "placeholders",
  ];
  for (const value of rejected) {
    assert.ok(problems(value).some((p) => /placeholder\/test wording/.test(p)), value);
  }
  assert.ok(!problems("MTN Mobile Money\\nNumber: 024 000 0000\\nName: Latest Trading").some((p) => /placeholder/.test(p)));
});
