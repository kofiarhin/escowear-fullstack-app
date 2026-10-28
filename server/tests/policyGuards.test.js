const test = require("node:test");
const assert = require("node:assert/strict");
const { assertPolicyPublication } = require("../server");
const { getOrderConfig } = require("../config/orders");
const review = require("../../client/src/policies/review.json");
const { newIdempotencyKey, sampleProduct, startTestApp, validOrderBody } = require("./helpers/testApp");

test("the server refuses to start with published policies while the publication guard fails", () => {
  const published = { ESCOWEAR_POLICIES_STATUS: "published" };
  assert.throws(() => assertPolicyPublication(published, () => ["Seller name is missing"]), /1 publication requirement/);
  // The real draft is incomplete, so the default guard must also refuse.
  assert.throws(() => assertPolicyPublication(published), /publication requirement/);
  assert.doesNotThrow(() => assertPolicyPublication(published, () => []));
  for (const status of [undefined, "hidden", "draft"]) {
    assert.doesNotThrow(() => assertPolicyPublication({ ESCOWEAR_POLICIES_STATUS: status }, () => ["missing"]));
  }
});

test("the server refuses to start when its policy status differs from the site build's", () => {
  const ok = () => [];
  assert.throws(() => assertPolicyPublication({ ESCOWEAR_BUILD_POLICIES_STATUS: "hidden", ESCOWEAR_POLICIES_STATUS: "published" }, ok), /built with hidden; rebuild/);
  assert.throws(() => assertPolicyPublication({ ESCOWEAR_BUILD_POLICIES_STATUS: "published" }, ok), /hidden but the site was built with published/);
  assert.doesNotThrow(() => assertPolicyPublication({ ESCOWEAR_BUILD_POLICIES_STATUS: "hidden" }, ok));
  assert.doesNotThrow(() => assertPolicyPublication({ ESCOWEAR_BUILD_POLICIES_STATUS: "published", ESCOWEAR_POLICIES_STATUS: "published" }, ok));
  // Outside the image (local development) there is no recorded build status.
  assert.doesNotThrow(() => assertPolicyPublication({ ESCOWEAR_POLICIES_STATUS: "draft" }, ok));
});

test("the policy version comes from the shared review record", () => {
  assert.equal(getOrderConfig({}).policyVersion, review.version);
});

const setup = async (t, config) => {
  const ctx = await startTestApp({ config });
  t.after(ctx.close);
  const product = await ctx.models.Product.create(sampleProduct());
  const place = (body, key = newIdempotencyKey()) => ctx.request("POST", "/api/orders", { body, headers: { "Idempotency-Key": key } });
  return { ctx, product, place };
};

test("while published, orders must record the server's published policy version", async (t) => {
  const { ctx, product, place } = await setup(t, { policiesPublished: true, policyVersion: "mvp-2026-11-01" });

  const stale = await place(validOrderBody(product._id, { termsVersion: "2026-10-draft" }));
  assert.equal(stale.status, 422);
  assert.equal(stale.body.code, "POLICY_VERSION_CHANGED");
  assert.match(stale.body.error, /refresh the page/i);
  assert.equal(ctx.models.Order.docs.length, 0);

  const current = await place(validOrderBody(product._id, { termsVersion: "mvp-2026-11-01" }));
  assert.equal(current.status, 201);
  assert.equal(ctx.models.Order.docs[0].termsVersion, "mvp-2026-11-01");
});

test("a retry of an order created before a policy change replays instead of failing", async (t) => {
  const { ctx, product, place } = await setup(t, { policiesPublished: true, policyVersion: "v1" });
  const key = newIdempotencyKey();
  const body = validOrderBody(product._id, { termsVersion: "v1" });
  assert.equal((await place(body, key)).status, 201);
  ctx.config.policyVersion = "v2";
  assert.equal((await place(body, key)).status, 200);
  assert.equal(ctx.models.Order.docs.length, 1);
});

test("while unpublished, the existing draft terms version is still accepted", async (t) => {
  const { ctx, product, place } = await setup(t, { policiesPublished: false });
  assert.equal((await place(validOrderBody(product._id))).status, 201);
  assert.equal(ctx.models.Order.docs[0].termsVersion, "2026-10-draft");
});
