// Order workflow settings. Durations are provisional engineering defaults
// pending the retention/expiry decision (D6) and can be overridden per env.
const { version: POLICY_VERSION } = require("../../client/src/policies/review.json");

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
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
});

module.exports = { getOrderConfig };
