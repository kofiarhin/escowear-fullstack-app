const mongoose = require("mongoose");

const { Schema } = mongoose;

// One-time tracking code. Only an HMAC of the code is stored; attempts are
// counted atomically and a code is consumed on first successful use.
const trackingChallengeSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, immutable: true },
    codeHash: { type: String, required: true, immutable: true },
    expiresAt: { type: Date, required: true, immutable: true },
    attempts: { type: Number, default: 0 },
    consumedAt: Date,
    consumedReason: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

trackingChallengeSchema.index({ orderId: 1, createdAt: -1 }, { name: "order_created" });
// Expired challenges hold no customer data and are removed a day after expiry.
trackingChallengeSchema.index({ expiresAt: 1 }, { name: "expire_challenges", expireAfterSeconds: 24 * 60 * 60 });

const TrackingChallenge =
  mongoose.models.TrackingChallenge || mongoose.model("TrackingChallenge", trackingChallengeSchema);

module.exports = TrackingChallenge;
