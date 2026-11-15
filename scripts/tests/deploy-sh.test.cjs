'use strict';
// Runs the real scripts/deploy.sh against a throwaway Git origin with stub Docker and
// a stub CI check, up to the point where it would need a live container. Verifies
// the exact-SHA fast-forward and that only the CI check ever receives the token.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '../..');
const TOKEN = 'test-token-never-printed';
const REMOTE = 'https://github.com/kofiarhin/escowear-fullstack-app';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { cwd, encoding: 'utf8' }).trim();
}
function write(file, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode });
}

function fixture({ productionRoot = '', fullDocker = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'escowear-deploysh-test-'));
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  // deploy.sh insists origin is the GitHub repository; the shim reports that URL only.
  write(path.join(bin, 'git'), `#!/bin/sh
[ "$1 $2 $3" = "remote get-url origin" ] && { echo ${REMOTE}.git; exit 0; }
exec ${realGit} "$@"
`, 0o755);
  // fullDocker simulates a running service so deploy.sh reaches the image checks. Its
  // "tag" fails on purpose, so a test can never reach the container swap or health URLs.
  write(path.join(bin, 'docker'), `#!/bin/sh
echo "$* token=\${ESCOWEAR_GITHUB_TOKEN:+leaked} file=\${ESCOWEAR_GITHUB_TOKEN_FILE:+leaked}" >> ${dockerLog}
case "$*" in *"config --services"*) echo web; exit 0 ;; esac
[ "${fullDocker}" = true ] || exit 0
case "$*" in
  *"ps -aq web"*) echo cid123 ;;
  *"com.docker.compose.project"*) echo escowear ;;
  *"com.docker.compose.service"*) echo web ;;
  *"{{.State.Running}}"*) echo true ;;
  "inspect -f {{.Image}} cid123") echo sha256:0123456789abcdef ;;
  "image inspect"*) exit 1 ;;
  *"config --format json"*) echo '{"services":{"web":{"environment":{}}}}' ;;
  *"find /app"*) exit "\${STUB_PERMISSION_EXIT:-0}" ;;
  tag*) exit 99 ;;
esac
exit 0
`, 0o755);

  execFileSync(realGit, ['init', '--quiet', '--bare', '--initial-branch=master', origin]);
  execFileSync(realGit, ['clone', '--quiet', origin, repo], { stdio: 'ignore' });
  git(repo, 'switch', '--quiet', '-c', 'master');
  write(path.join(repo, 'scripts/deploy.sh'), fs.readFileSync(path.join(ROOT, 'scripts/deploy.sh'), 'utf8'), 0o755);
  write(path.join(repo, 'scripts/deploy.conf'), fs.readFileSync(path.join(ROOT, 'scripts/deploy.conf'), 'utf8')
    .replace(/^DEPLOY_DOCKER=.*$/m, `DEPLOY_DOCKER="${path.join(bin, 'docker')}"`)
    .replace(/^DEPLOY_PRODUCTION_ROOT=.*$/m, `DEPLOY_PRODUCTION_ROOT=${productionRoot}`));
  write(path.join(repo, 'scripts/check-ci.cjs'),
    "console.log(`[deploy] ci-stub token=${process.env.ESCOWEAR_GITHUB_TOKEN === 'test-token-never-printed' ? 'ok' : 'missing'} " +
    "file=${process.env.ESCOWEAR_GITHUB_TOKEN_FILE ? 'leaked' : 'none'} sha=${process.argv[3]}`);\n");
  write(path.join(repo, 'compose.yaml'), 'services: {}\n');
  write(path.join(repo, '.gitignore'), '.env\n/.deploy-state/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'push', '--quiet', 'origin', 'master');
  // Two newer commits land on GitHub while the Beast checkout is still at "one".
  const other = path.join(root, 'other');
  execFileSync(realGit, ['clone', '--quiet', origin, other], { stdio: 'ignore' });
  git(other, 'commit', '--quiet', '--allow-empty', '-m', 'two');
  const second = git(other, 'rev-parse', 'HEAD');
  git(other, 'commit', '--quiet', '--allow-empty', '-m', 'three');
  const tip = git(other, 'rev-parse', 'HEAD');
  git(other, 'push', '--quiet', 'origin', 'master');
  write(path.join(repo, '.env'), 'PLACEHOLDER=1\n', 0o600);
  const tokenFile = path.join(root, 'token');
  write(tokenFile, `${TOKEN}\n`, 0o600);

  const run = env => spawnSync('bash', [path.join(repo, 'scripts/deploy.sh')], {
    cwd: repo, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, ...env },
  });
  const dockerCalls = () => fs.readFileSync(dockerLog, 'utf8');
  return { repo, first, second, tip, tokenFile, run, dockerCalls };
}

test('automated deploy fast-forwards to the requested tip; only the CI check gets the token', () => {
  const f = fixture();
  const result = f.run({ DEPLOY_EXPECTED_SHA: f.tip, ESCOWEAR_GITHUB_TOKEN_FILE: f.tokenFile });
  assert.match(result.stdout, new RegExp(`ci-stub token=ok file=none sha=${f.tip}`));
  // Stops at the live-container check, which the fixture deliberately lacks.
  assert.match(result.stderr, /No existing container/);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.tip);
  assert.match(f.dockerCalls(), /compose .* ps -aq web/);
  assert.doesNotMatch(f.dockerCalls(), /leaked/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN));
});

test('an outdated request is refused without moving the checkout', () => {
  const f = fixture();
  const result = f.run({ DEPLOY_EXPECTED_SHA: f.second, ESCOWEAR_GITHUB_TOKEN_FILE: f.tokenFile });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outdated request refused/);
  assert.doesNotMatch(result.stdout, /ci-stub/);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.first);
});

test('manual deploy with an exported token still works and keeps it from Docker', () => {
  const f = fixture();
  const result = f.run({ ESCOWEAR_GITHUB_TOKEN: TOKEN });
  assert.match(result.stdout, /ci-stub token=ok file=none/);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.tip);
  assert.doesNotMatch(f.dockerCalls(), /leaked/);
});

test('rejects a malformed expected commit', () => {
  const f = fixture();
  const result = f.run({ DEPLOY_EXPECTED_SHA: 'HEAD~1' });
  assert.match(result.stderr, /Invalid expected commit/);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.first);
});

test('refuses to deploy from any checkout other than the production one once it exists', () => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'escowear-prod-root-'));
  const f = fixture({ productionRoot: elsewhere });
  const result = f.run({ ESCOWEAR_GITHUB_TOKEN: TOKEN });
  assert.match(result.stderr, /Production checkout is .*; run deploys from there/);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.first);
  assert.equal(fs.existsSync(path.join(f.repo, '.deploy-state')), false);
});

test('deploy refuses before preserving or swapping when runtime files fail the permission check', () => {
  const f = fixture({ fullDocker: true });
  const result = f.run({ ESCOWEAR_GITHUB_TOKEN: TOKEN, STUB_PERMISSION_EXIT: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Runtime files are unreadable or writable by the app user/);
  const calls = f.dockerCalls();
  // Runs as the image's own (node) user: no --user override.
  assert.match(calls, /run --rm --network none --entrypoint sh escowear:release-[0-9a-f]{12} -c out="\$\(find \/app /);
  assert.doesNotMatch(calls, /--user/);
  assert.ok(calls.indexOf('node --test') < calls.indexOf('find /app'), 'permission check runs after server tests');
  assert.doesNotMatch(calls, /^tag |up -d/m);
});

test('deploy continues past the permission check when runtime files are correct', () => {
  const f = fixture({ fullDocker: true });
  const result = f.run({ ESCOWEAR_GITHUB_TOKEN: TOKEN, STUB_PERMISSION_EXIT: '0' });
  // The stub's "tag" fails deliberately, so the run stops right after the check.
  assert.match(result.stdout, /Checking runtime file permissions/);
  assert.match(result.stdout, /Preserving previous image/);
  assert.match(f.dockerCalls(), /^tag sha256:0123456789abcdef escowear:rollback-/m);
  assert.doesNotMatch(f.dockerCalls(), /up -d/);
});

// Runs the real DEPLOY_PERMISSION_CHECK_COMMAND from deploy.conf against throwaway trees,
// with /app rewritten to the tree. Owner permissions apply to the test user, so every
// failure mode is observable without root (root would bypass the checks).
const PERMISSION_CHECK = execFileSync('bash', ['-c', 'source "$1"; printf %s "$DEPLOY_PERMISSION_CHECK_COMMAND"', '_',
  path.join(ROOT, 'scripts/deploy.conf')], { encoding: 'utf8' });

function runtimeTree() {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'escowear-perm-'));
  write(path.join(app, 'server/server.js'), 'ok\n', 0o444);
  write(path.join(app, 'client/src/policies/review.json'), '{}\n', 0o444);
  write(path.join(app, 'data/payment-proofs/proof.png'), 'x', 0o600);
  return app;
}
// Directories become read-only last, so files can still be created above.
function lockDirs(app) {
  for (const dir of ['server', 'client/src/policies', 'client/src', 'client', '.']) {
    fs.chmodSync(path.join(app, dir), 0o555);
  }
}
function check(app) {
  const command = PERMISSION_CHECK.replaceAll('/app', app);
  return spawnSync('sh', ['-c', command], { encoding: 'utf8' }).status;
}
function cleanup(app) {
  execFileSync('chmod', ['-R', 'u+rwx', app]);
  fs.rmSync(app, { recursive: true, force: true });
}

test('permission check passes a readable, traversable, read-only tree and ignores /app/data', { skip: process.getuid() === 0 }, t => {
  const app = runtimeTree();
  t.after(() => cleanup(app));
  lockDirs(app);
  assert.equal(check(app), 0);
});

test('permission check fails on unreadable files, untraversable directories and writable paths', { skip: process.getuid() === 0 }, t => {
  const cases = {
    'unreadable file (the 3a10cfe failure)': app => fs.chmodSync(path.join(app, 'client/src/policies/review.json'), 0o000),
    'directory readable but not traversable': app => fs.chmodSync(path.join(app, 'client/src/policies'), 0o444),
    'directory not listable': app => fs.chmodSync(path.join(app, 'client/src/policies'), 0o111),
    'writable file': app => fs.chmodSync(path.join(app, 'server/server.js'), 0o644),
  };
  for (const [name, breakTree] of Object.entries(cases)) {
    const app = runtimeTree();
    t.after(() => cleanup(app));
    lockDirs(app);
    breakTree(app);
    assert.notEqual(check(app), 0, `should fail: ${name}`);
  }
});
