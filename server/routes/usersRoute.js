const { Router } = require("express");
const User = require("../Models/User.model");
const { createUsersController } = require("../controllers/usersController");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { createPasswordResetService } = require("../services/passwordResetService");

const emailKey = (prefix) => (req) => (typeof req.body?.email === "string" ? `${prefix}:${req.body.email.trim().toLowerCase().slice(0, 254)}` : null);

const createUsersRouter = (deps = {}) => {
  const UserModel = deps.User || User;
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
  const { createUser, forgotPassword, loginUser, resetPassword } = createUsersController({ UserModel, passwordResetService });
  const fifteenMinutes = 15 * 60 * 1000;
  // Brute-force protection for sign-in (most important for the admin account).
  const loginPerIp = createRateLimiter({ windowMs: fifteenMinutes, max: 20, message: "Too many sign-in attempts. Please wait and try again." });
  const loginPerEmail = createRateLimiter({
    windowMs: fifteenMinutes,
    max: 8,
    keyFn: emailKey("login"),
    message: "Too many sign-in attempts for this account. Please wait and try again.",
  });
  const registerPerIp = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many sign-ups from this connection. Please try again later." });
  const forgotPerIp = createRateLimiter({ windowMs: fifteenMinutes, max: 10, message: "Too many password reset requests. Please wait and try again." });
  const forgotPerEmail = createRateLimiter({
    windowMs: 30 * 60 * 1000,
    max: 3,
    keyFn: emailKey("password-reset"),
    message: "Too many password reset requests for this account. Please wait and try again.",
  });
  const resetPerIp = createRateLimiter({ windowMs: fifteenMinutes, max: 20, message: "Too many password reset attempts. Please wait and try again." });

  const router = Router();
  router.post("/register", registerPerIp, createUser);
  router.post("/login", loginPerIp, loginPerEmail, loginUser);
  router.post("/forgot-password", forgotPerIp, forgotPerEmail, forgotPassword);
  router.post("/reset-password", resetPerIp, resetPassword);
  // Tests reuse one process; this clears the in-memory counters between cases.
  router.resetRateLimits = () => [loginPerIp, loginPerEmail, registerPerIp, forgotPerIp, forgotPerEmail, resetPerIp].forEach((limiter) => limiter.reset());
  return router;
};

const router = createUsersRouter();
module.exports = router;
module.exports.createUsersRouter = createUsersRouter;
