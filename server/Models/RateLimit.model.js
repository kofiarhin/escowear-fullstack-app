const mongoose = require("mongoose");

// Shared fixed-window counters for sensitive public endpoints. MongoDB's
// atomic document updates make the limits hold across Node processes and
// container restarts; the TTL index removes expired windows automatically.
const rateLimitSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, immutable: true },
    count: { type: Number, required: true, min: 0 },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false }
);

rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0, name: "rate_limit_expiry" });

module.exports = mongoose.models.RateLimit || mongoose.model("RateLimit", rateLimitSchema);
