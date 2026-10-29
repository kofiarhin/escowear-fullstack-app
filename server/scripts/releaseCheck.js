// Offline readiness check: reads settings but never prints their values,
// connects to a database, sends email or changes the environment.
const { readSmtpConfig } = require("../emails/transports");
const path = require("path");
const { paymentInstructions } = require("../config/paymentInstructions");
const { publicationProblems } = require("../../client/scripts/check-policies.cjs");

const REPO = path.resolve(__dirname, "../..");
// Directories Express or the client build can serve: proofs must never live there.
const PUBLIC_ROOTS = ["client", "server/images"].map((dir) => path.join(REPO, dir));

const checkReleaseConfig = (env, policyProblems = publicationProblems()) => {
  const problems = [];
  for (const name of ["ESCOWEAR_MONGO_URI", "JWT_SECRET", "ESCOWEAR_PAYMENT_INSTRUCTIONS"]) {
    if (!(name === "ESCOWEAR_PAYMENT_INSTRUCTIONS" ? paymentInstructions(env) : env[name])?.trim()) problems.push(`${name} is missing`);
  }
  // Test placeholders must never reach customers as real payment details:
  // placeholder words, masked digits (0XX) or template slots (<account name>).
  // Fails safe: a real name containing "Test" is refused too, so reword it.
  const PLACEHOLDER_PAYMENT = /\b(placeholders?|examples?|test|testing|dummy|fake|sample)\b|not a real|X{2,}|<[^>]*>/i;
  if (PLACEHOLDER_PAYMENT.test(paymentInstructions(env))) {
    problems.push("ESCOWEAR_PAYMENT_INSTRUCTIONS still contains placeholder/test wording");
  }
  if (env.EMAIL_TRANSPORT !== "smtp") problems.push("EMAIL_TRANSPORT must be smtp for checkout launch");
  try {
    readSmtpConfig({ ...env, NODE_ENV: "production" });
  } catch {
    problems.push("SMTP configuration is incomplete or invalid; review .env.example privately");
  }
  try {
    const url = new URL(env.ESCOWEAR_PUBLIC_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
  } catch {
    problems.push("ESCOWEAR_PUBLIC_URL must be an HTTPS origin without credentials, path, query or fragment");
  }
  if (env.ESCOWEAR_POLICIES_STATUS !== "published") problems.push("Reviewed policies must be published before checkout launch");
  const proofDir = (env.ESCOWEAR_PROOF_UPLOAD_DIR || "").trim();
  if (!proofDir || !path.isAbsolute(proofDir)) {
    problems.push("ESCOWEAR_PROOF_UPLOAD_DIR must be an absolute path on a persistent private volume");
  } else if (PUBLIC_ROOTS.some((root) => path.resolve(proofDir) === root || path.resolve(proofDir).startsWith(root + path.sep))) {
    problems.push("ESCOWEAR_PROOF_UPLOAD_DIR must not be inside a public/static directory");
  }
  const reply = (env.EMAIL_REPLY_TO || "").trim();
  const from = (env.EMAIL_FROM || "").match(/<([^>]+)>/)?.[1] || (env.EMAIL_FROM || "").trim();
  if (reply && from && reply.toLowerCase() !== from.toLowerCase()) {
    problems.push("EMAIL_REPLY_TO differs from EMAIL_FROM: confirm the provider allows it as a verified alias so one mailbox handles all support (then clear this by matching them)");
  }
  problems.push(...policyProblems);
  return problems;
};

if (require.main === module) {
  require("dotenv").config();
  const problems = checkReleaseConfig(process.env);
  for (const problem of problems) console.error(`BLOCKED: ${problem}`);
  if (!problems.length) console.log("Offline configuration checks passed; live mail, payment details, indexes, admin access and recovery still require verification.");
  process.exitCode = problems.length ? 1 : 0;
}

module.exports = { checkReleaseConfig };
