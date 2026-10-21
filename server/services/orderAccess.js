const jwt = require("jsonwebtoken");

// Read-only, single-order access tokens for guests. They are signed with a key
// derived from JWT_SECRET but distinct from it, and carry an audience, so they
// can never be accepted as customer login tokens (or vice versa).
const AUDIENCE = "escowear:order-read";

const signingKey = (secret = process.env.JWT_SECRET) => {
  if (!secret) throw new Error("JWT_SECRET is required for order access tokens");
  return `${secret}:order-access:v1`;
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

module.exports = { AUDIENCE, issueOrderAccessToken, verifyOrderAccessToken };
