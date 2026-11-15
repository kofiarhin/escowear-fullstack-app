'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyCi, ciStatus, apiGet } = require('../check-ci.cjs');

const SHA = 'a'.repeat(40);
const REPO = 'kofiarhin/escowear-fullstack-app';
const TOKEN = 'test-token';

function run(overrides = {}) {
  return {
    id: 41, head_sha: SHA, event: 'push', head_branch: 'master',
    path: '.github/workflows/ci.yml', status: 'completed',
    conclusion: 'success', created_at: '2026-11-13T00:00:00Z',
    run_attempt: 1, ...overrides,
  };
}
function cssRun(overrides = {}) {
  return run({ id: 51, path: '.github/workflows/css-lint.yml', ...overrides });
}
function job(overrides = {}) {
  return { name: 'verify', conclusion: 'success', head_sha: SHA, ...overrides };
}
function cssJob(overrides = {}) {
  return job({ name: 'css-lint', ...overrides });
}
// Serves CI and CSS lint separately; CSS lint passes unless overridden.
function mockApi(runs, jobs, css = { runs: [cssRun()], jobs: [cssJob()] }) {
  return async (path, token) => {
    assert.equal(token, TOKEN);
    if (path.includes('/workflows/css-lint.yml/')) return { workflow_runs: css.runs };
    if (path.includes('/workflows/ci.yml/')) return { workflow_runs: runs };
    if (path.includes('/runs/51/jobs?')) return { jobs: css.jobs };
    return { jobs };
  };
}
const verify = (runs, jobs, css) => verifyCi(REPO, SHA, TOKEN, mockApi(runs, jobs, css));

test('passes only when the exact master push, verify and css-lint jobs succeeded', async () => {
  assert.deepEqual(await verify([run()], [job()]), [41, 51]);
});
test('fails when no matching run exists', async () => {
  await assert.rejects(verify([], []), /No master push CI \/ verify run/);
});
test('fails for a different commit, event, branch, or workflow', async () => {
  for (const changes of [
    { head_sha: 'b'.repeat(40) }, { event: 'pull_request' },
    { head_branch: 'feature' }, { path: '.github/workflows/other.yml' },
  ]) {
    await assert.rejects(verify([run(changes)], [job()]), /No master push CI \/ verify run/);
  }
});
test('fails for pending or failed CI', async () => {
  await assert.rejects(verify([run({ status: 'in_progress', conclusion: null })], []), /still running/);
  await assert.rejects(verify([run({ conclusion: 'failure' })], []), /has not passed/);
});
test('fails when verify job is missing, failed, or belongs to another commit', async () => {
  for (const jobs of [[], [job({ name: 'other' })],
    [job({ conclusion: 'failure' })], [job({ head_sha: 'b'.repeat(40) })]]) {
    await assert.rejects(verify([run()], jobs), /CI \/ verify job did not pass/);
  }
});
test('newest CI result must pass; cannot use an older successful run', async () => {
  const older = run({ id: 40, created_at: '2026-11-12T00:00:00Z' });
  const newer = run({ id: 41, status: 'completed', conclusion: 'failure' });
  await assert.rejects(verify([older, newer], [job()]), /has not passed/);
});
test('CSS lint is required: missing, pending, failed or wrong-job runs block deployment', async () => {
  for (const [css, pattern] of [
    [{ runs: [], jobs: [] }, /No master push CSS lint/],
    [{ runs: [cssRun({ status: 'queued', conclusion: null })], jobs: [] }, /CSS lint \/ css-lint is still running/],
    [{ runs: [cssRun({ conclusion: 'failure' })], jobs: [] }, /CSS lint \/ css-lint has not passed/],
    [{ runs: [cssRun()], jobs: [cssJob({ name: 'other' })] }, /CSS lint \/ css-lint job did not pass/],
    [{ runs: [cssRun({ event: 'pull_request' })], jobs: [cssJob()] }, /No master push CSS lint/],
  ]) {
    await assert.rejects(verify([run()], [job()], css), pattern);
  }
});
test('ciStatus reports each check state without throwing', async () => {
  const results = await ciStatus(REPO, SHA, TOKEN, mockApi([run()], [job()],
    { runs: [cssRun({ status: 'in_progress', conclusion: null })], jobs: [] }));
  assert.deepEqual(results.map(result => result.state), ['success', 'pending']);
});
test('missing token fails before any API call', async () => {
  let called = false;
  await assert.rejects(verifyCi(REPO, SHA, '', async () => { called = true; }), /ESCOWEAR_GITHUB_TOKEN/);
  assert.equal(called, false);
});
test('invalid repository or SHA fails before any API call', async () => {
  for (const [repo, sha] of [['../bad', SHA], [REPO, 'bad']]) {
    await assert.rejects(verifyCi(repo, sha, TOKEN, async () => { throw Error('should not call'); }), /Invalid/);
  }
});
test('API failure blocks deployment without exposing the token or response body', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => `secret ${TOKEN}` });
  try {
    await assert.rejects(apiGet('/test', TOKEN), error =>
      error.message.includes('deployment blocked') && !error.message.includes(TOKEN)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
