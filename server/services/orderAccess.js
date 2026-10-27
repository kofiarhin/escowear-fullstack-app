const jwt = require("jsonwebtoken");

// Read-only, single-order access tokens for guests. They are signed with a key
// derived from JWT_SECRET but distinct from it, and carry an audience, so they
// can never be accepted as customer login tokens (or vice versa).
const AUDIENCE = "escowear:order-read";

// Separate write capability: lets whoever proved ownership of one order (by
// placing it, or with an emailed tracking code) upload payment proof for that
// order only. Different key, audience and scope, so a read token can never be
// used to upload and this token can never be used to read.
const PROOF_AUDIENCE = "escowear:payment-proof";
const PROOF_SCOPE = "order:payment-proof:create";

const signingKey = (secret = process.env.JWT_SECRET, purpose = "order-access") => {
  if (!secret) throw new Error("JWT_SECRET is required for order access tokens");
  return `${secret}:${purpose}:v1`;
};

const issueOrderAccessToken = (orderId, ttlMinutes, { secret, via = "checkout" } = {}) =>
  jwt.sign({ scope: "order:read", via }, signingKey(secret), {
    audience: AUDIENCE,
    subject: String(orderId),
    expiresIn: `${ttlMinutes}m`,
  });

// Returns the order id the token grants access to, or null.
const verifyOrderAccessToken = (token, { secret } = {}) => {
  if (typeof token !== "string" || !token || token.length > 2048) return null;
  try {
    const payload = jwt.verify(token, signingKey(secret), { audience: AUDIENCE, algorithms: ["HS256"] });
    return payload.scope === "order:read" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
};

const issuePaymentProofToken = (orderId, ttlMinutes, { secret, via = "checkout" } = {}) =>
  jwt.sign({ scope: PROOF_SCOPE, via }, signingKey(secret, "payment-proof"), {
    audience: PROOF_AUDIENCE,
    subject: String(orderId),
    expiresIn: `${ttlMinutes}m`,
  });

// Returns the order id the proof capability is bound to, or null.
const verifyPaymentProofToken = (token, { secret } = {}) => {
  if (typeof token !== "string" || !token || token.length > 2048) return null;
  try {
    const payload = jwt.verify(token, signingKey(secret, "payment-proof"), { audience: PROOF_AUDIENCE, algorithms: ["HS256"] });
    return payload.scope === PROOF_SCOPE && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
};

module.exports = {
  AUDIENCE,
  PROOF_AUDIENCE,
  PROOF_SCOPE,
  issueOrderAccessToken,
  issuePaymentProofToken,
  verifyOrderAccessToken,
  verifyPaymentProofToken,
};
