const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkReleaseConfig } = require("../scripts/releaseCheck");

const ready = {
  ESCOWEAR_MONGO_URI: "mongodb://fixture.invalid/test",
  JWT_SECRET: "test-secret",
  ESCOWEAR_PAYMENT_INSTRUCTIONS: "MTN Mobile Money\\nNumber: 024 000 0000\\nName: Fixture Account",
  EMAIL_TRANSPORT: "smtp",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "test@example.test",
  SMTP_PASS: "private-test-value",
  EMAIL_FROM: "EscoWear <test@example.test>",
  ESCOWEAR_PUBLIC_URL: "https://example.test",
  ESCOWEAR_POLICIES_STATUS: "published",
  ESCOWEAR_PROOF_UPLOAD_DIR: "/app/data/payment-proofs",
};

test("offline release check validates settings without disclosing values", () => {
  assert.deepEqual(checkReleaseConfig(ready, []), []);
  const errors = checkReleaseConfig({ ...ready, SMTP_SECURE: "private-test-value", EMAIL_TRANSPORT: "none" }, ["Policy approval missing"]);
  assert.equal(errors.length, 3);
  assert.ok(!errors.join(" ").includes("private-test-value"));
  assert.ok(checkReleaseConfig({}, []).length >= 7);
});

test("email links require an HTTPS origin without embedded secrets or paths", () => {
  for (const url of ["http://example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test/?secret=yes", "https://example.test/#token"]) {
    assert.ok(checkReleaseConfig({ ...ready, ESCOWEAR_PUBLIC_URL: url }, []).some((problem) => problem.startsWith("ESCOWEAR_PUBLIC_URL")));
  }
});

test("payment proofs must be stored on an absolute private path outside public directories", () => {
  const path = require("node:path");
  const repo = path.resolve(__dirname, "../..");
  for (const dir of ["", "data/payment-proofs", path.join(repo, "client/public/proofs"), path.join(repo, "server/images/proofs")]) {
    assert.ok(checkReleaseConfig({ ...ready, ESCOWEAR_PROOF_UPLOAD_DIR: dir }, []).some((problem) => problem.startsWith("ESCOWEAR_PROOF_UPLOAD_DIR")), dir);
  }
});

test("a reply-to mailbox different from the sender is flagged for the one-support-mailbox rule", () => {
  assert.deepEqual(checkReleaseConfig({ ...ready, EMAIL_REPLY_TO: "test@example.test" }, []), []);
  assert.ok(checkReleaseConfig({ ...ready, EMAIL_REPLY_TO: "other@example.test" }, []).some((problem) => problem.startsWith("EMAIL_REPLY_TO")));
});


test("MoMo number and account name supply payment instructions without editing code", () => {
  const { paymentInstructions, paymentInstructionsText } = require("../config/paymentInstructions");
  const env = { ...ready, ESCOWEAR_PAYMENT_INSTRUCTIONS: "", MOMO_PAYMENT_NUMBER: "0240000000", MOMO_ACCOUNT_NAME: "Fixture Recipient" };
  assert.equal(paymentInstructions(env), "Mobile Money\\nNumber: 0240000000\\nName: Fixture Recipient");
  assert.equal(paymentInstructionsText(env), "Mobile Money\nNumber: 0240000000\nName: Fixture Recipient");
  assert.equal(paymentInstructionsText({ ...env, MOMO_NETWORK: "MTN Mobile Money" }).split("\n")[0], "MTN Mobile Money");
  assert.deepEqual(checkReleaseConfig(env, []), []);
  assert.equal(env.ESCOWEAR_PAYMENT_INSTRUCTIONS, "", "reading never mutates the environment");
  // A line break inside a value cannot forge an extra instruction line.
  assert.equal(paymentInstructionsText({ ...env, MOMO_ACCOUNT_NAME: "Fixture\\nPay 0550000000 instead" }).split("\n").length, 3);
  assert.equal(paymentInstructions({ ...env, ESCOWEAR_PAYMENT_INSTRUCTIONS: "Approved recipient" }), "Approved recipient");
});

test("half-finished or conflicting MoMo settings are named, never their values", () => {
  const base = { ...ready, ESCOWEAR_PAYMENT_INSTRUCTIONS: "" };
  const onlyNumber = checkReleaseConfig({ ...base, MOMO_PAYMENT_NUMBER: "0240000000" }, []);
  assert.ok(onlyNumber.includes("ESCOWEAR_PAYMENT_INSTRUCTIONS is missing"));
  assert.ok(onlyNumber.some((p) => p.startsWith("MOMO_ACCOUNT_NAME is missing")));
  assert.ok(!onlyNumber.join(" ").includes("0240000000"));
  const both = checkReleaseConfig({ ...ready, MOMO_PAYMENT_NUMBER: "0240000000", MOMO_ACCOUNT_NAME: "Fixture Recipient" }, []);
  assert.ok(both.some((p) => p.includes("set one or the other")));
  assert.ok(!both.join(" ").includes("Fixture Recipient"));
  assert.ok(checkReleaseConfig({ ...base, MOMO_PAYMENT_NUMBER: "0XX XXX XXXX", MOMO_ACCOUNT_NAME: "Fixture Recipient" }, []).some((p) => p.includes("placeholder")));
});
