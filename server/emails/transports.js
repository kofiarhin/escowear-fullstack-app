// Mail transports, selected by EMAIL_TRANSPORT:
//   none (default) — the worker does not run; messages stay queued and visible.
//   log            — development only: logs the subject and recipient domain
//                    and marks the message sent. Refused in production.
//   smtp           — any SMTP provider (Gmail for the MVP). Every setting comes
//                    from the environment, so changing provider is an .env change.
// A transport implements send({to, subject, text, idempotencyKey}) -> {providerMessageId}.
const crypto = require("crypto");

const createLogTransport = (logger = console) => ({
  name: "log",
  async send({ to, subject }) {
    const domain = String(to).split("@")[1] || "unknown";
    logger.log(`[email:log] to *@${domain}: ${subject}`);
    return { providerMessageId: `log-${crypto.randomUUID()}` };
  },
});

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// Accepts "addr@example.com" or "Display Name <addr@example.com>".
const isMailbox = (value) => {
  const match = String(value).match(/^\s*(?:[^<>\r\n]*<([^<>\s]+)>|([^<>\s]+))\s*$/);
  return Boolean(match && ADDRESS.test(match[1] || match[2]));
};

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  return null;
};

// Reads and validates SMTP settings. Errors name the variable, never its value.
const readSmtpConfig = (env = process.env) => {
  const problems = [];
  const host = (env.SMTP_HOST || "").trim();
  if (!host) problems.push("SMTP_HOST is required");

  const portRaw = (env.SMTP_PORT || "").trim();
  const port = portRaw ? Number(portRaw) : 465;
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT must be a port number");

  // Port 465 uses TLS from the start; other ports must upgrade with STARTTLS.
  const secure = parseBoolean(env.SMTP_SECURE, port === 465);
  if (secure === null) problems.push("SMTP_SECURE must be true or false");

  const user = env.SMTP_USER || "";
  const pass = env.SMTP_PASS || "";
  if (!user || !pass) problems.push("SMTP_USER and SMTP_PASS are required");

  const from = (env.EMAIL_FROM || "").trim();
  if (!from || !isMailbox(from)) problems.push('EMAIL_FROM must be an address, e.g. "EscoWear <orders@example.com>"');
  const replyTo = (env.EMAIL_REPLY_TO || "").trim();
  if (replyTo && !isMailbox(replyTo)) problems.push("EMAIL_REPLY_TO must be an email address");

  // Unencrypted SMTP is only for local test servers and never allowed in production.
  const allowInsecure = parseBoolean(env.SMTP_ALLOW_INSECURE, false) === true;
  if (allowInsecure && env.NODE_ENV === "production") problems.push("SMTP_ALLOW_INSECURE is not allowed in production");

  if (problems.length) throw new Error(`Invalid SMTP configuration: ${problems.join("; ")}`);
  return { host, port, secure, user, pass, from, replyTo: replyTo || undefined, allowInsecure };
};

const createSmtpTransport = (config, { nodemailer = require("nodemailer") } = {}) => {
  const mailer = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure && !config.allowInsecure,
    ignoreTLS: config.allowInsecure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2" },
  });

  return {
    name: "smtp",
    async send({ to, subject, text, idempotencyKey }) {
      if (!ADDRESS.test(String(to))) throw new Error("Invalid recipient address");
      const info = await mailer.sendMail({
        from: config.from,
        to,
        replyTo: config.replyTo,
        subject,
        text,
        // Lets the provider or mailbox spot accidental resends of one logical email.
        headers: idempotencyKey ? { "X-EscoWear-Message-Key": idempotencyKey } : undefined,
      });
      if (Array.isArray(info.rejected) && info.rejected.length) throw new Error("Recipient rejected by the mail server");
      return { providerMessageId: info.messageId };
    },
    // Checks the connection and login without sending anything.
    verify: () => mailer.verify(),
    close: () => mailer.close(),
  };
};

const createTransportFromEnv = (env = process.env, logger = console, deps = {}) => {
  const name = (env.EMAIL_TRANSPORT || "none").trim().toLowerCase();
  if (name === "none") return null;
  if (name === "log") {
    if (env.NODE_ENV === "production") throw new Error("EMAIL_TRANSPORT=log is not allowed in production");
    return createLogTransport(logger);
  }
  if (name === "smtp") return createSmtpTransport(readSmtpConfig(env), deps);
  throw new Error(`Unsupported EMAIL_TRANSPORT "${name}"`);
};

module.exports = { createLogTransport, createSmtpTransport, createTransportFromEnv, isMailbox, readSmtpConfig };
