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

function fixture() {
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
  write(path.join(bin, 'docker'), `#!/bin/sh
echo "$* token=\${ESCOWEAR_GITHUB_TOKEN:+leaked} file=\${ESCOWEAR_GITHUB_TOKEN_FILE:+leaked}" >> ${dockerLog}
case "$*" in *"config --services"*) echo web ;; esac
exit 0
`, 0o755);

  execFileSync(realGit, ['init', '--quiet', '--bare', '--initial-branch=master', origin]);
  execFileSync(realGit, ['clone', '--quiet', origin, repo], { stdio: 'ignore' });
  git(repo, 'switch', '--quiet', '-c', 'master');
  write(path.join(repo, 'scripts/deploy.sh'), fs.readFileSync(path.join(ROOT, 'scripts/deploy.sh'), 'utf8'), 0o755);
  write(path.join(repo, 'scripts/deploy.conf'), fs.readFileSync(path.join(ROOT, 'scripts/deploy.conf'), 'utf8')
    .replace(/^DEPLOY_DOCKER=.*$/m, `DEPLOY_DOCKER="${path.join(bin, 'docker')}"`));
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
