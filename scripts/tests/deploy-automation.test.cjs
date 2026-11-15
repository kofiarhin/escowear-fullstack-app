'use strict';
// Exercises the Beast SSH forced command and sudo wrapper against a throwaway Git
// origin and a stub deploy.sh. Only hard-coded paths are rewritten; no sudo, Docker
// or network access is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const AUTOMATION = path.join(__dirname, '../../deploy/beast/automation');
const TOKEN = 'test-token-never-printed';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'escowear-deploy-test-'));
}
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { cwd, encoding: 'utf8' }).trim();
}

function sshEntry() {
  const dir = tempDir();
  const stub = path.join(dir, 'stub-run');
  fs.writeFileSync(stub, '#!/bin/sh\necho "RUN $*"\n', { mode: 0o755 });
  const script = path.join(dir, 'entry');
  const source = fs.readFileSync(path.join(AUTOMATION, 'escowear-deploy-ssh'), 'utf8')
    .replace('sudo -n -u ubuntu /usr/local/sbin/escowear-deploy-run', stub);
  fs.writeFileSync(script, source, { mode: 0o755 });
  return request => spawnSync('sh', [script], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...(request === undefined ? {} : { SSH_ORIGINAL_COMMAND: request }) },
  });
}

const STUB_DEPLOY = `#!/usr/bin/env bash
echo "[deploy] stub args=$* expected=\${DEPLOY_EXPECTED_SHA:-none} token=\${ESCOWEAR_GITHUB_TOKEN:+leaked} file=\${ESCOWEAR_GITHUB_TOKEN_FILE:-none}"
echo "noise that must stay in the private log"
exit "\${STUB_EXIT:-0}"
`;

function fixture() {
  const root = tempDir();
  const base = path.join(root, 'base');
  fs.mkdirSync(base, { mode: 0o700 });
  const origin = path.join(root, 'origin.git');
  const repo = path.join(base, 'escowear');
  const state = path.join(base, 'automation');
  const tokenFile = path.join(base, 'github-actions-read.token');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=master', origin]);
  execFileSync('git', ['clone', '--quiet', origin, repo], { stdio: 'ignore' });
  git(repo, 'switch', '--quiet', '-c', 'master');
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.writeFileSync(path.join(repo, 'scripts/deploy.sh'), STUB_DEPLOY);
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'two');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'push', '--quiet', 'origin', 'master');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });

  const wrapper = path.join(root, 'run');
  const user = os.userInfo().username;
  const source = fs.readFileSync(path.join(AUTOMATION, 'escowear-deploy-run'), 'utf8')
    .replace(/^BASE=.*$/m, `BASE=${base}`)
    .replace(/^RUN_USER=.*$/m, `RUN_USER=${user}`);
  fs.writeFileSync(wrapper, source, { mode: 0o755 });
  const run = (args, env = {}) => spawnSync('bash', [wrapper, ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root, ...env },
  });
  return { root, base, repo, state, tokenFile, first, tip, run };
}

test('SSH entry allows only check and deploy <40 lowercase hex>', () => {
  const entry = sshEntry();
  assert.equal(entry('check').stdout.trim(), 'RUN check');
  const sha = 'ab'.repeat(20);
  assert.equal(entry(`deploy ${sha}`).stdout.trim(), `RUN deploy ${sha}`);
  for (const request of [undefined, '', 'bash', 'check extra', `deploy ${sha.toUpperCase()}`,
    `deploy ${sha.slice(1)}`, `deploy ${sha}0`, `deploy  ${sha}`, `deploy ${sha};id`,
    `deploy ${sha} --rollback`, 'check\nid', `deploy $(id)`, 'deploy --rollback']) {
    const result = entry(request);
    assert.equal(result.status, 64, `should refuse ${JSON.stringify(request)}`);
    assert.doesNotMatch(result.stdout, /RUN/);
  }
});

test('deploys the current origin/master tip, filtering output and passing the expected SHA', () => {
  const f = fixture();
  const result = f.run(['deploy', f.tip]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`stub args= expected=${f.tip} token= file=${f.tokenFile}`));
  assert.doesNotMatch(result.stdout, /noise/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN));
  const logs = fs.readdirSync(path.join(f.state, 'logs'));
  assert.equal(logs.length, 1);
  assert.match(fs.readFileSync(path.join(f.state, 'logs', logs[0]), 'utf8'), /noise/);
  assert.equal(fs.statSync(path.join(f.state, 'logs', logs[0])).mode & 0o077, 0);
});

test('refuses an outdated commit before running deploy.sh', () => {
  const f = fixture();
  const result = f.run(['deploy', f.first]);
  assert.equal(result.status, 65);
  assert.match(result.stderr, /outdated commit refused/);
  assert.doesNotMatch(result.stdout, /stub/);
});

test('check mode runs the read-only preflight without the token', () => {
  const f = fixture();
  fs.rmSync(f.tokenFile);
  const result = f.run(['check']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stub args=--check expected=none token= file=none$/m);
});

test('refuses dirty checkouts and local commits that GitHub does not have', () => {
  const dirty = fixture();
  fs.writeFileSync(path.join(dirty.repo, 'scripts/deploy.sh'), '#!/bin/sh\necho "[deploy] tampered"\n');
  let result = dirty.run(['deploy', dirty.tip]);
  assert.equal(result.status, 66);
  assert.match(result.stderr, /uncommitted changes/);

  const local = fixture();
  git(local.repo, 'commit', '--quiet', '--allow-empty', '-m', 'local only');
  result = local.run(['check']);
  assert.equal(result.status, 66);
  assert.match(result.stderr, /not on GitHub/);
});

test('never runs repository-local Git hooks', () => {
  const f = fixture();
  const marker = path.join(f.root, 'hook-ran');
  fs.writeFileSync(path.join(f.repo, '.git/hooks/reference-transaction'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
  // A newer origin commit makes the wrapper's fetch update refs, which fires the hook unless disabled.
  const other = path.join(f.root, 'other');
  execFileSync('git', ['clone', '--quiet', path.join(f.root, 'origin.git'), other], { stdio: 'ignore' });
  git(other, 'commit', '--quiet', '--allow-empty', '-m', 'newer');
  git(other, 'push', '--quiet', 'origin', 'master');
  assert.equal(f.run(['check']).status, 0);
  assert.equal(fs.existsSync(marker), false);
});

test('requires a private, non-empty token file for deploys', () => {
  const f = fixture();
  fs.chmodSync(f.tokenFile, 0o644);
  assert.equal(f.run(['deploy', f.tip]).status, 78);
  fs.chmodSync(f.tokenFile, 0o600);
  fs.writeFileSync(f.tokenFile, '');
  assert.equal(f.run(['deploy', f.tip]).status, 78);
});

test('propagates deploy.sh failure and points to the private log', () => {
  const f = fixture();
  const result = f.run(['deploy', f.tip], { STUB_EXIT: '3' });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /FAILED with exit 3; see .*\.log on Beast/);
});

test('refuses overlapping requests while another holds the lock', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.state, 'logs'), { recursive: true });
  const lock = path.join(f.state, 'run.lock');
  const result = spawnSync('flock', [lock, 'bash', '-c', `"$0" check`, path.join(f.root, 'run')], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: f.root },
  });
  assert.equal(result.status, 75);
  assert.match(result.stderr, /another deployment request is running/);
});

test('refuses to run from a checkout others can enter or replace', () => {
  const open = fixture();
  fs.chmodSync(open.base, 0o750);
  let result = open.run(['check']);
  assert.equal(result.status, 66);
  assert.match(result.stderr, /mode 700/);

  const parent = fixture();
  fs.chmodSync(parent.root, 0o777);
  result = parent.run(['check']);
  assert.equal(result.status, 66);
  assert.doesNotMatch(result.stdout, /stub/);
});

test('rejects malformed wrapper arguments', () => {
  const f = fixture();
  for (const args of [[], ['deploy'], ['deploy', 'abc'], ['check', 'x'], ['--rollback'], ['deploy', f.tip, 'x']]) {
    assert.equal(f.run(args).status, 64, `should refuse ${args.join(' ')}`);
  }
});
