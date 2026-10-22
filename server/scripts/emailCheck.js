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

if (require.main === module) {
  run().catch((error) => {
    console.error(`Email check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run };
