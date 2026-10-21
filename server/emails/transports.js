// Mail transports. No provider SDK is bundled (decision D3 is open), so:
//   none (default) — the worker does not run; messages stay queued and visible.
//   log            — development only: logs the subject and recipient domain
//                    and marks the message sent. Refused in production.
// A real provider adapter must implement send({to, subject, text, idempotencyKey})
// -> {providerMessageId}, and be added here once approved.
const crypto = require("crypto");

const createLogTransport = (logger = console) => ({
  name: "log",
  async send({ to, subject }) {
    const domain = String(to).split("@")[1] || "unknown";
    logger.log(`[email:log] to *@${domain}: ${subject}`);
    return { providerMessageId: `log-${crypto.randomUUID()}` };
  },
});

const createTransportFromEnv = (env = process.env, logger = console) => {
  const name = (env.EMAIL_TRANSPORT || "none").trim().toLowerCase();
  if (name === "none") return null;
  if (name === "log") {
    if (env.NODE_ENV === "production") throw new Error("EMAIL_TRANSPORT=log is not allowed in production");
    return createLogTransport(logger);
  }
  throw new Error(`Unsupported EMAIL_TRANSPORT "${name}"`);
};

module.exports = { createLogTransport, createTransportFromEnv };
