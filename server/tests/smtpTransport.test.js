// IDE-124: SMTP transport. Real nodemailer talks to a tiny in-process SMTP
// server on 127.0.0.1, so no email leaves the machine.
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { createTransportFromEnv, isMailbox, readSmtpConfig } = require("../emails/transports");
const { processOutboxBatch } = require("../services/emailOutbox");
const { run: emailCheck } = require("../scripts/emailCheck");
const { createMemoryModel } = require("./helpers/memoryModel");
const { silentLogger } = require("./helpers/testApp");

const SECRET = "abcd efgh ijkl mnop";

// Minimal SMTP server: EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, RSET, NOOP, QUIT.
const startFakeSmtp = async ({ password = SECRET, rejectRecipient = false } = {}) => {
  const messages = [];
  const logins = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let data = "";
    let envelope = { from: null, to: [] };
    let authStep = null;
    let authUser = null;
    const reply = (line) => socket.write(`${line}\r\n`);
    reply("220 fake.smtp ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push({ ...envelope, data });
            data = "";
            reply("250 2.0.0 OK queued as FAKE" + messages.length);
          } else data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          continue;
        }
        if (authStep === "user") {
          authUser = Buffer.from(line, "base64").toString();
          authStep = "pass";
          reply("334 UGFzc3dvcmQ6");
          continue;
        }
        if (authStep === "pass") {
          authStep = null;
          const ok = Buffer.from(line, "base64").toString() === password;
          logins.push({ user: authUser, ok });
          reply(ok ? "235 2.7.0 Accepted" : "535 5.7.8 Username and Password not accepted");
          continue;
        }
        const [verb, ...rest] = line.split(" ");
        switch (verb.toUpperCase()) {
          case "EHLO":
          case "HELO":
            socket.write("250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
            break;
          case "AUTH": {
            if (rest[0].toUpperCase() === "PLAIN") {
              const [, user, pass] = Buffer.from(rest[1], "base64").toString().split("\0");
              const ok = pass === password;
              logins.push({ user, ok });
              reply(ok ? "235 2.7.0 Accepted" : "535 5.7.8 Username and Password not accepted");
            } else {
              authStep = "user";
              reply("334 VXNlcm5hbWU6");
            }
            break;
          }
          case "MAIL":
            envelope = { from: line.match(/<(.*)>/)?.[1], to: [] };
            reply("250 OK");
            break;
          case "RCPT":
            if (rejectRecipient) reply("550 5.1.1 No such user");
            else {
              envelope.to.push(line.match(/<(.*)>/)?.[1]);
              reply("250 OK");
            }
            break;
          case "DATA":
            inData = true;
            reply("354 End data with <CR><LF>.<CR><LF>");
            break;
          case "RSET":
          case "NOOP":
            reply("250 OK");
            break;
          case "QUIT":
            reply("221 Bye");
            socket.end();
            break;
          default:
            reply("502 Command not implemented");
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, messages, logins, close: () => new Promise((resolve) => server.close(resolve)) };
};

const envFor = (port, overrides = {}) => ({
  EMAIL_TRANSPORT: "smtp",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(port),
  SMTP_SECURE: "false",
  SMTP_ALLOW_INSECURE: "true", // the fake server has no TLS; refused in production
  SMTP_USER: "shop@example.test",
  SMTP_PASS: SECRET,
  EMAIL_FROM: "EscoWear <shop@example.test>",
  EMAIL_REPLY_TO: "support@example.test",
  ...overrides,
});

test("config validation names the problem without echoing secrets", () => {
  assert.throws(() => readSmtpConfig({}), /SMTP_HOST is required.*SMTP_USER and SMTP_PASS are required.*EMAIL_FROM/);
  assert.throws(() => readSmtpConfig({ ...envFor(465), SMTP_PORT: "abc" }), /SMTP_PORT/);
  assert.throws(() => readSmtpConfig({ ...envFor(465), SMTP_SECURE: "maybe" }), /SMTP_SECURE/);
  assert.throws(() => readSmtpConfig({ ...envFor(465), EMAIL_FROM: "not an address" }), /EMAIL_FROM/);
  assert.throws(() => readSmtpConfig({ ...envFor(465), NODE_ENV: "production" }), /SMTP_ALLOW_INSECURE is not allowed in production/);
  try {
    readSmtpConfig({ ...envFor(465), SMTP_HOST: "" });
  } catch (error) {
    assert.ok(!error.message.includes(SECRET));
  }

  const gmail = readSmtpConfig({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_USER: "you@gmail.com",
    SMTP_PASS: SECRET,
    EMAIL_FROM: "EscoWear <you@gmail.com>",
  });
  assert.equal(gmail.port, 465);
  assert.equal(gmail.secure, true, "port 465 defaults to TLS");
  assert.equal(readSmtpConfig({ ...envFor(587), SMTP_SECURE: "", SMTP_ALLOW_INSECURE: "" }).secure, false);

  assert.equal(isMailbox("EscoWear <orders@escowear.com>"), true);
  assert.equal(isMailbox("orders@escowear.com"), true);
  assert.equal(isMailbox("EscoWear <orders@escowear.com>\r\nBcc: x@y.z"), false);
});

test("STARTTLS is mandatory unless explicitly allowed for local tests", () => {
  const created = [];
  const nodemailer = { createTransport: (options) => (created.push(options), { sendMail() {}, verify() {}, close() {} }) };
  createTransportFromEnv({ ...envFor(587), SMTP_ALLOW_INSECURE: "" }, silentLogger, { nodemailer });
  assert.equal(created[0].requireTLS, true);
  assert.equal(created[0].ignoreTLS, false);
  assert.equal(created[0].tls.minVersion, "TLSv1.2");
  createTransportFromEnv({ ...envFor(465), SMTP_SECURE: "true", SMTP_ALLOW_INSECURE: "" }, silentLogger, { nodemailer });
  assert.equal(created[1].secure, true);
});

test("real nodemailer delivers an outbox email with From, Reply-To and dedupe header", async (t) => {
  const smtp = await startFakeSmtp();
  t.after(smtp.close);
  const transport = createTransportFromEnv(envFor(smtp.port));
  t.after(() => transport.close());
  const EmailOutbox = createMemoryModel({ uniques: ["dedupeKey"] });
  const Order = createMemoryModel();
  await EmailOutbox.create({
    dedupeKey: "order_received:abc",
    kind: "order_received",
    to: "ama@example.test",
    templateVersion: "t",
    payload: { subject: "EscoWear order received — #EW-AAAAA-BBBBB", text: "Hi Ama,\n.\nLine with a leading dot" },
    state: "queued",
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1000),
  });
  const result = await processOutboxBatch({ EmailOutbox, Order, transport, logger: silentLogger });
  assert.equal(result.sent, 1);
  assert.equal(smtp.messages.length, 1);
  const [message] = smtp.messages;
  assert.equal(message.from, "shop@example.test");
  assert.deepEqual(message.to, ["ama@example.test"]);
  assert.match(message.data, /^From: EscoWear <shop@example\.test>$/m);
  assert.match(message.data, /^Reply-To: support@example\.test$/m);
  assert.match(message.data, /^X-EscoWear-Message-Key: order_received:abc$/im);
  assert.match(message.data, /^Subject: =\?UTF-8\?Q\?EscoWear_order_received_/m); // encoded because of the em dash
  assert.match(message.data, /^Hi Ama,\n\.\nLine with a leading dot$/m); // a lone "." line survives SMTP dot-stuffing
  assert.deepEqual(smtp.logins, [{ user: "shop@example.test", ok: true }]);
  assert.equal(EmailOutbox.docs[0].state, "sent");
  assert.ok(EmailOutbox.docs[0].providerMessageId);
});

test("a wrong app password fails visibly and is retried later, without leaking the secret", async (t) => {
  const smtp = await startFakeSmtp({ password: "the-right-one" });
  t.after(smtp.close);
  const transport = createTransportFromEnv(envFor(smtp.port));
  t.after(() => transport.close());
  const EmailOutbox = createMemoryModel({ uniques: ["dedupeKey"] });
  await EmailOutbox.create({
    dedupeKey: "k1", kind: "order_status", to: "ama@example.test", templateVersion: "t",
    payload: { subject: "s", text: "t" }, state: "queued", attempts: 0, nextAttemptAt: new Date(Date.now() - 1000),
  });
  const result = await processOutboxBatch({ EmailOutbox, Order: createMemoryModel(), transport, logger: silentLogger });
  assert.equal(result.retried, 1);
  const stored = EmailOutbox.docs[0];
  assert.equal(stored.state, "queued");
  assert.match(stored.lastError, /535|Invalid login|not accepted/i);
  assert.ok(!stored.lastError.includes(SECRET));
  assert.equal(smtp.messages.length, 0);
});

test("a rejected recipient is a failed send, not a silent success", async (t) => {
  const smtp = await startFakeSmtp({ rejectRecipient: true });
  t.after(smtp.close);
  const transport = createTransportFromEnv(envFor(smtp.port));
  t.after(() => transport.close());
  await assert.rejects(transport.send({ to: "nobody@example.test", subject: "s", text: "t" }));
  await assert.rejects(transport.send({ to: "bad address\r\nBcc: x@y.z", subject: "s", text: "t" }), /Invalid recipient/);
});

test("email:check logs in, optionally sends a test, and never prints the password", async (t) => {
  const smtp = await startFakeSmtp();
  t.after(smtp.close);
  const lines = [];
  await emailCheck(["--send-to", "kofi@example.test"], { env: envFor(smtp.port), log: (line) => lines.push(line) });
  assert.ok(lines.some((line) => /Login OK/.test(line)));
  assert.ok(lines.some((line) => /Test email accepted/.test(line)));
  assert.ok(lines.every((line) => !line.includes(SECRET) && !line.includes("shop@example.test")), "user is masked, password never shown");
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.messages[0].data, /No order was created/);
});
