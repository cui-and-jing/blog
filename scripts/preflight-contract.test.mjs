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
    label: '内容日期时区一致性',
    file: 'scripts/content-dates.test.mjs',
    npm: 'dates:check',
    previous: "run('构建'",
    next: "run('体积预算'",
  },
  {
    label: '样式变量解析契约',
    file: 'scripts/css-vars.test.mjs',
    npm: 'css:vars:check',
    previous: "run('系列共现标签去重'",
    next: "run('字体子集校验'",
  },
  {
    label: '部署发布门禁',
    file: 'scripts/deploy-gate.test.mjs',
    npm: 'deploy:check',
    previous: "run('字体子集校验'",
    next: "run('类型检查'",
  },
  {
    label: '阅读设置容错',
    file: 'scripts/reading-settings.test.mjs',
    npm: 'settings:check',
    previous: "run('部署发布门禁'",
    next: "run('类型检查'",
  },
  {
    label: '收藏存储容错',
    file: 'scripts/bookmarks.test.mjs',
    npm: 'bookmarks:check',
    previous: "run('阅读设置容错'",
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

assert.throws(() => checkParity(
  preflight.replace("run('阅读设置容错', 'node', ['scripts/reading-settings.test.mjs']);", ''),
  quality,
), /Local preflight missing 阅读设置容错/);
assert.throws(() => checkParity(
  preflight,
  quality.replace('run: npm run settings:check', 'run: npm run check'),
), /CI missing settings:check/);

assert.throws(() => checkParity(
  preflight.replace("run('收藏存储容错', 'node', ['scripts/bookmarks.test.mjs']);", ''), quality,
), /Local preflight missing 收藏存储容错/);
assert.throws(() => checkParity(
  preflight, quality.replace('run: npm run bookmarks:check', 'run: npm run check'),
), /CI missing bookmarks:check/);

assert.throws(() => checkParity(
  preflight.replace("run('内容日期时区一致性', 'node', ['scripts/content-dates.test.mjs']);", ''), quality,
), /Local preflight missing 内容日期时区一致性/);
assert.throws(() => checkParity(
  preflight, quality.replace('run: npm run dates:check', 'run: npm run check'),
), /CI missing dates:check/);

console.log('✓ Local preflight and CI share dates, release, settings, bookmarks and RSS contracts, with fail-closed regressions');
