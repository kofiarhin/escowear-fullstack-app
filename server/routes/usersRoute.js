const { Router } = require("express");
const User = require("../Models/User.model");
const RateLimit = require("../Models/RateLimit.model");
const EmailOutbox = require("../Models/EmailOutbox.model");
const { createUsersController } = require("../controllers/usersController");
const { createPersistentRateLimiter } = require("../middlewares/persistentRateLimit");
const { createPasswordResetService } = require("../services/passwordResetService");
const { createEmailVerificationService } = require("../services/emailVerificationService");

const emailKey = (prefix) => (req) => (typeof req.body?.email === "string" ? `${prefix}:${req.body.email.trim().toLowerCase().slice(0, 254)}` : null);

const createUsersRouter = (deps = {}) => {
  const UserModel = deps.User || User;
  const RateLimitModel = deps.RateLimit || RateLimit;
  const passwordResetService =
    deps.passwordResetService ||
    createPasswordResetService({
      User: UserModel,
      publicBaseUrl: deps.publicBaseUrl,
      transportFactory: deps.transportFactory,
      randomBytes: deps.randomBytes,
      now: deps.now,
      logger: deps.logger,
    });
  const verificationService =
    deps.verificationService ||
    createEmailVerificationService({
      User: UserModel,
      EmailOutbox: deps.EmailOutbox || EmailOutbox,
      publicBaseUrl: deps.publicBaseUrl,
      randomBytes: deps.randomBytes,
      now: deps.now,
      logger: deps.logger,
    });
  const controller = createUsersController({ UserModel, passwordResetService, verificationService, logger: deps.logger });
  const { createUser, forgotPassword, loginUser, resetPassword } = controller;
  const fifteenMinutes = 15 * 60 * 1000;
  const persistentLimiter = (options) =>
    createPersistentRateLimiter({ RateLimit: RateLimitModel, now: deps.now, ...options });
  // Brute-force protection for sign-in (most important for the admin account).
  // req.ip is derived by Express using server.js's restricted trust-proxy
  // setting; this never parses an arbitrary X-Forwarded-For header itself.
  const loginPerIp = persistentLimiter({ windowMs: fifteenMinutes, max: 20, keyFn: (req) => `login:ip:${req.ip}`, message: "Too many sign-in attempts. Please wait and try again." });
  const loginPerEmail = persistentLimiter({
    windowMs: fifteenMinutes,
    max: 8,
    keyFn: emailKey("login"),
    message: "Too many sign-in attempts for this account. Please wait and try again.",
  });
  const registerPerIp = persistentLimiter({ windowMs: 60 * 60 * 1000, max: 10, keyFn: (req) => `register:ip:${req.ip}`, message: "Too many sign-ups from this connection. Please try again later." });
  const forgotPerIp = persistentLimiter({ windowMs: fifteenMinutes, max: 10, keyFn: (req) => `forgot-password:ip:${req.ip}`, message: "Too many password reset requests. Please wait and try again." });
  const forgotPerEmail = persistentLimiter({
    windowMs: 30 * 60 * 1000,
    max: 3,
    keyFn: emailKey("password-reset"),
    message: "Too many password reset requests for this account. Please wait and try again.",
  });
  // Resend/correction limits per account (3 per 24h, 60s cooldown) are enforced
  // by the verification service; these only stop request floods.
  const verificationPerIp = persistentLimiter({ windowMs: fifteenMinutes, max: 30, keyFn: (req) => `email-verification:ip:${req.ip}`, message: "Too many requests. Please wait and try again." });
  const verifyLinkPerIp = persistentLimiter({ windowMs: fifteenMinutes, max: 20, keyFn: (req) => `verify-email:ip:${req.ip}`, message: "Too many verification attempts. Please wait and try again." });
  const resetPerIp = persistentLimiter({ windowMs: fifteenMinutes, max: 20, keyFn: (req) => `reset-password:ip:${req.ip}`, message: "Too many password reset attempts. Please wait and try again." });

  const router = Router();
  router.post("/register", registerPerIp, createUser);
  router.post("/login", loginPerIp, loginPerEmail, loginUser);
  router.post("/forgot-password", forgotPerIp, forgotPerEmail, forgotPassword);
  router.post("/reset-password", resetPerIp, resetPassword);
  router.post("/verify-email", verifyLinkPerIp, controller.verifyEmail);
  router.get("/verification", verificationPerIp, controller.verificationStatus);
  router.post("/verification/resend", verificationPerIp, controller.resendVerification);
  router.patch("/verification/email", verificationPerIp, controller.changeVerificationEmail);
  // Compatibility for existing real-DB tests. Production never calls this;
  // counters naturally expire through the TTL index.
  router.resetRateLimits = () => {
    const cleared = typeof RateLimitModel.deleteMany === "function" ? RateLimitModel.deleteMany({}) : null;
    if (cleared?.catch) cleared.catch(() => undefined);
    return cleared;
  };
  return router;
};

const router = createUsersRouter();
module.exports = router;
module.exports.createUsersRouter = createUsersRouter;
