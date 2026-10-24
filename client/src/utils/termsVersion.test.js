import review from "../policies/review.json";

const loadTermsVersion = (env) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  let version;
  jest.isolateModules(() => {
    version = require("./checkout").TERMS_VERSION;
  });
  process.env = saved;
  return version;
};

test("published checkout always records the published policy version", () => {
  expect(loadTermsVersion({ REACT_APP_POLICIES_STATUS: "published", REACT_APP_ORDER_TERMS_VERSION: "legacy-override" })).toBe(review.version);
});

test("unpublished checkout keeps the draft terms version or its override", () => {
  expect(loadTermsVersion({})).toBe("draft-2026-10");
  expect(loadTermsVersion({ REACT_APP_ORDER_TERMS_VERSION: "legacy-override" })).toBe("legacy-override");
});
