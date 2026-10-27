const mongoose = require("mongoose");

const { Schema } = mongoose;

// Metadata for a customer-uploaded Mobile Money payment screenshot. The image
// bytes live in private storage (services/proofStorage.js), never in MongoDB.
// A proof is evidence only: it never verifies payment by itself.
const paymentProofSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, immutable: true },
    quoteVersion: { type: Number, required: true, min: 1, immutable: true },
    // As entered by the customer (trimmed) and an uppercase form for matching.
    transactionReference: { type: String, required: true, immutable: true },
    referenceNormalized: { type: String, required: true, immutable: true },
    // Private storage key; never serialized to customers.
    storageKey: { type: String, required: true, immutable: true },
    contentType: { type: String, required: true, immutable: true },
    sizeBytes: { type: Number, required: true, immutable: true },
    width: Number,
    height: Number,
    // Hash of the stored (re-encoded) bytes and of the original upload.
    sha256: { type: String, required: true, immutable: true },
    originalSha256: { type: String, immutable: true },
    channel: { type: String, default: "website_upload", immutable: true },
    submitter: {
      type: { type: String, enum: ["guest", "customer"] },
      userId: { type: Schema.Types.ObjectId, ref: "User" },
    },
    // staged -> pending (order moved to payment_review) -> accepted | rejected.
    // A staged proof whose order transition failed is removed with its file.
    reviewStatus: { type: String, enum: ["staged", "pending", "accepted", "rejected"], default: "staged" },
    reviewedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    // Other orders whose proofs used the same reference (flag for the admin).
    duplicateReferenceOrderIds: { type: [Schema.Types.ObjectId], default: undefined },
    // Set when the image was deleted under the (pending) retention policy.
    filePurgedAt: Date,
    idempotencyKeyHash: { type: String, immutable: true },
    requestFingerprint: { type: String, immutable: true },
  },
  { timestamps: true }
);

paymentProofSchema.index({ orderId: 1, createdAt: 1 }, { name: "order_created" });
paymentProofSchema.index({ referenceNormalized: 1 }, { name: "reference" });
paymentProofSchema.index(
  { idempotencyKeyHash: 1 },
  { name: "unique_proof_idempotency_key", unique: true, partialFilterExpression: { idempotencyKeyHash: { $type: "string" } } }
);

const PaymentProof = mongoose.models.PaymentProof || mongoose.model("PaymentProof", paymentProofSchema);

module.exports = PaymentProof;
