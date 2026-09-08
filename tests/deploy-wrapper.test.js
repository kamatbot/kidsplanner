const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise the real entrypoint against a harmless packer; never read release secrets or upload.
function runWrapper(t, args = []) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fametc-deploy-wrapper-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const repo = path.join(scratch, 'project with spaces');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  const wrapper = path.join(repo, 'scripts', 'deploy-hostinger.sh');
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'deploy-hostinger.sh'), wrapper);
  const capture = path.join(scratch, 'packer-arguments');
  fs.writeFileSync(path.join(repo, 'scripts', 'pack-deploy.sh'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$CAPTURE_FILE"\n: > "$1"\n');
  const result = spawnSync('bash', [wrapper, ...args], {
    cwd: scratch,
    env: { ...process.env, CAPTURE_FILE: capture },
    encoding: 'utf8',
  });
  return { result, scratch, repo, arguments: fs.existsSync(capture) ? fs.readFileSync(capture, 'utf8').trimEnd().split('\n') : null };
}

test('legacy deployment entrypoint packages once into the sibling Builds directory', t => {
  const run = runWrapper(t);
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.arguments.length, 1);
  assert.equal(path.resolve(path.dirname(run.arguments[0])), path.join(run.scratch, 'Builds'));
  assert.ok(fs.existsSync(run.arguments[0]));
  assert.match(path.basename(run.arguments[0]), /^fametc-hostinger-\d{8}-\d{6}\.zip$/);
  assert.match(run.result.stderr, /package only; no upload/);
});

test('legacy entrypoint forwards an explicit output path as one argument', t => {
  const run = runWrapper(t, ['release output/archive.tar.gz']);
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.deepEqual(run.arguments, ['release output/archive.tar.gz']);
  assert.ok(fs.existsSync(path.join(run.repo, run.arguments[0])));
});

test('ambiguous legacy arguments stop before invoking the packer', t => {
  const run = runWrapper(t, ['one.zip', 'two.zip']);
  assert.equal(run.result.status, 2);
  assert.equal(run.arguments, null);
});
