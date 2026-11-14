'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyCi, apiGet } = require('../check-ci.cjs');

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
function job(overrides = {}) {
  return { name: 'verify', conclusion: 'success', head_sha: SHA,...overrides };
}
function mockApi(runs, jobs) {
  return async (path, token) => {
    assert.equal(token, TOKEN);
    return path.includes('/jobs?') ? { jobs } : { workflow_runs: runs };
  };
}
const verify = (runs, jobs) => verifyCi(REPO, SHA, TOKEN, mockApi(runs, jobs));

test('passes only when the exact master push and verify job succeeded', async () => {
  assert.equal(await verify([run()], [job()]), 41);
});
test('fails when no matching run exists', async () => {
  await assert.rejects(verify([], []), /No master push CI workflow/);
});
test('fails for a different commit, event, branch, or workflow', async () => {
  for (const changes of [
    { head_sha: 'b'.repeat(40) }, { event: 'pull_request' },
    { head_branch: 'feature' }, { path: '.github/workflows/other.yml' },
  ]) {
    await assert.rejects(verify([run(changes)], [job()]), /No master push CI workflow/);
  }
});
test('fails for pending or failed CI', async () => {
  for (const changes of [
    { status: 'in_progress', conclusion: null },
    { status: 'completed', conclusion: 'failure' },
  ]) {
    await assert.rejects(verify([run(changes)], []), /CI has not passed/);
  }
});
test('fails when verify job is missing, failed, or belongs to another commit', async () => {
  for (const jobs of [[], [job({ name: 'other' })],
    [job({ conclusion: 'failure' })], [job({ head_sha: 'b'.repeat(40) })]]) {
    await assert.rejects(verify([run()], jobs), /verification job did not pass/);
  }
});
test('newest CI result must pass; cannot use an older successful run', async () => {
  const older = run({ id: 40, created_at: '2026-11-12T00:00:00Z' });
  const newer = run({ id: 41, status: 'completed', conclusion: 'failure' });
  await assert.rejects(verify([older, newer], [job()]), /CI has not passed/);
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
