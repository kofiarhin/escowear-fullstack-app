// Checks the SMTP settings in .env: logs in without sending, then optionally
// sends one test email. Never prints the password and never touches the database.
//
//   npm run email:check                       # login check only
//   npm run email:check -- --send-to you@example.com
require("dotenv").config();
const { createSmtpTransport, readSmtpConfig } = require("../emails/transports");

const run = async (argv = process.argv.slice(2), { env = process.env, log = console.log, deps } = {}) => {
  const index = argv.indexOf("--send-to");
  const sendTo = index >= 0 ? argv[index + 1] : null;
  const config = readSmtpConfig(env);
  log(`SMTP ${config.host}:${config.port} (${config.secure ? "TLS" : "STARTTLS"}) as ${config.user.replace(/^(.).*(@.*)$/, "$1***$2")}`);
  const transport = createSmtpTransport(config, deps);
  try {
    await transport.verify();
    log("Login OK");
    if (sendTo) {
      const { providerMessageId } = await transport.send({
        to: sendTo,
        subject: "EscoWear email test",
        text: "This is a test message from the EscoWear server. No order was created.",
      });
      log(`Test email accepted by the server (${providerMessageId})`);
    }
  } finally {
    transport.close();
  }
};

// Provider error messages can echo recipients or authentication details, so only
// safe error codes and readSmtpConfig's own messages (setting names, never values) are shown.
const SAFE_CODES = new Set(["EAUTH", "ETIMEDOUT", "ECONNECTION", "ECONNREFUSED", "ESOCKET", "ENOTFOUND"]);
const describeFailure = (error) => {
  if (SAFE_CODES.has(error?.code)) return error.code;
  if (String(error?.message).startsWith("Invalid SMTP configuration: ")) return error.message;
  return "check configuration and connection privately";
};

if (require.main === module) {
  run().catch((error) => {
    console.error(`Email check failed: ${describeFailure(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { describeFailure, run };
