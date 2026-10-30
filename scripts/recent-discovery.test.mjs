/**
 * Guard the "最近更新" sidebar against excluding notes or recommending
 * the current article. The built search index is an independent list of
 * published articles and notes; it has the same date granularity as content.
 * Run this after npm run build (CI and local preflight).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { activityDate } from '../src/lib/recent-date.mjs';

const read = (route) => fs.readFileSync(path.resolve('dist', route), 'utf8');
const records = JSON.parse(read('search-index.json')).posts;
assert.ok(Array.isArray(records) && records.length, 'missing published search index');

/* A later revision makes an article recent. Stable sort preserves post-first ties. */
const byNewest = (list) => [...list].sort((a, b) =>
  Date.parse((b.updated ?? b.date).replaceAll('.', '-') + 'T00:00:00Z') -
  Date.parse((a.updated ?? a.date).replaceAll('.', '-') + 'T00:00:00Z')
);
const date = (day) => new Date(day + 'T00:00:00Z');
assert.equal(activityDate({ date: date('2026-10-05'), updated: date('2026-10-29') }).getTime(),
  date('2026-10-29').getTime(), 'a later edit should advance recency');
assert.equal(activityDate({ date: date('2026-10-20'), updated: date('2026-10-01') }).getTime(),
  date('2026-10-20').getTime(), 'an older updated field must not regress publication');
assert.equal(activityDate({ date: date('2026-10-20') }).getTime(),
  date('2026-10-20').getTime(), 'an unedited post keeps publication recency');

const fixtures = [
  { href: '/b', date: '2026.10.20' },
  { href: '/a', date: '2026.10.22' },
  { href: '/c', date: '2026.10.22' },
];
assert.deepEqual(byNewest(fixtures).map((item) => item.href), ['/a', '/c', '/b'],
  'chronological order or same-day stability regressed');
assert.deepEqual(byNewest([...fixtures, { href: '/edited', date: '2026.09.01', updated: '2026.10.30' }])
  .map((item) => item.href), ['/edited', '/a', '/c', '/b'],
  'an edited older post should appear first');

const recentItems = (html, page) => {
  const section = html.match(/<h4>最近更新<\/h4>[\s\S]*?<ul class="widget-list">([\s\S]*?)<\/ul>/);
  assert.ok(section, page + ': missing recent updates sidebar');
  return [...section[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)]
    .map((match) => {
      const href = match[1].match(/<a\b[^>]*href="([^"]+)"/)?.[1];
      assert.ok(href, page + ': recent item without a link');
      return { href: href.replace(/&amp;/g, '&'), html: match[1] };
    });
};

const published = byNewest(records);
for (const item of records) {
  if (item.updated) {
    assert.equal(item.type, 'post', 'note entries cannot have article edits');
    assert.ok(item.updated > item.date, 'updated must represent a strictly newer date');
  }
}
const pages = [
  ['index.html', null],
  ...records.filter((item) => item.type === 'post')
    .map((item) => [decodeURIComponent(item.href).replace(/^\/blog\//, '') + 'index.html', item.href]),
];

for (const [page, current] of pages) {
  const recent = recentItems(read(page), page);
  const expected = published
    .filter((item) => item.href !== current)
    .slice(0, 4);
  assert.deepEqual(recent.map((item) => item.href), expected.map((item) => item.href),
    page + ': latest edited/new post and note chronology or current-post exclusion differs from search index');
  for (let i = 0; i < expected.length; i++) {
    const typePrefix = expected[i].type === 'note' ? '笔记：' : '文章：';
    assert.ok(recent[i].html.includes(typePrefix),
      page + ': missing screen-reader content type prefix for ' + expected[i].href);
  }
}

console.log('✓ Recent sidebar: ' + pages.length + ' pages match mixed published chronology and accessible type labels');
