// EscoWear MVP policies, from Kofi's recorded decisions (docs/mvp-policies-draft.md,
// Linear IDE-126). Owner-approved for publication on 30 Oct 2026; formal legal
// review is deferred, not done.
//
// Visibility is set at build time by REACT_APP_POLICIES_STATUS:
//   hidden (default) — /policies shows a "being finalised" notice and nothing links to it
//   draft            — full text with a DRAFT banner, for review only (never deploy publicly)
//   published        — full text, linked from checkout and the footer
// "published" also requires the build guard (scripts/check-policies.cjs) to pass.

import review from "./review.json";

export const POLICY_VERSION = review.version;

// Exact lowercase values only; anything else means hidden.
const STATUSES = ["hidden", "draft", "published"];
export const policiesStatus = () => {
  const value = process.env.REACT_APP_POLICIES_STATUS;
  return STATUSES.includes(value) ? value : "hidden";
};
export const policiesVisible = () => policiesStatus() !== "hidden";

// The comparison below is against a build-time constant, so when policies are
// hidden webpack drops the require and the unreviewed draft text is not
// shipped in the public JavaScript at all.
export const loadPolicySections = () =>
  process.env.REACT_APP_POLICIES_STATUS === "draft" || process.env.REACT_APP_POLICIES_STATUS === "published"
    ? require("./sections").POLICY_SECTIONS
    : [];
