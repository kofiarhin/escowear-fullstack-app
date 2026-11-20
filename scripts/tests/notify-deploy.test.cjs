'use strict';
// Telegram deploy alerts: which job results alert, the message content, and that a
// Telegram problem never fails the run or prints the token. Offline: fetch is stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { outcome, message, main } = require('../notify-deploy.cjs');

const SHA = '0123456789abcdef0123456789abcdef01234567';
const TOKEN = '123456:test-bot-token-never-printed';
const CHAT = '-1009876543210';
const RUN_URL = 'https://github.com/kofiarhin/escowear-fullstack-app/actions/runs/42';
const NOW = () => new Date('2026-11-20T01:02:03.000Z');

function env(overrides = {}) {
  return {
    TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, SHA, RUN_URL,
    GATE_RESULT: 'success', PUBLISH_RESULT: 'success', DEPLOY_RESULT: 'success', DEPLOYED: 'true',
    ...overrides,
  };
}
function recorder(response = { ok: true, status: 200, json: async () => ({ ok: true }) }) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, request };
}
function logs() {
  const lines = [];
  return { lines, log: line => lines.push(line) };
}

test('maps job results to one alert, or none when nothing was attempted', () => {
  const cases = [
    [{ gate: 'success', publish: 'success', deploy: 'success', deployed: 'true' }, { status: 'success', stage: 'deployment' }],
    [{ gate: 'success', publish: 'failure', deploy: 'skipped', deployed: '' }, { status: 'failure', stage: 'image publishing' }],
    [{ gate: 'success', publish: 'success', deploy: 'failure', deployed: 'false' }, { status: 'failure', stage: 'deployment' }],
    [{ gate: 'failure', publish: 'skipped', deploy: 'skipped', deployed: '' }, { status: 'failure', stage: 'deploy gate' }],
    [{ gate: 'success', publish: 'cancelled', deploy: 'skipped', deployed: '' }, { status: 'cancelled', stage: 'image publishing' }],
    [{ gate: 'success', publish: 'success', deploy: 'cancelled', deployed: '' }, { status: 'cancelled', stage: 'deployment' }],
    // The deploy job skipped Beast because master moved on while publishing (superseded).
    [{ gate: 'success', publish: 'success', deploy: 'success', deployed: 'false' }, null],
    // The gate decided not to deploy (wait, superseded, blocked).
    [{ gate: 'success', publish: 'skipped', deploy: 'skipped', deployed: '' }, null],
  ];
  for (const [results, expected] of cases) assert.deepEqual(outcome(results), expected, JSON.stringify(results));
});

test('a cancelled run whose commit master has moved past sends nothing; failures still alert', () => {
  const base = { gate: 'success', publish: 'success', deployed: '', superseded: true };
  assert.equal(outcome({ ...base, deploy: 'cancelled' }), null);
  assert.equal(outcome({ ...base, publish: 'cancelled', deploy: 'skipped' }), null);
  assert.deepEqual(outcome({ ...base, deploy: 'failure' }), { status: 'failure', stage: 'deployment' });
  assert.deepEqual(outcome({ ...base, superseded: false, deploy: 'cancelled' }), { status: 'cancelled', stage: 'deployment' });
});

test('deployment failure and cancellation alerts never claim a result Beast may not have reached', async () => {
  const { calls, request } = recorder();
  await main(env({ DEPLOY_RESULT: 'cancelled', DEPLOYED: '' }), { request, now: NOW, log() {} });
  await main(env({ DEPLOY_RESULT: 'cancelled', DEPLOYED: '', SUPERSEDED: 'true' }), { request, now: NOW, log() {} });
  assert.equal(calls.length, 1, 'superseded cancellation is silent');
  assert.match(calls[0].body.text, /^⚠️ ESCOWEAR production deployment CANCELLED\nStatus: CANCELLED at deployment\n/);
  assert.match(calls[0].body.text, /Beast may still be finishing this release\. Check the Beast deploy log/);
});

test('success alert carries status, full commit SHA, timestamp and run URL', async () => {
  const { calls, request } = recorder();
  const { lines, log } = logs();
  assert.equal(await main(env(), { request, now: NOW, log }), 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].body.chat_id, CHAT);
  assert.equal(calls[0].body.text, [
    '✅ ESCOWEAR production deployment succeeded',
    'Status: SUCCESS',
    `Commit: ${SHA}`,
    'Time: 2026-11-20T01:02:03.000Z',
    `Run: ${RUN_URL}`,
  ].join('\n'));
  assert.deepEqual(lines, ['::notice::Telegram alert sent: success']);
});

test('failure alerts name the failed stage and the production impact', async () => {
  const { calls, request } = recorder();
  await main(env({ PUBLISH_RESULT: 'failure', DEPLOY_RESULT: 'skipped', DEPLOYED: '' }), { request, now: NOW, log() {} });
  await main(env({ DEPLOY_RESULT: 'failure', DEPLOYED: 'false' }), { request, now: NOW, log() {} });
  const [publish, deploy] = calls.map(call => call.body.text);
  assert.match(publish, /^❌ ESCOWEAR production deployment FAILED\nStatus: FAILURE at image publishing\n/);
  assert.match(publish, /Nothing was deployed; production is unchanged\.$/);
  assert.match(deploy, /Status: FAILURE at deployment\n/);
  assert.match(deploy, /or the connection dropped\. Check the Beast deploy log before acting\.$/);
  for (const text of [publish, deploy]) {
    assert.match(text, new RegExp(`Commit: ${SHA}\nTime: 2026-11-20T01:02:03.000Z\nRun: ${RUN_URL.replace(/[/.]/g, '\\$&')}`));
  }
});

test('sends nothing when no deployment was attempted', async () => {
  const { calls, request } = recorder();
  assert.equal(await main(env({ DEPLOYED: 'false' }), { request, now: NOW, log() {} }), 'none');
  assert.equal(calls.length, 0);
});

test('a missing secret is a warning, not a failure', async () => {
  const { calls, request } = recorder();
  const { lines, log } = logs();
  assert.equal(await main(env({ TELEGRAM_CHAT_ID: '' }), { request, now: NOW, log }), 'unconfigured');
  assert.equal(calls.length, 0);
  assert.match(lines[0], /^::warning::TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured/);
});

test('Telegram errors become a redacted warning and never throw', async () => {
  const failures = [
    { ok: false, status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) },
    { ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } },
    new Error(`connect ETIMEDOUT https://api.telegram.org/bot${TOKEN}/sendMessage chat ${CHAT}`),
  ];
  for (const failure of failures) {
    const { request } = recorder(failure);
    const { lines, log } = logs();
    assert.equal(await main(env({ DEPLOY_RESULT: 'failure' }), { request, now: NOW, log }), 'failed');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^::warning::Telegram alert not sent \(failure\): /);
    assert.doesNotMatch(lines[0], new RegExp(`${TOKEN}|${CHAT}`));
  }
});

test('an invalid SHA is never echoed into the alert', () => {
  const text = message({ status: 'success', stage: 'deployment' }, { sha: 'unknown', runUrl: RUN_URL, timestamp: 'now' });
  assert.match(text, /Commit: unknown/);
});

test('the CLI exits 0 and prints no secret when Telegram is unreachable', () => {
  const script = path.join(__dirname, '../notify-deploy.cjs');
  // A preloaded stub makes fetch fail offline, like an outage would.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escowear-notify-'));
  const preload = path.join(dir, 'fetch-fails.cjs');
  fs.writeFileSync(preload, "globalThis.fetch = async () => { throw new Error('fetch failed'); };\n");
  try {
    const result = spawnSync(process.execPath, ['--require', preload, script], {
      encoding: 'utf8', env: { PATH: process.env.PATH, ...env({ DEPLOY_RESULT: 'failure' }) },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /::warning::Telegram alert not sent \(failure\): fetch failed/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(`${TOKEN}|${CHAT}`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the Deploy workflow runs the alert as a best-effort job after every stage', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  notify:\n'));
  assert.ok(job.length > 1, 'notify job exists');
  assert.match(job, /needs: \[gate, publish, deploy\]/);
  assert.match(job, /always\(\) && github\.event_name == 'workflow_run'/);
  assert.match(job, /continue-on-error: true/);
  assert.match(job, /TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/);
  assert.match(job, /TELEGRAM_CHAT_ID: \$\{\{ secrets\.TELEGRAM_CHAT_ID \}\}/);
  assert.match(job, /run: node scripts\/notify-deploy\.cjs/);
  assert.match(job, /needs\.gate\.outputs\.decision == 'deploy' \|\| needs\.gate\.result == 'failure' \|\| needs\.gate\.result == 'cancelled'/);
  // The superseded check is best effort too and feeds the alert step.
  assert.match(job, /id: tip\n {8}if: .*needs\.deploy\.result == 'cancelled'\n {8}continue-on-error: true\n/);
  assert.match(job, /run: node scripts\/deploy-gate\.cjs "\$GITHUB_REPOSITORY" "\$SHA"/);
  assert.match(job, /SUPERSEDED: \$\{\{ steps\.tip\.outputs\.decision == 'superseded' \}\}/);
  // Secrets reach only the alert step, never the shell command line.
  assert.doesNotMatch(job, /run: .*secrets\./);
  assert.match(workflow, /deployed: \$\{\{ steps\.beast\.outcome == 'success' \}\}/);
  assert.match(workflow, /- name: Run on Beast\n {8}id: beast\n/);
});
