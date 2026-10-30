// Creates the owner's admin account from ADMIN_EMAIL / ADMIN_PASSWORD on
// startup. Create-only: an existing account is never modified, so restarts
// cannot reset a changed password and a customer account is never promoted
// (anyone can register any email, so promotion stays an explicit operator step
// via server/scripts/setUserRole.js). The password is never logged.
const bcrypt = require("bcryptjs");
const User = require("../Models/User.model");

const ADMIN_PASSWORD_MIN = 12;
const ADMIN_PASSWORD_MAX = 128;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// "kofi@example.com" -> "k***@example.com"
const maskEmail = (email) => email.replace(/^(.)[^@]*/, "$1***");

// Returns setting problems by name only (never values).
const adminSettingsProblems = (env = process.env) => {
  const email = (env.ADMIN_EMAIL || "").trim();
  const password = env.ADMIN_PASSWORD || "";
  if (!email && !password) return [];
  const problems = [];
  if (!EMAIL.test(email)) problems.push("ADMIN_EMAIL must be an email address");
  if (password.length < ADMIN_PASSWORD_MIN || password.length > ADMIN_PASSWORD_MAX) {
    problems.push(`ADMIN_PASSWORD must be ${ADMIN_PASSWORD_MIN}-${ADMIN_PASSWORD_MAX} characters`);
  }
  return problems;
};

const ensureAdminAccount = async ({ env = process.env, UserModel = User, logger = console, hash = (value) => bcrypt.hash(value, 10) } = {}) => {
  const email = (env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email && !env.ADMIN_PASSWORD) return { status: "not_configured" };

  const problems = adminSettingsProblems(env);
  if (problems.length) {
    // A bad admin setting must not take the shop down.
    logger.error(`Admin account not created: ${problems.join("; ")}`);
    return { status: "invalid", problems };
  }

  const name = (env.ADMIN_NAME || "").trim() || "EscoWear Admin";
  // Same bcrypt cost as the User model's save hook. Upsert with $setOnInsert is
  // atomic with the unique email index, so concurrent starts create one account
  // and an existing account is left exactly as it is.
  const password = await hash(env.ADMIN_PASSWORD);
  let result;
  try {
    result = await UserModel.updateOne(
      { email },
      { $setOnInsert: { name, email, password, role: "admin" } },
      { upsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    result = { upsertedCount: 0 };
  }

  if (result.upsertedCount) {
    logger.log(`Admin account created for ${maskEmail(email)}`);
    return { status: "created" };
  }
  const existing = await UserModel.findOne({ email }).select("role").lean();
  if (existing?.role === "admin") {
    logger.log(`Admin account for ${maskEmail(email)} already exists; left unchanged`);
    return { status: "exists" };
  }
  logger.error(
    `ADMIN_EMAIL ${maskEmail(email)} belongs to an existing customer account; it was not promoted. ` +
      "Confirm the account is yours, then run server/scripts/setUserRole.js."
  );
  return { status: "customer_exists" };
};

module.exports = { ADMIN_PASSWORD_MIN, adminSettingsProblems, ensureAdminAccount, maskEmail };
