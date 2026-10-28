/**
 * Checks the actual GitHub Actions deployment contract before merging.
 * Extra shell test cases run on Unix CI; the YAML checks run on every OS.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const root = new URL('../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const deploy = YAML.parse(read('.github/workflows/deploy.yml'));
const quality = YAML.parse(read('.github/workflows/quality.yml'));
const flow = deploy.on.workflow_run;

assert.equal(quality.name, 'Quality', 'Upstream CI workflow name must match the deployment trigger');
assert(quality.on.push?.branches.includes('main'), 'Quality must check main after merge');
assert.deepEqual(flow.workflows, ['Quality']);
assert.deepEqual(flow.types, ['completed']);
assert.deepEqual(flow.branches, ['main']);
assert(!('push' in deploy.on), 'Direct push deployments would bypass Quality');
assert(!('workflow_dispatch' in deploy.on), 'Manual deployment cannot bypass Quality');

const build = deploy.jobs.build;
const deployJob = deploy.jobs.deploy;
for (const guard of [
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_branch == 'main'",
]) {
  assert(build.if.includes(guard), 'Missing safety predicate: ' + guard);
  assert(deploy.concurrency.group.includes(guard), 'Invalid runs should not cancel a valid deploy: ' + guard);
}
const checkout = build.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
assert(checkout && checkout.with.ref === '${{ github.event.workflow_run.head_sha }}',
  'Checkout must pin the exact SHA verified by Quality, not the latest default branch');
const check = build.steps.find((step) => step.id === 'verify');
assert(check?.run?.includes('git ls-remote origin refs/heads/main') &&
  check.run.includes('scripts/deploy-gate.sh'),
  'Build must compare the tested SHA with the current main ref');
assert.equal(build.outputs.current, '${{ steps.verify.outputs.current }}');
const action = build.steps.find((step) => step.uses?.startsWith('withastro/action@'));
assert.equal(action.if, "steps.verify.outputs.current == 'true'");
assert.equal(deployJob.needs, 'build');
assert.equal(deployJob.if, "needs.build.outputs.current == 'true'");
assert.equal(deployJob.permissions.pages, 'write');
assert.equal(deployJob.permissions['id-token'], 'write');
const lastCheck = deployJob.steps.find((step) => step.id === 'verify');
assert(lastCheck?.run?.includes("gh api") && lastCheck.run.includes('VERIFIED_SHA'),
  'Deployment must recheck main after the build completes');
const publisher = deployJob.steps.find((step) => step.uses?.startsWith('actions/deploy-pages@'));
assert.equal(publisher.if, "steps.verify.outputs.current == 'true'");
assert.equal(deploy.permissions.contents, 'read');
console.log('✓ Pages deploy is gated by successful main Quality and exact tested SHA');
console.log('✓ A stale or PR completion cannot replace the current published site');
console.log('✓ Deployment rechecks main before publishing; writes are limited to deploy job');

if (process.platform !== 'win32') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-gate-'));
  const shaA = 'a'.repeat(40);
  const shaB = 'b'.repeat(40);
  const cases = [
    [shaA, shaA, 'true'],
    [shaB, shaA, 'false'],
    [shaA, shaB, 'false'],
    ['invalid', 'invalid', 'false'],
    ['', shaA, 'false'],
  ];
  try {
    for (let i = 0; i < cases.length; i++) {
      const [current, expected, value] = cases[i];
      const output = path.join(tmp, 'out-' + i);
      fs.writeFileSync(output, '');
      const processResult = spawnSync('bash', ['scripts/deploy-gate.sh', current, expected], {
        cwd: new URL('../', import.meta.url).pathname,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output },
      });
      assert.equal(processResult.status, 0, processResult.stderr || processResult.stdout);
      assert.equal(fs.readFileSync(output, 'utf8').trim(), 'current=' + value,
        'Mismatch in exact-SHA gate for case ' + i);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('✓ Matching, stale, malformed and missing commit SHA cases are tested');
}
console.log('\nOK  GitHub Pages release gate contract');
