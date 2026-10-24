// Offline readiness check: reads settings but never prints their values,
// connects to a database, sends email or changes the environment.
const { readSmtpConfig } = require("../emails/transports");
const { publicationProblems } = require("../../client/scripts/check-policies.cjs");

const checkReleaseConfig = (env, policyProblems = publicationProblems()) => {
  const problems = [];
  for (const name of ["ESCOWEAR_MONGO_URI", "JWT_SECRET", "ESCOWEAR_PAYMENT_INSTRUCTIONS"]) {
    if (!env[name]?.trim()) problems.push(`${name} is missing`);
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
