const { Router } = require("express");
const router = Router();
const { createUser, loginUser } = require("../controllers/usersController");
const { createRateLimiter } = require("../middlewares/rateLimit");

const fifteenMinutes = 15 * 60 * 1000;
// Brute-force protection for sign-in (most important for the admin account).
const loginPerIp = createRateLimiter({ windowMs: fifteenMinutes, max: 20, message: "Too many sign-in attempts. Please wait and try again." });
const loginPerEmail = createRateLimiter({
  windowMs: fifteenMinutes,
  max: 8,
  keyFn: (req) => (typeof req.body?.email === "string" ? `login:${req.body.email.trim().toLowerCase().slice(0, 254)}` : null),
  message: "Too many sign-in attempts for this account. Please wait and try again.",
});
const registerPerIp = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many sign-ups from this connection. Please try again later." });

router.post("/register", registerPerIp, createUser);
router.post("/login", loginPerIp, loginPerEmail, loginUser);
module.exports = router;
// Tests reuse one process; this clears the in-memory counters between cases.
module.exports.resetRateLimits = () => [loginPerIp, loginPerEmail, registerPerIp].forEach((limiter) => limiter.reset());
