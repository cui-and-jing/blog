/**
 * Guard the "最近更新" sidebar against excluding notes or recommending
 * the current article. The built search index is an independent list of
 * published articles and notes; it has the same date granularity as content.
 * Run this after npm run build (CI and local preflight).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (route) => fs.readFileSync(path.resolve('dist', route), 'utf8');
const records = JSON.parse(read('search-index.json')).posts;
assert.ok(Array.isArray(records) && records.length, 'missing published search index');

/* Stable sort retains the existing post-first, note-second order for ties. */
const byNewest = (list) => [...list].sort((a, b) =>
  Date.parse(b.date.replaceAll('.', '-') + 'T00:00:00Z') -
  Date.parse(a.date.replaceAll('.', '-') + 'T00:00:00Z')
);

const fixtures = [
  { href: '/b', date: '2026.10.20' },
  { href: '/a', date: '2026.10.22' },
  { href: '/c', date: '2026.10.22' },
];
assert.deepEqual(byNewest(fixtures).map((item) => item.href), ['/a', '/c', '/b'],
  'chronological order or same-day stability regressed');

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
    page + ': latest mixed post/note chronology or current-post exclusion differs from search index');
  for (let i = 0; i < expected.length; i++) {
    const typePrefix = expected[i].type === 'note' ? '笔记：' : '文章：';
    assert.ok(recent[i].html.includes(typePrefix),
      page + ': missing screen-reader content type prefix for ' + expected[i].href);
  }
}

console.log('✓ Recent sidebar: ' + pages.length + ' pages match mixed published chronology and accessible type labels');
