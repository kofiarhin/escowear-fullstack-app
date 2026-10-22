const jwt = require("jsonwebtoken");
const User = require("../Models/User.model");

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

const bearerToken = (req) => {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
};

// Resolves the logged-in customer for a bearer token. Tokens that carry an
// audience (e.g. guest order-access tokens) or no valid user id are rejected,
// so a lookup can never degrade into an unfiltered query.
const createAuth = (UserModel = User) => {
  const resolveUser = async (token) => {
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
      return { error: 401, message: "Unauthorized - invalid token" };
    }
    if (!payload || payload.aud !== undefined || typeof payload.id !== "string" || !OBJECT_ID.test(payload.id)) {
      return { error: 401, message: "Unauthorized - invalid token" };
    }
    const user = await UserModel.findOne({ _id: payload.id });
    if (!user) return { error: 404, message: "authorization - user not found" };
    return { user, issuedAt: typeof payload.iat === "number" ? payload.iat : 0 };
  };

  const auth = async (req, res, next) => {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: "Unauthorized - no token" });
    try {
      const result = await resolveUser(token);
      if (result.error) return res.status(result.error).json({ error: result.message });
      req.user = result.user;
      req.tokenIssuedAt = result.issuedAt;
      return next();
    } catch {
      return res.status(500).json({ error: "Authorization failed" });
    }
  };

  // Attaches req.user when a valid token is sent; anonymous requests continue.
  // A token that is present but invalid is still rejected.
  const optionalAuth = async (req, res, next) => {
    if (!req.headers.authorization) return next();
    return auth(req, res, next);
  };

  // Admin access also requires a recent sign-in, so a long-lived token that
  // leaks (or predates a role change) cannot be used for admin actions.
  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const ageSeconds = Math.floor(Date.now() / 1000) - (req.tokenIssuedAt || 0);
    if (ageSeconds > ADMIN_SESSION_SECONDS) {
      return res.status(401).json({ error: "Please sign in again to use admin tools", code: "ADMIN_REAUTH_REQUIRED" });
    }
    return next();
  };

  return { auth, optionalAuth, requireAdmin };
};

const defaultAuth = createAuth();

module.exports = defaultAuth.auth;
module.exports.createAuth = createAuth;
module.exports.optionalAuth = defaultAuth.optionalAuth;
module.exports.requireAdmin = defaultAuth.requireAdmin;
module.exports.ADMIN_SESSION_SECONDS = ADMIN_SESSION_SECONDS;
