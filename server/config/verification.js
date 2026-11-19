// Account email verification and guest checkout email-code settings (IDE-152).
// The product limits are fixed decisions, not environment settings; only the
// cleanup job's operational switches come from the environment.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const VERIFICATION = Object.freeze({
  // Verification links are single-use and expire after 24 hours.
  linkTtlMs: DAY_MS,
  // New accounts must verify within 7 days of creation; never extended.
  accountDeadlineMs: 7 * DAY_MS,
  // The final warning goes out about 24 hours before the deadline (Day 6).
  finalWarningBeforeMs: DAY_MS,
  // Customer-requested resends and email corrections share one budget.
  resendWindowMs: DAY_MS,
  resendMax: 3,
  resendCooldownMs: 60 * 1000,
  // Restricted pre-login credential for resend, correction and status only.
  pendingTokenTtlSeconds: 60 * 60,
});

const GUEST_EMAIL_CODE = Object.freeze({
  ttlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  // Proof that the code was verified; long enough to finish placing the order.
  proofTtlSeconds: 30 * 60,
});

const getLifecycleConfig = (env = process.env) => ({
  intervalMs: 15 * 60 * 1000,
  // Dry run reports what would be deleted without deleting anything.
  dryRun: env.ESCOWEAR_ACCOUNT_CLEANUP_DRY_RUN === "true",
});

module.exports = { DAY_MS, GUEST_EMAIL_CODE, HOUR_MS, VERIFICATION, getLifecycleConfig };
