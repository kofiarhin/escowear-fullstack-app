'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decide } = require('../deploy-gate.cjs');

const SHA = 'a'.repeat(40);
const NEWER = 'c'.repeat(40);
const REPO = 'kofiarhin/escowear-fullstack-app';
const TOKEN = 'test-token';

function run(workflow, id, overrides = {}) {
  return {
    id, head_sha: SHA, event: 'push', head_branch: 'master',
    path: `.github/workflows/${workflow}`, status: 'completed', conclusion: 'success',
    created_at: '2026-11-15T00:00:00Z', run_attempt: 1, ...overrides,
  };
}
function mockApi({ tip = SHA, ci = {}, css = {}, cssJobName = 'css-lint' } = {}) {
  return async path => {
    if (path.endsWith('/branches/master')) return { commit: { sha: tip } };
    if (path.includes('/workflows/ci.yml/')) return { workflow_runs: [run('ci.yml', 41, ci)] };
    if (path.includes('/workflows/css-lint.yml/')) return { workflow_runs: [run('css-lint.yml', 51, css)] };
    if (path.includes('/runs/41/jobs')) return { jobs: [{ name: 'verify', conclusion: 'success', head_sha: SHA }] };
    if (path.includes('/runs/51/jobs')) return { jobs: [{ name: cssJobName, conclusion: 'success', head_sha: SHA }] };
    throw new Error(`unexpected path ${path}`);
  };
}
const gate = options => decide(REPO, SHA, TOKEN, mockApi(options));

test('deploys only when the commit is the master tip and both checks passed', async () => {
  assert.equal((await gate()).decision, 'deploy');
});
test('waits while the other required workflow is still running', async () => {
  assert.equal((await gate({ css: { status: 'in_progress', conclusion: null } })).decision, 'wait');
  assert.equal((await gate({ ci: { status: 'queued', conclusion: null } })).decision, 'wait');
});
test('rejects an outdated commit even when its checks passed', async () => {
  const result = await gate({ tip: NEWER });
  assert.equal(result.decision, 'superseded');
  assert.match(result.message, /outdated/);
});
test('blocks when either required check failed', async () => {
  assert.equal((await gate({ ci: { conclusion: 'failure' } })).decision, 'blocked');
  assert.equal((await gate({ css: { conclusion: 'cancelled' } })).decision, 'blocked');
  assert.equal((await gate({ cssJobName: 'other' })).decision, 'blocked');
});
test('fails closed when the master tip cannot be read', async () => {
  const api = async path => (path.endsWith('/branches/master') ? {} : { workflow_runs: [] });
  await assert.rejects(decide(REPO, SHA, TOKEN, api), /master branch tip/);
});
test('missing token fails before any API call', async () => {
  let called = false;
  await assert.rejects(decide(REPO, SHA, '', async () => { called = true; }), /ESCOWEAR_GITHUB_TOKEN/);
  assert.equal(called, false);
});
