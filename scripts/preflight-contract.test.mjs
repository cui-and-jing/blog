/**
 * Keep local `npm run preflight` aligned with CI's release and feed gates.
 * This is a source-level contract, not a duplicate full production build.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const preflight = read('./preflight.mjs');
const quality = read('../.github/workflows/quality.yml');
const packageScripts = JSON.parse(read('../package.json')).scripts;

const contracts = [
  {
    label: '部署发布门禁',
    file: 'scripts/deploy-gate.test.mjs',
    npm: 'deploy:check',
    previous: "run('字体子集校验'",
    next: "run('类型检查'",
  },
  {
    label: 'RSS 全文与永久链接校验',
    file: 'scripts/rss-check.mjs',
    npm: 'rss:check',
    previous: "run('站点地图更新时间与索引规则'",
    next: "run('体积预算'",
  },
];

function checkParity(source, ci) {
  for (const { label, file, npm, previous, next } of contracts) {
    assert.equal(packageScripts[npm], 'node ' + file, npm + ': npm command changed');
    assert.ok(ci.includes('run: npm run ' + npm), 'CI missing ' + npm);
    const call = "run('" + label + "', 'node', ['" + file + "']);";
    const current = source.indexOf(call);
    assert.ok(current >= 0, 'Local preflight missing ' + label);
    assert.equal(source.lastIndexOf(call), current, 'Duplicate local gate: ' + label);
    const earlier = source.indexOf(previous);
    const later = source.indexOf(next);
    assert.ok(earlier >= 0 && earlier < current && current < later,
      label + ' must run between ' + previous + ' and ' + next);
  }
}

checkParity(preflight, quality);
assert.throws(() => checkParity(
  preflight.replace("run('部署发布门禁', 'node', ['scripts/deploy-gate.test.mjs']);", ''),
  quality,
), /Local preflight missing 部署发布门禁/);
assert.throws(() => checkParity(
  preflight.replace("run('RSS 全文与永久链接校验', 'node', ['scripts/rss-check.mjs']);", ''),
  quality,
), /Local preflight missing RSS/);
assert.throws(() => checkParity(
  preflight,
  quality.replace('run: npm run rss:check', 'run: npm run check'),
), /CI missing rss:check/);

console.log('✓ Local preflight and CI share release and RSS contracts, with fail-closed regressions');
