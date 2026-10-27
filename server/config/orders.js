// Order workflow settings. Durations are provisional engineering defaults
// pending the retention/expiry decision (D6) and can be overridden per env.
const path = require("path");
const { version: POLICY_VERSION } = require("../../client/src/policies/review.json");

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// Uploaded payment screenshots: hard ceiling regardless of configuration.
const PROOF_MAX_BYTES_CEILING = 10 * 1024 * 1024;
const DEFAULT_PROOF_DIR = path.resolve(__dirname, "../../data/payment-proofs");

// The one mailbox customers reply to: EMAIL_REPLY_TO, else the EMAIL_FROM address.
const supportMailbox = (env) => {
  const raw = (env.EMAIL_REPLY_TO || env.EMAIL_FROM || "").trim();
  const match = raw.match(/<([^<>\s]+@[^<>\s]+)>/) || raw.match(/^([^\s<>]+@[^\s<>]+)$/);
  return match ? match[1] : "";
};

const getOrderConfig = (env = process.env) => ({
  // Lifetime of the read-only handoff token returned after checkout.
  checkoutAccessTtlMinutes: positiveInt(env.ORDER_CHECKOUT_ACCESS_TTL_MINUTES, 60),
  // Lifetime of the read-only token granted after a tracking code is verified.
  trackingAccessTtlMinutes: positiveInt(env.ORDER_TRACKING_ACCESS_TTL_MINUTES, 30),
  trackingCodeTtlMinutes: positiveInt(env.ORDER_TRACKING_CODE_TTL_MINUTES, 10),
  trackingCodeMaxAttempts: positiveInt(env.ORDER_TRACKING_CODE_MAX_ATTEMPTS, 5),
  trackingCodesPerOrderPerHour: positiveInt(env.ORDER_TRACKING_CODES_PER_HOUR, 5),
  // Public site origin used to build links in emails (no tokens are put in links).
  publicBaseUrl: (env.ESCOWEAR_PUBLIC_URL || "").replace(/\/+$/, ""),
  // Policy wording in emails stays off until the legal review is complete.
  policiesPublished: env.ESCOWEAR_POLICIES_STATUS === "published",
  // While published, orders must record this version (not one the browser chose).
  policyVersion: POLICY_VERSION,
  // Short-lived capability that lets the proven order owner upload payment proof.
  proofAccessTtlMinutes: positiveInt(env.ORDER_PROOF_ACCESS_TTL_MINUTES, 60),
  // Private directory for payment screenshots (never under a static/web root).
  proofUploadDir: path.resolve(env.ESCOWEAR_PROOF_UPLOAD_DIR || DEFAULT_PROOF_DIR),
  proofMaxBytes: Math.min(positiveInt(env.ESCOWEAR_PROOF_MAX_BYTES, 5 * 1024 * 1024), PROOF_MAX_BYTES_CEILING),
  // Retention is an open owner/legal decision: 0 means "keep" (no purge).
  proofRetentionDays: Number.parseInt(env.ESCOWEAR_PROOF_RETENTION_DAYS, 10) > 0 ? Number.parseInt(env.ESCOWEAR_PROOF_RETENTION_DAYS, 10) : 0,
  // Optional operations inbox told (without the image) that a proof arrived.
  adminNotifyEmail: (env.ESCOWEAR_ADMIN_NOTIFY_EMAIL || "").trim(),
  supportEmail: supportMailbox(env),
});

module.exports = { PROOF_MAX_BYTES_CEILING, getOrderConfig, supportMailbox };
