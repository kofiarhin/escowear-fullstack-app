'use strict';
// Runs the real scripts/deploy-cleanup.sh against a fake Docker that keeps an image and
// container store in a JSON file, so each test can see exactly what was removed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '../..');
const id = n => `sha256:${String(n).padStart(64, '0')}`;
const hex12 = n => String(n).padStart(12, 'a');
const release = n => `escowear:release-${hex12(n)}`;
const rollback = n => `escowear:rollback-20261120010203-${hex12(n)}`;
const CURRENT = release(1);
const ROLLBACK = rollback(2);

// Fake Docker CLI: answers only the calls deploy-cleanup.sh makes; anything else fails.
const FAKE_DOCKER = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.FAKE_DOCKER_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const line = args.join(' ');
state.calls.push(line);
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const out = text => { if (text) process.stdout.write(text + '\\n'); };
const done = (code = 0) => { save(); process.exit(code); };
const fail = name => state.fail.includes(name);
if (line.startsWith('image inspect -f {{.Id}} ')) {
  const image = state.images.find(i => i.ref === args[4]);
  if (!image) done(1);
  out(image.id); done();
}
if (args[0] === 'compose' && line.endsWith(' ps -q web')) {
  out(state.containers.filter(c => c.project === 'escowear' && c.state === 'running' && !c.oneoff).map(c => c.id).join('\\n'));
  done();
}
if (line.startsWith('ps -aq --filter label=com.docker.compose.project=escowear')) {
  out(state.containers.filter(c => c.project === 'escowear' && c.service === 'web' && c.state === 'exited').map(c => c.id).join('\\n'));
  done();
}
if (line === 'ps -aq --no-trunc') {
  if (fail('ps')) done(1);
  out(state.containers.map(c => c.id).join('\\n')); done();
}
if (line.startsWith('inspect -f {{index .Config.Labels "com.docker.compose.oneoff"}} ')) {
  const c = state.containers.find(x => x.id === args[3]);
  out(c.oneoff ? 'True' : 'False'); done();
}
if (line.startsWith('inspect -f {{.Image}} ')) {
  if (fail('inspect')) done(1);
  for (const cid of args.slice(3)) out(state.containers.find(c => c.id === cid).image);
  done();
}
if (args[0] === 'rm') {
  state.containers = state.containers.filter(c => c.id !== args[1]); done();
}
if (line === 'image ls --no-trunc --format {{.Repository}}:{{.Tag}} {{.ID}}') {
  if (fail('ls')) done(1);
  out(state.images.map(i => i.ref + ' ' + i.id).join('\\n')); done();
}
if (args[0] === 'image' && args[1] === 'rm') {
  if (fail('rm')) done(1);
  state.images = state.images.filter(i => i.ref !== args[2]); done();
}
process.stderr.write('fake docker: unexpected call ' + line + '\\n');
done(97);
`;

function fixture({ images, containers = [], fail = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escowear-cleanup-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts/deploy-cleanup.sh'), path.join(dir, 'scripts/deploy-cleanup.sh'));
  const docker = path.join(dir, 'docker');
  fs.writeFileSync(docker, FAKE_DOCKER, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'scripts/deploy.conf'), fs.readFileSync(path.join(ROOT, 'scripts/deploy.conf'), 'utf8')
    .replace(/^DEPLOY_DOCKER=.*$/m, `DEPLOY_DOCKER="${docker}"`));
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ images, containers, fail, calls: [] }));
  const run = (args = [CURRENT, ROLLBACK]) => spawnSync('bash', [path.join(dir, 'scripts/deploy-cleanup.sh'), ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, FAKE_DOCKER_STATE: stateFile },
  });
  const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const refs = () => state().images.map(i => i.ref);
  const removed = () => state().calls.filter(c => c.startsWith('image rm ')).map(c => c.slice('image rm '.length));
  return { run, state, refs, removed, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Newest first, like docker image ls: current, three older releases, rollbacks, leftovers
// and other projects' images.
function store() {
  return [
    { ref: CURRENT, id: id(1) },
    { ref: release(2), id: id(2) },
    { ref: release(3), id: id(3) },
    { ref: release(4), id: id(4) },
    { ref: release(5), id: id(5) },
    { ref: ROLLBACK, id: id(2) },
    { ref: rollback(9), id: id(9) },
    { ref: `escowear:test-${hex12(6)}`, id: id(6) },
    { ref: `kofiarhin/escowear:${'b'.repeat(40)}`, id: id(7) },
    { ref: 'escowear:permtest-1', id: id(8) },
    { ref: 'escowear-chmodprobe:latest', id: id(10) },
    { ref: 'devkofi:release-aaaaaaaaaaaa', id: id(11) },
    { ref: 'library/escowear:release-cccccccccccc', id: id(12) },
    { ref: '<none>:<none>', id: id(13) },
  ];
}

test('removes old project images and keeps the live, rollback and newest releases', t => {
  const f = fixture({ images: store(), containers: [{ id: 'c1', image: id(1), project: 'escowear', service: 'web', state: 'running' }] });
  t.after(f.cleanup);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.removed().sort(), [
    release(4), release(5), rollback(9), `escowear:test-${hex12(6)}`, `kofiarhin/escowear:${'b'.repeat(40)}`,
  ].sort());
  for (const kept of [CURRENT, release(2), release(3), ROLLBACK]) assert.ok(f.refs().includes(kept), kept);
  assert.match(result.stdout, /\[deploy\] cleanup: Removed 5 image\(s\)/);
});

test('never touches other names: other projects, manual leftovers, look-alikes, dangling images', t => {
  const f = fixture({ images: store() });
  t.after(f.cleanup);
  assert.equal(f.run().status, 0);
  for (const kept of ['escowear:permtest-1', 'escowear-chmodprobe:latest', 'devkofi:release-aaaaaaaaaaaa',
    'library/escowear:release-cccccccccccc', '<none>:<none>']) {
    assert.ok(f.refs().includes(kept), kept);
    assert.ok(!f.removed().includes(kept), kept);
  }
});

test('keeps any project image a container uses, whichever project or state that container has', t => {
  const f = fixture({
    images: store(),
    containers: [
      { id: 'c1', image: id(1), project: 'escowear', service: 'web', state: 'running' },
      { id: 'c2', image: id(5), project: 'other-project', service: 'api', state: 'running' },
      { id: 'c3', image: id(6), project: 'escowear', service: 'web', state: 'exited', oneoff: true },
    ],
  });
  t.after(f.cleanup);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!f.removed().includes(release(5)), 'used by another project');
  assert.ok(!f.removed().includes(`escowear:test-${hex12(6)}`), 'used by a stopped one-off container');
  assert.match(result.stdout, /Kept escowear:release-aaaaaaaaaaa5 \(live, rollback or used by a container\)/);
  assert.ok(f.removed().includes(release(4)));
});

test('removes only stopped, non-one-off containers of this service', t => {
  const f = fixture({
    images: store(),
    containers: [
      { id: 'c1', image: id(1), project: 'escowear', service: 'web', state: 'running' },
      { id: 'old', image: id(4), project: 'escowear', service: 'web', state: 'exited' },
      { id: 'oneoff', image: id(3), project: 'escowear', service: 'web', state: 'exited', oneoff: true },
      { id: 'other', image: id(12), project: 'other-project', service: 'web', state: 'exited' },
    ],
  });
  t.after(f.cleanup);
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.state().containers.map(c => c.id).sort(), ['c1', 'oneoff', 'other']);
  // Its container is gone, so the old release is no longer in use and goes too.
  assert.ok(f.removed().includes(release(4)));
});

test('fails closed and removes nothing when Docker state cannot be read', t => {
  for (const failing of ['ps', 'inspect', 'ls']) {
    const f = fixture({ images: store(), containers: [{ id: 'c1', image: id(1), project: 'escowear', service: 'web', state: 'running' }], fail: [failing] });
    t.after(f.cleanup);
    const result = f.run();
    assert.notEqual(result.status, 0, failing);
    assert.match(result.stderr, /no images removed/, failing);
    assert.deepEqual(f.removed(), [], failing);
  }
});

test('refuses to run when the live or rollback image is missing or malformed', t => {
  const cases = [
    [[release(42), ROLLBACK], /Live release image not found/],
    [[CURRENT, rollback(42)], /Rollback image not found/],
    [['escowear:latest', ROLLBACK], /Invalid live release image/],
    [[CURRENT, 'escowear:rollback-x'], /Invalid rollback image/],
    [[CURRENT], /Usage/],
  ];
  for (const [args, error] of cases) {
    const f = fixture({ images: store() });
    t.after(f.cleanup);
    const result = f.run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.deepEqual(f.removed(), []);
  }
});

test('a refused removal is logged and cleanup continues', t => {
  const f = fixture({ images: store(), fail: ['rm'] });
  t.after(f.cleanup);
  const result = f.run();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Skipped escowear:release-aaaaaaaaaaa4 \(Docker refused to remove it\)/);
  assert.match(result.stdout, /Removed 0 image\(s\)/);
});

test('--dry-run lists what it would remove and changes nothing', t => {
  const f = fixture({ images: store(), containers: [{ id: 'old', image: id(4), project: 'escowear', service: 'web', state: 'exited' }] });
  t.after(f.cleanup);
  const before = f.state();
  const result = f.run(['--dry-run', CURRENT, ROLLBACK]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would remove escowear:release-aaaaaaaaaaa5/);
  assert.match(result.stdout, /Dry run: would remove 4 image\(s\)/);
  assert.deepEqual(f.state().images, before.images);
  assert.deepEqual(f.state().containers, before.containers);
  assert.ok(!f.state().calls.some(c => /^(rm|image rm) /.test(c)));
});
