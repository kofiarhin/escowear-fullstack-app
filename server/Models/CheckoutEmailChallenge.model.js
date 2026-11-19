const mongoose = require("mongoose");

const { Schema } = mongoose;

// One-time 6-digit code proving a guest controls the checkout email. Bound to
// the normalized email and a hash of the checkout attempt's Idempotency-Key.
// Only an HMAC of the code is stored; attempts are counted atomically.
const checkoutEmailChallengeSchema = new Schema(
  {
    emailNormalized: { type: String, required: true, immutable: true },
    intentHash: { type: String, required: true, immutable: true },
    codeHash: { type: String, required: true, immutable: true },
    expiresAt: { type: Date, required: true, immutable: true },
    attempts: { type: Number, default: 0 },
    consumedAt: Date,
    consumedReason: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

checkoutEmailChallengeSchema.index({ emailNormalized: 1, intentHash: 1, createdAt: -1 }, { name: "email_intent_created" });
// Challenges hold an email address only briefly: removed a day after expiry.
checkoutEmailChallengeSchema.index({ expiresAt: 1 }, { name: "expire_challenges", expireAfterSeconds: 24 * 60 * 60 });

const CheckoutEmailChallenge =
  mongoose.models.CheckoutEmailChallenge || mongoose.model("CheckoutEmailChallenge", checkoutEmailChallengeSchema);

module.exports = CheckoutEmailChallenge;
