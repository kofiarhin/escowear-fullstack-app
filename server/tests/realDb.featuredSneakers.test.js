// IDE-135 against a real MongoDB (opt-in; see helpers/realDb.js): the
// compare-and-set save must give exactly one winner under real concurrency.
const test = require("node:test");
const assert = require("node:assert/strict");
const { connectTestDb, skipReason } = require("./helpers/realDb");
const { sampleProduct, startTestApp, userToken } = require("./helpers/testApp");

test("IDE-135 featured sneakers compare-and-set on real MongoDB", { skip: skipReason() }, async (t) => {
  const db = await connectTestDb();
  t.after(db.close);
  const { models } = db;
  await db.reset();
  const ctx = await startTestApp({ models });
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const products = await Promise.all([1, 2, 3, 4].map((index) => models.Product.create(sampleProduct({ name: `Real pair ${index}` }))));
  const save = (picked, expectedVersion) =>
    ctx.request("PUT", "/api/admin/featured-sneakers", { token, body: { productIds: picked.map((product) => String(product._id)), expectedVersion } });

  const creates = await Promise.all([save([products[0]], 0), save([products[1]], 0), save([products[2]], 0)]);
  assert.deepEqual(creates.map((response) => response.status).sort(), [200, 409, 409]);

  const updates = await Promise.all([save([products[3], products[0]], 1), save([products[2]], 1), save([], 1)]);
  assert.deepEqual(updates.map((response) => response.status).sort(), [200, 409, 409]);
  const winner = updates.find((response) => response.status === 200).body.item.productIds;

  const stored = await models.FeaturedSneakers.findById("homepage").lean();
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.productIds.map(String), winner);

  const publicRead = await ctx.request("GET", "/api/featured-sneakers");
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.version, 2);
  assert.deepEqual(publicRead.body.items.map((item) => String(item._id)), winner);
});
