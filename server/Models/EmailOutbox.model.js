const mongoose = require("mongoose");

const { Schema } = mongoose;

// Durable transactional mail queue. `dedupeKey` makes each logical message
// (template + order + event) unique, so retries cannot send it twice.
const emailOutboxSchema = new Schema(
  {
    dedupeKey: { type: String, required: true, immutable: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", immutable: true },
    kind: { type: String, required: true, immutable: true },
    to: { type: String, required: true, immutable: true },
    templateVersion: { type: String, required: true, immutable: true },
    payload: { type: Schema.Types.Mixed },
    state: {
      type: String,
      enum: ["queued", "sending", "sent", "failed"],
      default: "queued",
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: Date,
    providerMessageId: String,
    lastError: String,
    sentAt: Date,
  },
  { timestamps: true }
);

emailOutboxSchema.index({ dedupeKey: 1 }, { name: "unique_email_dedupe_key", unique: true });
emailOutboxSchema.index({ state: 1, nextAttemptAt: 1 }, { name: "state_next_attempt" });
emailOutboxSchema.index({ orderId: 1, createdAt: 1 }, { name: "order_created" });

const EmailOutbox = mongoose.models.EmailOutbox || mongoose.model("EmailOutbox", emailOutboxSchema);

module.exports = EmailOutbox;
