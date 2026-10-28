const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkReleaseConfig } = require("../scripts/releaseCheck");

const ready = {
  ESCOWEAR_MONGO_URI: "mongodb://fixture.invalid/test",
  JWT_SECRET: "test-secret",
  ESCOWEAR_PAYMENT_INSTRUCTIONS: "TEST ONLY",
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
