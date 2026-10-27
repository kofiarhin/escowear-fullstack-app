const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Types } = require("mongoose");
const { createMemoryModel } = require("./helpers/memoryModel");
const { tempProofDir } = require("./helpers/testApp");
const { createProofStorage } = require("../services/proofStorage");
const { purge } = require("../scripts/purgePaymentProofs");

const quiet = { log() {} };

test("retention purge is off unless configured, reports by default, and only touches old finished orders", async (t) => {
  const dir = tempProofDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = createProofStorage({ rootDir: dir });
  const Order = createMemoryModel();
  const PaymentProof = createMemoryModel();
  const now = new Date("2027-06-01T00:00:00Z");
  const old = new Date("2027-01-01T00:00:00Z");
  const make = async (status, updatedAt) => {
    const order = await Order.create({ status });
    Order.docs.at(-1).updatedAt = updatedAt;
    const key = await storage.save(order._id, Buffer.from("img"), "png");
    await PaymentProof.create({ orderId: order._id, storageKey: key });
    return key;
  };
  const finishedOld = await make("completed", old);
  const openOld = await make("processing", old);
  const finishedRecent = await make("refunded", new Date("2027-05-30T00:00:00Z"));

  assert.deepEqual(await purge({ Order, PaymentProof, storage, retentionDays: 0, apply: true, now, logger: quiet }), { eligible: 0, removed: 0 });
  assert.deepEqual(await purge({ Order, PaymentProof, storage, retentionDays: 90, now, logger: quiet }), { eligible: 1, removed: 0 });
  assert.ok(fs.existsSync(path.join(dir, finishedOld)), "report-only deletes nothing");

  assert.deepEqual(await purge({ Order, PaymentProof, storage, retentionDays: 90, apply: true, now, logger: quiet }), { eligible: 1, removed: 1 });
  assert.ok(!fs.existsSync(path.join(dir, finishedOld)));
  assert.ok(fs.existsSync(path.join(dir, openOld)));
  assert.ok(fs.existsSync(path.join(dir, finishedRecent)));
  assert.equal(PaymentProof.docs.length, 3, "metadata kept for the audit trail");
  assert.deepEqual(await purge({ Order, PaymentProof, storage, retentionDays: 90, apply: true, now, logger: quiet }), { eligible: 0, removed: 0 });
});

test("storage refuses keys that could escape the proof directory", async (t) => {
  const dir = tempProofDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = createProofStorage({ rootDir: dir });
  for (const key of ["../etc/passwd", `${new Types.ObjectId()}/../../x.png`, "/abs/path.png", `${new Types.ObjectId()}/name.svg`]) {
    await assert.rejects(storage.read(key), /Invalid storage key/);
  }
  const key = await storage.save(new Types.ObjectId(), Buffer.from("x"), "png");
  assert.equal((fs.statSync(path.join(dir, path.dirname(key))).mode & 0o777), 0o700);
  fs.writeFileSync(path.join(dir, path.dirname(key), "stale.png.abcd.part"), "x");
  fs.utimesSync(path.join(dir, path.dirname(key), "stale.png.abcd.part"), new Date(0), new Date(0));
  assert.equal(await storage.sweepPartials(), 1);
});
