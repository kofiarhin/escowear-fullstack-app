// Build-time guard only. No network calls, saved configuration changes or secret output.
const review = require("../src/policies/review.json");

const publicationProblems = (record = review) => {
  const problems = [];
  if (record.approvedForPublication !== true) problems.push("Policy publication approval is missing");
  if (!record.version || /draft/i.test(record.version)) problems.push("A final policy version is required");
  for (const field of ["name", "legalStatus", "address", "email", "phone"]) {
    const value = record.seller?.[field];
    if (typeof value !== "string" || !value.trim()) problems.push(`Seller ${field} is missing`);
    else if (/^(to be confirmed|tbc|tbd)$/i.test(value.trim())) problems.push(`Seller ${field} is still a placeholder`);
  }
  if (record.seller?.emailVerified !== true) problems.push("Support email mailbox verification is missing");
  return problems;
};

if (require.main === module) {
  // Match CRA's .env.production/.env loading as well as shell/build arguments.
  // Otherwise a status set only in a client .env file could bypass this guard.
  process.env.NODE_ENV = "production";
  require("react-scripts/config/env");
  const status = process.env.REACT_APP_POLICIES_STATUS || "hidden";
  const problems = !["hidden", "draft", "published"].includes(status)
    ? ["REACT_APP_POLICIES_STATUS must be hidden, draft or published"]
    : status === "published" ? publicationProblems() : [];
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}

module.exports = { publicationProblems };
