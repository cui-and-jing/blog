/**
 * Verify the search empty-result suggestions really show the newest published
 * posts AND notes, with stable order for same-day content.
 * The emitted search index is a second source of truth (built independently).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (route) => fs.readFileSync(path.resolve('dist', route), 'utf8');
const records = JSON.parse(read('search-index.json')).posts;
assert.ok(Array.isArray(records) && records.length, 'missing published search index');
assert.ok(records.some((item) => item.type === 'note'), 'fixture needs published notes');

/* Normal search keeps publication date; recent fallback uses latest activity. */
const byActivity = (list) => [...list].sort((a, b) =>
  (b.updated ?? b.date).localeCompare(a.updated ?? a.date));
assert.deepEqual(byActivity([
  { href: '/first', date: '2026.10.20' },
  { href: '/edited', date: '2026.10.01', updated: '2026.10.25' },
  { href: '/note', date: '2026.10.20' },
]).map((item) => item.href), ['/edited', '/first', '/note'],
'older revised article should lead and same-day ties must be stable');
const expected = byActivity(records).slice(0, 3);
assert.ok(expected.some((item) => item.type === 'note'),
  'the current newest-three fixture must cover note suggestions');

const search = read('search/index.html');
const block = search.match(/<h2>最近更新<\/h2>\s*<ul>([\s\S]*?)<\/ul>/);
assert.ok(block, 'search fallback is missing its latest-updates list');

const actual = [...block[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => {
  const html = match[1];
  const href = html.match(/<a\b[^>]*href="([^"]+)"/)?.[1];
  const date = html.match(/<time\b[^>]*>([^<]+)<\/time>/)?.[1];
  assert.ok(href && date, 'search latest item is missing its link or date');
  return { href: href.replace(/&amp;/g, '&'), date, html };
});
assert.equal(actual.length, expected.length, 'search latest suggestion count differs');
assert.deepEqual(actual.map(({ href, date }) => ({ href, date })),
  expected.map(({ href, date, updated }) => ({ href, date: updated ?? date })),
  'search suggestions must match newest published posts and notes in the search index');
for (let i = 0; i < expected.length; i++) {
  const prefix = expected[i].type === 'note' ? '笔记：' : '文章：';
  assert.ok(actual[i].html.includes('class="sr-only"') && actual[i].html.includes(prefix),
    'search suggestion lacks the accessible type label for ' + expected[i].href);
  if (expected[i].updated) assert.ok(actual[i].html.includes('更新于'),
    'edited article should announce an update rather than imply first publication');
}

const home = read('index.html');
const notFound = read('404.html');
assert.ok(home.includes('aria-label="搜索文章与笔记"') &&
  search.includes('aria-label="搜索文章与笔记"') &&
  notFound.includes('搜索文章与笔记'),
  'search entry points must describe both articles and notes');
assert.ok(home.includes('最近想法') && home.includes('最近文章'),
  'homepage notes and article-only section names should remain distinguishable');
console.log('✓ Search fallback: newest ' + actual.length + ' posts/notes, dates and type labels match the published index');
