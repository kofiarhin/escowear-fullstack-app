// Payment-screenshot retention. The retention period is an OPEN owner/legal
// decision, so this never runs on a schedule and deletes nothing by default:
//
//   node server/scripts/purgePaymentProofs.js            # report only
//   node server/scripts/purgePaymentProofs.js --apply    # delete eligible files
//
// Only acts when ESCOWEAR_PROOF_RETENTION_DAYS > 0, and only on orders that are
// finished (completed, refunded, cancelled) and unchanged for that many days.
// Metadata (reference, hash, review outcome) is kept for the audit trail.
// Take and verify a backup of the proof volume before using --apply.
const TERMINAL = ["completed", "refunded", "cancelled"];

const findEligible = async ({ Order, PaymentProof, retentionDays, now = new Date() }) => {
  if (!(retentionDays > 0)) return [];
  const cutoff = new Date(now.getTime() - retentionDays * 86400000);
  const orders = await Order.find({ status: { $in: TERMINAL }, updatedAt: { $lt: cutoff } }).lean();
  const eligible = [];
  for (const order of orders) {
    const proofs = await PaymentProof.find({ orderId: order._id, filePurgedAt: { $exists: false } }).lean();
    eligible.push(...proofs.map((proof) => ({ proof, order })));
  }
  return eligible;
};

const purge = async ({ Order, PaymentProof, storage, retentionDays, apply = false, now = new Date(), logger = console }) => {
  const eligible = await findEligible({ Order, PaymentProof, retentionDays, now });
  let removed = 0;
  if (apply) {
    for (const { proof } of eligible) {
      await storage.remove(proof.storageKey);
      await PaymentProof.updateOne({ _id: proof._id }, { $set: { filePurgedAt: now } });
      removed += 1;
    }
    await storage.sweepPartials();
  }
  logger.log(`${eligible.length} proof file(s) eligible; ${apply ? `${removed} removed` : "report only (use --apply to delete)"}`);
  return { eligible: eligible.length, removed };
};

if (require.main === module) {
  require("dotenv").config();
  const mongoose = require("mongoose");
  const { connectDB } = require("../db/db");
  const { getOrderConfig } = require("../config/orders");
  const { createProofStorage } = require("../services/proofStorage");
  const config = getOrderConfig();
  const run = async () => {
    if (!config.proofRetentionDays) {
      console.log("ESCOWEAR_PROOF_RETENTION_DAYS is not set: retention is undecided, nothing to do.");
      return;
    }
    await connectDB();
    await purge({
      Order: require("../Models/Order.model"),
      PaymentProof: require("../Models/PaymentProof.model"),
      storage: createProofStorage({ rootDir: config.proofUploadDir }),
      retentionDays: config.proofRetentionDays,
      apply: process.argv.includes("--apply"),
    });
  };
  run()
    .catch((error) => {
      console.error(`Proof purge failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { TERMINAL, findEligible, purge };
