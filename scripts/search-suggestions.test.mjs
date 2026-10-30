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

/* Sorting is stable: the index lists posts first, then notes, both newest first. */
const expected = [...records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
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
  expected.map(({ href, date }) => ({ href, date })),
  'search suggestions must match newest published posts and notes in the search index');
for (let i = 0; i < expected.length; i++) {
  const prefix = expected[i].type === 'note' ? '笔记：' : '文章：';
  assert.ok(actual[i].html.includes('class="sr-only"') && actual[i].html.includes(prefix),
    'search suggestion lacks the accessible type label for ' + expected[i].href);
}

const home = read('index.html');
assert.ok(home.includes('最近想法') && home.includes('最近文章'),
  'homepage notes and article-only section names should remain distinguishable');
console.log('✓ Search fallback: newest ' + actual.length + ' posts/notes, dates and type labels match the published index');
