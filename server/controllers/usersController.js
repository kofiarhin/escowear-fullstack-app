const User = require("../Models/User.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ADMIN_SESSION_SECONDS } = require("../middlewares/auth.middleware");
const EmailOutbox = require("../Models/EmailOutbox.model");
const { createPasswordResetService } = require("../services/passwordResetService");
const { EXPIRED_MESSAGE, VerificationError, createEmailVerificationService } = require("../services/emailVerificationService");

// Admins get short sessions; customers keep the existing 30-day sign-in.
const createToken = (id, role, sessionVersion = 0) =>
  jwt.sign({ id, sv: sessionVersion }, process.env.JWT_SECRET, { expiresIn: role === "admin" ? ADMIN_SESSION_SECONDS : "30d" });

const createUsersController = ({
  UserModel = User,
  passwordResetService = createPasswordResetService({ User: UserModel }),
  verificationService = createEmailVerificationService({ User: UserModel, EmailOutbox }),
  logger = console,
} = {}) => {
  const sendVerificationError = (res, error, fallback) => {
    if (error instanceof VerificationError) {
      const { fields, retryAfterSeconds } = error.extra;
      if (retryAfterSeconds) res.set("Retry-After", String(retryAfterSeconds));
      return res.status(error.status).json({ error: error.message, code: error.code, ...(fields ? { fields } : {}), ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
    }
    logger.error(`Account verification request failed: ${error.message}`);
    return res.status(500).json({ error: fallback, code: "SERVER_ERROR" });
  };

  const pendingToken = (req) => {
    const header = req.headers.authorization;
    const [scheme, token] = typeof header === "string" ? header.split(" ") : [];
    return scheme === "Bearer" ? token : "";
  };

  const verificationHandler = (fallback, run) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      return res.status(200).json(await run(req));
    } catch (error) {
      return sendVerificationError(res, error, fallback);
    }
  };

  const verifyEmail = verificationHandler("Your email could not be verified. Please try again.", (req) => verificationService.verifyEmail(req.body || {}));
  const verificationStatus = verificationHandler("Verification status could not be loaded.", (req) => verificationService.getStatus(pendingToken(req)));
  const resendVerification = verificationHandler("We could not send a new link. Please try again.", (req) => verificationService.resend(pendingToken(req)));
  const changeVerificationEmail = verificationHandler("We could not update your email. Please try again.", (req) =>
    verificationService.changeEmail(pendingToken(req), req.body || {})
  );


// @desc create users
// @router /api/users/register
// @access public
// New accounts start unverified: no session is issued, only a restricted
// credential for the verification page (resend, email correction, status).
const createUser = async (req, res) => {
  try {
    const { user, verification } = await verificationService.register(req.body || {});
    res.set("Cache-Control", "no-store");
    return res.status(201).json({
      message: `We have sent a verification link to ${user.email}. Verify your email to sign in.`,
      user: { id: String(user._id), name: user.name, email: user.email },
      verification,
    });
  } catch (error) {
    return sendVerificationError(res, error, "There was a problem registering user");
  }
};

// login user
// @router /api/users/login
// @access public
const loginUser = async (req, res) => {
  const { email, password } = req.body || {};

  // Strings only: an object such as {"$gt": ""} must never reach the query.
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "email and password is required" });
  }

  try {
    const user = await UserModel.findOne({ email: email.trim().toLowerCase() });

    // One message for unknown email and wrong password, so the login form
    // cannot be used to discover which accounts (including admins) exist.
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    } else {
      const auth = await bcrypt.compare(password, user.password);

      if (auth) {
        // Only revealed after a correct password, so it cannot be used to probe
        // which emails are registered.
        if (user.blocked) return res.status(403).json({ error: "This account has been blocked", code: "ACCOUNT_BLOCKED" });
        // New accounts sign in only after verifying their email. Existing
        // accounts have no verification requirement and are unaffected.
        const state = verificationService.stateOf(user);
        if (state === "pending") {
          res.set("Cache-Control", "no-store");
          return res.status(403).json({
            error: "Please verify your email address before signing in.",
            code: "EMAIL_NOT_VERIFIED",
            verification: verificationService.pendingResponse(user),
          });
        }
        if (state === "expired") return res.status(403).json({ error: EXPIRED_MESSAGE, code: "ACCOUNT_EXPIRED" });
        const { _id, email, name } = user;
        // `role` only drives what the UI shows; every admin API re-checks it server-side.
        return res
          .status(200)
          .json({ id: _id, email, name, role: user.role || "customer", token: createToken(_id, user.role, user.sessionVersion || 0) });
      } else {
        return res.status(400).json({ error: "Invalid email or password" });
      }
    }
  } catch (error) {
    return res.status(400).json({ error: "Invalid email or password" });
  }
  };

  // Always return the same accepted response for registered and unregistered
  // addresses, so this endpoint cannot reveal who has an account.
  const forgotPassword = async (req, res) => {
    try {
      const result = await passwordResetService.requestReset(req.body || {});
      return res.status(202).json(result);
    } catch {
      return res.status(202).json({ message: "If an account matches that email address, we have sent password reset instructions." });
    }
  };

  const resetPassword = async (req, res) => {
    try {
      const result = await passwordResetService.resetPassword(req.body || {});
      if (result.error) return res.status(400).json(result);
      return res.status(200).json(result);
    } catch {
      return res.status(400).json({ error: "This password reset link is invalid or has expired." });
    }
  };

  return { changeVerificationEmail, createUser, forgotPassword, loginUser, resendVerification, resetPassword, verificationStatus, verifyEmail };
};

const defaultController = createUsersController();

module.exports = {
  ...defaultController,
  createUsersController,
};
