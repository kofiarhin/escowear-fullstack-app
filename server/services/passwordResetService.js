const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { createTransportFromEnv, safeSmtpFailureDiagnostic } = require("../emails/transports");

const RESET_TTL_MS = 30 * 60 * 1000;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;
const GENERIC_RESET_MESSAGE = "If an account matches that email address, we have sent password reset instructions.";
const INVALID_RESET_MESSAGE = "This password reset link is invalid or has expired.";
const DEVELOPMENT_PUBLIC_URL = "http://localhost:3000";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalizeEmail = (value) => (typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null);
const passwordError = (password) =>
  typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX
    ? `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`
    : null;

const resetBaseUrlFor = (env = process.env) => (env.NODE_ENV === "production" ? env.ESCOWEAR_PUBLIC_URL : DEVELOPMENT_PUBLIC_URL);

const resetLink = (baseUrl, token) => {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  const parsed = new URL(normalizedBaseUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Invalid public application URL");
  return `${normalizedBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
};

const resetEmail = (link) => ({
  subject: "Reset your EscoWear password",
  text: [
    "We received a request to reset your EscoWear password.",
    "",
    `Reset your password: ${link}`,
    "",
    "This link expires in 30 minutes and can only be used once.",
    "If you did not request a password reset, you can safely ignore this email.",
    "",
    "Thank you,",
    "EscoWear",
  ].join("\n"),
});

const createPasswordResetService = ({
  User,
  publicBaseUrl,
  env = process.env,
  transportFactory = () => createTransportFromEnv(),
  randomBytes = crypto.randomBytes,
  now = () => new Date(),
  logger = console,
} = {}) => {
  const requestReset = async ({ email }) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return { message: GENERIC_RESET_MESSAGE };

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return { message: GENERIC_RESET_MESSAGE };

    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256(token);
    const expiresAt = new Date(now().getTime() + RESET_TTL_MS);
    await User.updateOne({ _id: user._id }, { $set: { passwordResetToken: tokenHash, passwordResetExpires: expiresAt } });

    let transport;
    try {
      // Resolve the origin when handling the request so it cannot be captured
      // before dotenv loads. Local emails must never point to production.
      const link = resetLink(publicBaseUrl === undefined ? resetBaseUrlFor(env) : publicBaseUrl, token);
      transport = transportFactory();
      if (!transport) throw new Error("Email transport unavailable");
      const emailMessage = resetEmail(link);
      await transport.send({
        to: user.email,
        ...emailMessage,
        idempotencyKey: `password-reset:${user._id}:${expiresAt.getTime()}`,
      });
    } catch (error) {
      // Do not retain a credential the customer did not receive. Matching the
      // hash keeps a newer concurrent request from being cleared accidentally.
      await User.updateOne(
        { _id: user._id, passwordResetToken: tokenHash },
        { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
      );
      // Tokens, passwords, addresses and provider responses are never logged.
      logger.warn(`Password reset email could not be sent (${safeSmtpFailureDiagnostic(error)})`);
    } finally {
      if (transport?.close) transport.close();
    }
    return { message: GENERIC_RESET_MESSAGE };
  };

  const resetPassword = async ({ token, password }) => {
    const error = passwordError(password);
    if (error) return { error };
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return { error: INVALID_RESET_MESSAGE };

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.findOneAndUpdate(
      {
        passwordResetToken: sha256(token),
        passwordResetExpires: { $gt: now() },
      },
      {
        $set: { password: passwordHash },
        $inc: { sessionVersion: 1 },
        $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
      },
      { new: true }
    );
    if (!user) return { error: INVALID_RESET_MESSAGE };
    return { message: "Your password has been reset. You can now sign in." };
  };

  return { requestReset, resetPassword };
};

module.exports = {
  GENERIC_RESET_MESSAGE,
  INVALID_RESET_MESSAGE,
  PASSWORD_MAX,
  PASSWORD_MIN,
  RESET_TTL_MS,
  createPasswordResetService,
  passwordError,
  resetBaseUrlFor,
  sha256,
};
