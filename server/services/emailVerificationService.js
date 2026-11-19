const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Types } = require("mongoose");
const { enqueueEmail, isDuplicateKey } = require("./emailOutbox");
const { PASSWORD_MAX, PASSWORD_MIN, resetBaseUrlFor, sha256 } = require("./passwordResetService");
const { VERIFICATION } = require("../config/verification");

// Registration, email verification, resend and email correction for accounts
// created after IDE-152. Existing accounts (no verificationRequired) are never
// touched by anything in this file.

class VerificationError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const PENDING_AUDIENCE = "email-verification";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN = /^[a-f0-9]{64}$/i;
const NAME_MAX = 100;
const VERIFICATION_KINDS = ["account_verification", "account_final_warning"];
const INVALID_LINK_MESSAGE = "This verification link is invalid or has expired. Sign in to request a new one.";
const EXPIRED_MESSAGE = "This account was not verified in time and has expired. Please register again.";

const normalizeEmail = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const emailError = (email) => (!email || email.length > 254 || !EMAIL.test(email) ? "Enter a valid email address" : null);

// "not_required" = existing account; "expired" applies even before cleanup runs.
const verificationState = (user, now = new Date()) => {
  if (!user?.verificationRequired) return "not_required";
  if (user.emailVerifiedAt) return "verified";
  if (user.verificationExpiredAt || (user.verificationDeadline && new Date(user.verificationDeadline) <= now)) return "expired";
  return "pending";
};

// Every query that may act on an unverified account repeats these conditions,
// so a verified, existing or admin account can never match.
const unverifiedNewCustomer = () => ({
  verificationRequired: true,
  emailVerifiedAt: { $exists: false },
  role: "customer",
});

const validateRegistration = (body = {}) => {
  const { name, email, password, passwordConfirmation } = body;
  const fields = {};
  const cleanName = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!cleanName) fields.name = "Enter your name";
  else if (cleanName.length > NAME_MAX) fields.name = `Name must be at most ${NAME_MAX} characters`;
  const normalizedEmail = normalizeEmail(email);
  const invalidEmail = emailError(normalizedEmail);
  if (invalidEmail) fields.email = invalidEmail;
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    fields.password = `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`;
  } else if (passwordConfirmation !== password) {
    fields.passwordConfirmation = "Passwords do not match";
  }
  if (Object.keys(fields).length) throw new VerificationError(400, "VALIDATION_FAILED", Object.values(fields)[0], { fields });
  return { name: cleanName, email: normalizedEmail, password };
};

const createEmailVerificationService = ({
  User,
  EmailOutbox,
  publicBaseUrl,
  env = process.env,
  secret,
  randomBytes = crypto.randomBytes,
  now = () => new Date(),
  logger = console,
}) => {
  const jwtSecret = () => secret || process.env.JWT_SECRET;

  const linkFor = (token) => {
    const base = String(publicBaseUrl === undefined ? resetBaseUrlFor(env) : publicBaseUrl).replace(/\/+$/, "");
    const parsed = new URL(base);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Invalid public application URL");
    return `${base}/verify-email?token=${encodeURIComponent(token)}`;
  };

  // A link never outlives the account deadline.
  const newLinkToken = (user, time) => {
    const token = randomBytes(32).toString("hex");
    const deadline = new Date(user.verificationDeadline).getTime();
    return { token, hash: sha256(token), expires: new Date(Math.min(time.getTime() + VERIFICATION.linkTtlMs, deadline)) };
  };

  const issuePendingToken = (user) =>
    jwt.sign({ id: String(user._id), sv: user.sessionVersion || 0 }, jwtSecret(), {
      audience: PENDING_AUDIENCE,
      expiresIn: VERIFICATION.pendingTokenTtlSeconds,
    });

  const pendingResponse = (user) => ({
    pendingToken: issuePendingToken(user),
    email: user.email,
    deadline: user.verificationDeadline,
  });

  // Older queued links are withdrawn so only the newest link can be delivered.
  const withdrawQueuedLinks = (userId, reason) =>
    EmailOutbox.updateMany(
      { userId, kind: { $in: VERIFICATION_KINDS }, state: "queued" },
      { $set: { state: "failed", lastError: reason, "payload.text": "[removed: superseded]" } }
    );

  const queueLink = async (user, kind, token) => {
    const { message } = await enqueueEmail(EmailOutbox, {
      dedupeKey: `${kind}:${user._id}:${randomBytes(8).toString("hex")}`,
      userId: user._id,
      kind,
      to: user.email,
      context: { name: user.name, link: linkFor(token), deadline: user.verificationDeadline },
    });
    return message;
  };

  // The delivery check moves to the new message unless an earlier email to
  // this address was already accepted by the mail server.
  const recordQueued = async (user, message, { addressChanged = false } = {}) => {
    const set = { verificationLatestEmailId: message._id };
    let deliveryAccepted = false;
    if (!addressChanged && user.verificationDeliveryEmailId) {
      const current = await EmailOutbox.findOne({ _id: user.verificationDeliveryEmailId }).lean();
      deliveryAccepted = current?.state === "sent";
    }
    if (!deliveryAccepted) set.verificationDeliveryEmailId = message._id;
    await User.updateOne({ _id: user._id, email: user.email }, { $set: set });
  };

  const register = async (body) => {
    const input = validateRegistration(body);
    const time = now();
    const deadline = new Date(time.getTime() + VERIFICATION.accountDeadlineMs);
    const link = newLinkToken({ verificationDeadline: deadline }, time);
    const data = {
      ...input,
      role: "customer",
      verificationRequired: true,
      verificationDeadline: deadline,
      emailVerificationTokenHash: link.hash,
      emailVerificationExpires: link.expires,
      // Starts the resend cooldown; the registration email is not a resend.
      lastVerificationEmailAt: time,
    };

    const emailInUse = () => new VerificationError(400, "EMAIL_IN_USE", "Email already in use", { fields: { email: "Email already in use" } });
    let user;
    try {
      user = await createUser(data);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      if (!(await removeExpiredHolder(input.email, time))) throw emailInUse();
      try {
        user = await createUser(data);
      } catch (retryError) {
        if (isDuplicateKey(retryError)) throw emailInUse();
        throw retryError;
      }
    }

    try {
      const message = await queueLink(user, "account_verification", link.token);
      await recordQueued(user, message);
    } catch (error) {
      // The account still exists; the customer can resend. Deletion stays
      // paused because no verification email was accepted for this address.
      logger.error(`Verification email for new account ${user._id} not queued: ${error.message}`);
    }
    return { user, verification: pendingResponse(user) };
  };

  const createUser = async (data) => {
    // Production uses the Mongoose constructor so the password hook runs; the
    // in-memory test model exposes the equivalent create API.
    const created = typeof User === "function" ? new User(data) : await User.create(data);
    if (typeof created.save === "function") await created.save();
    return created.toObject ? created.toObject() : created;
  };

  // An address held by an expired, never-verified account can be registered
  // again; the stale account is removed atomically first.
  const removeExpiredHolder = async (email, time) => {
    // Accounts an admin blocked are kept for the admin to resolve.
    const stale = { email, ...unverifiedNewCustomer(), blocked: { $ne: true }, verificationDeadline: { $lte: time } };
    const holder = await User.findOne(stale).lean();
    if (!holder) return false;
    const result = await User.deleteOne({ ...stale, _id: holder._id });
    if (!result.deletedCount) return false;
    await withdrawQueuedLinks(holder._id, "Account expired");
    logger.log(`Expired unverified account ${holder._id} replaced by a new registration`);
    return true;
  };

  const userFromPendingToken = async (token) => {
    let payload;
    try {
      payload = jwt.verify(String(token || ""), jwtSecret(), { algorithms: ["HS256"], audience: PENDING_AUDIENCE });
    } catch {
      throw new VerificationError(401, "VERIFICATION_SESSION_EXPIRED", "Your verification session has expired. Please sign in again.");
    }
    if (typeof payload.id !== "string" || !Types.ObjectId.isValid(payload.id)) {
      throw new VerificationError(401, "VERIFICATION_SESSION_EXPIRED", "Your verification session has expired. Please sign in again.");
    }
    const user = await User.findOne({ _id: payload.id }).lean();
    if (!user || (user.sessionVersion || 0) !== payload.sv) {
      throw new VerificationError(401, "VERIFICATION_SESSION_EXPIRED", "Your verification session has expired. Please sign in again.");
    }
    if (user.blocked) throw new VerificationError(403, "ACCOUNT_BLOCKED", "This account has been blocked");
    return user;
  };

  const assertPending = (user, time) => {
    const state = verificationState(user, time);
    if (state === "verified" || state === "not_required") {
      throw new VerificationError(409, "ALREADY_VERIFIED", "Your email is already verified. You can sign in now.");
    }
    if (state === "expired") throw new VerificationError(410, "ACCOUNT_EXPIRED", EXPIRED_MESSAGE);
  };

  const recentSends = (user, time) =>
    (user.verificationEmailSends || []).map((value) => new Date(value)).filter((sent) => sent.getTime() > time.getTime() - VERIFICATION.resendWindowMs);

  const budget = (user, time) => {
    const recent = recentSends(user, time);
    const last = user.lastVerificationEmailAt ? new Date(user.lastVerificationEmailAt).getTime() : 0;
    const cooldownEndsAt = last + VERIFICATION.resendCooldownMs;
    const limitEndsAt = recent.length >= VERIFICATION.resendMax ? Math.min(...recent.map((sent) => sent.getTime())) + VERIFICATION.resendWindowMs : 0;
    const nextAt = Math.max(cooldownEndsAt, limitEndsAt);
    return { recent, remaining: Math.max(0, VERIFICATION.resendMax - recent.length), nextResendAt: nextAt > time.getTime() ? new Date(nextAt) : null, limited: Boolean(limitEndsAt) };
  };

  const assertBudget = (user, time, { enforceLimit }) => {
    const state = budget(user, time);
    const last = user.lastVerificationEmailAt ? new Date(user.lastVerificationEmailAt).getTime() : 0;
    const cooling = last + VERIFICATION.resendCooldownMs > time.getTime();
    if (cooling || (enforceLimit && state.limited)) {
      const until = enforceLimit ? state.nextResendAt : new Date(last + VERIFICATION.resendCooldownMs);
      const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - time.getTime()) / 1000));
      const limitHit = enforceLimit && state.limited;
      throw new VerificationError(
        429,
        limitHit ? "RESEND_LIMIT" : "RESEND_COOLDOWN",
        limitHit ? "You have reached the limit of 3 verification emails in 24 hours. Please try again later." : "Please wait a moment before requesting another email.",
        { retryAfterSeconds }
      );
    }
    return state;
  };

  // Issues a new link (and optionally a new address) under an optimistic lock
  // on the last-send time, so concurrent requests cannot exceed the limits.
  const sendNewLink = async (user, { newEmail, countTowardLimit = true }) => {
    const time = now();
    assertPending(user, time);
    const { recent } = assertBudget(user, time, { enforceLimit: countTowardLimit });
    const link = newLinkToken(user, time);
    const set = {
      emailVerificationTokenHash: link.hash,
      emailVerificationExpires: link.expires,
      lastVerificationEmailAt: time,
      ...(countTowardLimit ? { verificationEmailSends: [...recent, time] } : {}),
      ...(newEmail ? { email: newEmail } : {}),
    };
    const lock = user.lastVerificationEmailAt ? new Date(user.lastVerificationEmailAt) : { $exists: false };
    let updated;
    try {
      updated = await User.findOneAndUpdate(
        { _id: user._id, email: user.email, lastVerificationEmailAt: lock, ...unverifiedNewCustomer(), verificationDeadline: { $gt: time } },
        { $set: set, ...(newEmail ? { $unset: { verificationEmailAcceptedAt: 1 } } : {}) },
        { new: true }
      ).lean();
    } catch (error) {
      if (isDuplicateKey(error)) throw new VerificationError(409, "EMAIL_IN_USE", "Email already in use", { fields: { email: "Email already in use" } });
      throw error;
    }
    if (!updated) throw new VerificationError(429, "RESEND_COOLDOWN", "Please wait a moment before requesting another email.", { retryAfterSeconds: 1 });

    await withdrawQueuedLinks(user._id, "Superseded by a newer verification email");
    const message = await queueLink(updated, "account_verification", link.token);
    await recordQueued(updated, message, { addressChanged: Boolean(newEmail) });
    return status(await User.findOne({ _id: user._id }).lean(), time);
  };

  const status = (user, time = now()) => {
    const state = verificationState(user, time);
    const { remaining, nextResendAt } = budget(user, time);
    return { email: user.email, state, deadline: user.verificationDeadline || null, resendsRemaining: remaining, nextResendAt };
  };

  const getStatus = async (pendingToken) => status(await userFromPendingToken(pendingToken));

  const resend = async (pendingToken) => {
    const user = await userFromPendingToken(pendingToken);
    return { message: `We have sent a new verification link to ${user.email}.`, ...(await sendNewLink(user, {})) };
  };

  const changeEmail = async (pendingToken, body = {}) => {
    const user = await userFromPendingToken(pendingToken);
    const email = normalizeEmail(body.email);
    const invalid = emailError(email);
    if (invalid) throw new VerificationError(400, "VALIDATION_FAILED", invalid, { fields: { email: invalid } });
    if (email === user.email) {
      throw new VerificationError(400, "VALIDATION_FAILED", "That is already the email on this account", { fields: { email: "That is already the email on this account" } });
    }
    const result = await sendNewLink(user, { newEmail: email });
    return { message: `We have sent a verification link to ${email}. Links sent to your previous address no longer work.`, ...result };
  };

  const verifyEmail = async (body = {}) => {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!TOKEN.test(token)) throw new VerificationError(400, "INVALID_LINK", INVALID_LINK_MESSAGE);
    const time = now();
    const user = await User.findOneAndUpdate(
      {
        emailVerificationTokenHash: sha256(token),
        emailVerificationExpires: { $gt: time },
        verificationDeadline: { $gt: time },
        verificationRequired: true,
        emailVerifiedAt: { $exists: false },
      },
      { $set: { emailVerifiedAt: time }, $unset: { emailVerificationTokenHash: 1, emailVerificationExpires: 1 } },
      { new: true }
    ).lean();
    if (!user) throw new VerificationError(400, "INVALID_LINK", INVALID_LINK_MESSAGE);
    await withdrawQueuedLinks(user._id, "Email already verified");
    return { message: "Your email is verified. You can now sign in." };
  };

  // Admin resend: same cooldown, but not counted against the customer's limit.
  const adminResend = async (userId) => {
    const user = await User.findOne({ _id: userId }).lean();
    if (!user) throw new VerificationError(404, "NOT_FOUND", "User not found");
    return sendNewLink(user, { countTowardLimit: false });
  };

  // Day-6 reminder: a fresh link that is not counted against the customer's
  // resend limit. The link is built before anything changes, and the claim
  // takes the same optimistic lock as a resend, so the two cannot interleave
  // and leave the reminder with a dead link. If queuing fails, the claim is
  // undone so the next run tries again.
  const queueFinalWarning = async (user, time) => {
    const link = newLinkToken(user, time);
    const url = linkFor(link.token);
    const lock = user.lastVerificationEmailAt ? new Date(user.lastVerificationEmailAt) : { $exists: false };
    const claimed = await User.findOneAndUpdate(
      { _id: user._id, email: user.email, lastVerificationEmailAt: lock, ...unverifiedNewCustomer(), finalWarningQueuedAt: { $exists: false }, verificationDeadline: { $gt: time } },
      { $set: { finalWarningQueuedAt: time, lastVerificationEmailAt: time, emailVerificationTokenHash: link.hash, emailVerificationExpires: link.expires } },
      { new: true }
    ).lean();
    if (!claimed) return false;
    try {
      await withdrawQueuedLinks(user._id, "Superseded by the final reminder");
      const { message } = await enqueueEmail(EmailOutbox, {
        dedupeKey: `account_final_warning:${user._id}:${time.getTime()}`,
        userId: user._id,
        kind: "account_final_warning",
        to: claimed.email,
        context: { name: claimed.name, link: url, deadline: claimed.verificationDeadline },
      });
      await User.updateOne({ _id: user._id }, { $set: { verificationLatestEmailId: message._id } });
    } catch (error) {
      await User.updateOne({ _id: user._id, finalWarningQueuedAt: time }, { $unset: { finalWarningQueuedAt: 1 } });
      throw error;
    }
    return true;
  };

  return {
    stateOf: (user) => verificationState(user, now()),
    adminResend,
    changeEmail,
    getStatus,
    pendingResponse,
    queueFinalWarning,
    register,
    resend,
    verifyEmail,
    withdrawQueuedLinks,
  };
};

module.exports = {
  EXPIRED_MESSAGE,
  PENDING_AUDIENCE,
  VerificationError,
  createEmailVerificationService,
  unverifiedNewCustomer,
  verificationState,
};
