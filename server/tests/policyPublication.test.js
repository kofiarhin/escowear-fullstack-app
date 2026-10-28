const { test } = require("node:test");
const assert = require("node:assert/strict");
const { publicationProblems } = require("../../client/scripts/check-policies.cjs");

test("an unapproved policy draft cannot be published", () => {
  const problems = publicationProblems({ approvedForPublication: false, version: "draft", seller: {} });
  assert.ok(problems.includes("Policy publication approval is missing"));
  assert.ok(problems.includes("Seller address is missing"));
});

test("publication requires approval, a final version and every seller field", () => {
  const reviewed = {
    approvedForPublication: true,
    version: "mvp-reviewed-test",
    seller: { name: "Test Seller", legalStatus: "Test status", address: "Test address", email: "seller@example.test", emailVerified: true, phone: "Test phone" },
  };
  assert.deepEqual(publicationProblems(reviewed), []);
  assert.ok(publicationProblems({ ...reviewed, approvedForPublication: false }).length);
  assert.ok(publicationProblems({ ...reviewed, version: "draft" }).length);
  for (const field of ["name", "legalStatus", "address", "email", "phone"]) {
    assert.ok(publicationProblems({ ...reviewed, seller: { ...reviewed.seller, [field]: " " } }).includes(`Seller ${field} is missing`));
  }
  assert.ok(publicationProblems({ ...reviewed, seller: { ...reviewed.seller, emailVerified: false } }).includes("Support email mailbox verification is missing"));
  for (const address of ["To be confirmed", " tbc ", "TBD", "PLACEHOLDER — set before publishing"]) {
    assert.ok(publicationProblems({ ...reviewed, seller: { ...reviewed.seller, address } }).includes("Seller address is still a placeholder"));
  }
});
