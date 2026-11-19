const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Types } = require("mongoose");
const { enqueueEmail } = require("./emailOutbox");
const { OrderError } = require("./orderService");
const { isValidIdempotencyKey, normalizeEmail } = require("../validators/orderValidator");
const { GUEST_EMAIL_CODE } = require("../config/verification");

// Guest checkout email proof (IDE-152). A 6-digit code is emailed to the
// checkout address and bound to that address plus the checkout attempt's
// Idempotency-Key. Verifying it returns a short-lived proof that order
// creation checks server-side, so the step cannot be skipped via the API.

const PROOF_AUDIENCE = "checkout-email";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE = /^\d{6}$/;
const INVALID_CODE = () => new OrderError(400, "INVALID_CODE", "That code is not valid or has expired. Request a new code.");
const PROOF_REQUIRED_MESSAGE = "Confirm your email with the 6-digit code we send you before placing your order.";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const intentHashFor = (idempotencyKey) => sha256(`checkout-intent:${idempotencyKey}`);

const parse = (body = {}) => {
  const email = normalizeEmail(body.email);
  const fields = {};
  if (!email || email.length > 254 || !EMAIL.test(email)) fields.email = "Enter a valid email address";
  if (!isValidIdempotencyKey(body.checkoutIntent)) fields.checkoutIntent = "Checkout session is invalid. Refresh the page and try again.";
  if (Object.keys(fields).length) throw new OrderError(422, "VALIDATION_FAILED", Object.values(fields)[0], fields);
  return { email, intentHash: intentHashFor(body.checkoutIntent) };
};

const createCheckoutEmailService = ({ CheckoutEmailChallenge, EmailOutbox, secret, now = () => new Date(), randomInt = crypto.randomInt, logger = console }) => {
  const jwtSecret = () => secret || process.env.JWT_SECRET;
  const hashCode = (challengeId, code) =>
    crypto.createHmac("sha256", `${jwtSecret()}:checkout-email-code:v1`).update(`${challengeId}:${code}`).digest("hex");

  const requestCode = async (body) => {
    const { email, intentHash } = parse(body);
    const time = now();
    // A new code replaces any earlier unused one for this checkout.
    await CheckoutEmailChallenge.updateMany(
      { emailNormalized: email, intentHash, consumedAt: { $exists: false } },
      { $set: { consumedAt: time, consumedReason: "superseded" } }
    );
    const _id = new Types.ObjectId();
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    await CheckoutEmailChallenge.create({
      _id,
      emailNormalized: email,
      intentHash,
      codeHash: hashCode(_id, code),
      expiresAt: new Date(time.getTime() + GUEST_EMAIL_CODE.ttlMs),
      attempts: 0,
    });
    try {
      await enqueueEmail(EmailOutbox, {
        dedupeKey: `checkout_email_code:${_id}`,
        kind: "checkout_email_code",
        to: email,
        context: { code, ttlMinutes: GUEST_EMAIL_CODE.ttlMs / 60000 },
      });
    } catch (error) {
      logger.error(`Checkout email code ${_id} not queued: ${error.message}`);
      throw new OrderError(503, "CODE_NOT_SENT", "We could not send a code right now. Please try again in a moment.");
    }
    return { message: `We have emailed a 6-digit code to ${email}.`, expiresInMinutes: GUEST_EMAIL_CODE.ttlMs / 60000 };
  };

  const verifyCode = async (body = {}) => {
    const { email, intentHash } = parse(body);
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    if (!CODE.test(code)) throw new OrderError(422, "VALIDATION_FAILED", "Enter the 6-digit code", { code: "Enter the 6-digit code from your email" });

    const time = now();
    const [latest] = await CheckoutEmailChallenge.find({ emailNormalized: email, intentHash, consumedAt: { $exists: false }, expiresAt: { $gt: time } })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();
    if (!latest) throw INVALID_CODE();

    // Counted before comparing, atomically, so parallel guesses cannot exceed the limit.
    const attempt = await CheckoutEmailChallenge.findOneAndUpdate(
      { _id: latest._id, consumedAt: { $exists: false }, attempts: { $lt: GUEST_EMAIL_CODE.maxAttempts } },
      { $inc: { attempts: 1 } },
      { new: true }
    ).lean();
    if (!attempt) throw INVALID_CODE();

    const expected = Buffer.from(attempt.codeHash, "hex");
    const actual = Buffer.from(hashCode(attempt._id, code), "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      if (attempt.attempts >= GUEST_EMAIL_CODE.maxAttempts) {
        await CheckoutEmailChallenge.updateOne(
          { _id: attempt._id, consumedAt: { $exists: false } },
          { $set: { consumedAt: time, consumedReason: "too_many_attempts" } }
        );
      }
      throw INVALID_CODE();
    }

    const consumed = await CheckoutEmailChallenge.findOneAndUpdate(
      { _id: attempt._id, consumedAt: { $exists: false } },
      { $set: { consumedAt: time, consumedReason: "verified" } },
      { new: true }
    ).lean();
    if (!consumed) throw INVALID_CODE();

    const proof = jwt.sign({ em: sha256(email), ih: intentHash }, jwtSecret(), { audience: PROOF_AUDIENCE, expiresIn: GUEST_EMAIL_CODE.proofTtlSeconds });
    return { proof, expiresInMinutes: GUEST_EMAIL_CODE.proofTtlSeconds / 60 };
  };

  // Order creation: the proof must match the order's email and this exact
  // checkout attempt. Changing either needs a new code.
  const assertProof = (proof, { email, idempotencyKey }) => {
    let payload;
    try {
      payload = jwt.verify(String(proof || ""), jwtSecret(), { algorithms: ["HS256"], audience: PROOF_AUDIENCE });
    } catch {
      throw new OrderError(403, "EMAIL_VERIFICATION_REQUIRED", PROOF_REQUIRED_MESSAGE);
    }
    if (payload.em !== sha256(normalizeEmail(email)) || payload.ih !== intentHashFor(idempotencyKey)) {
      throw new OrderError(403, "EMAIL_VERIFICATION_REQUIRED", PROOF_REQUIRED_MESSAGE);
    }
  };

  return { assertProof, requestCode, verifyCode };
};

module.exports = { PROOF_AUDIENCE, createCheckoutEmailService };
