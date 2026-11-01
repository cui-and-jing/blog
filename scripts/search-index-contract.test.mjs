/** Keep published search metadata safe for the browser scorer and renderer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertSearchEntries } from '../src/lib/search-index-contract.mjs';

const sample = {
  type: 'post', title: 'Astro 入门', description: '', date: '2026.10.31',
  category: '技术', tags: ['Astro', 'React Native'], minutes: 1,
  href: '/blog/posts/astro/', text: '本文介绍 Astro。',
};
const note = {
  ...sample, type: 'note', title: '笔记', category: '', minutes: 0,
  href: '/blog/notes/2026-10-31/', text: '',
};
assert.doesNotThrow(() => assertSearchEntries([sample, note], '/blog'));
assert.doesNotThrow(() => assertSearchEntries([{ ...sample, updated: '2026.10.31' }], '/blog'));
const failures = [
  ['absent array', null, /entries array/],
  ['missing record', [null], /invalid type/],
  ['unknown type', [{ ...sample, type: 'other' }], /invalid type/],
  ['null title', [{ ...sample, title: null }], /title must be a string/],
  ['blank title', [{ ...sample, title: ' ' }], /missing title/],
  ['missing description', [{ ...sample, description: undefined }], /description must be a string/],
  ['invalid tags', [{ ...sample, tags: ['Astro', 123] }], /tags must be strings/],
  ['invalid minutes', [{ ...sample, minutes: NaN }], /minutes must be nonnegative/],
  ['negative minutes', [{ ...sample, minutes: -2 }], /minutes must be nonnegative/],
  ['missing link', [{ ...sample, href: '' }], /missing title, date or path/],
  ['malformed publication date', [{ ...sample, date: '2026-10-31' }], /invalid publication date/],
  ['out-of-range publication month', [{ ...sample, date: '2026.13.01' }], /invalid publication date/],
  ['malformed revision', [{ ...sample, updated: 7 }], /invalid updated date/],
  ['malformed revision date', [{ ...sample, updated: 'yesterday' }], /invalid updated date/],
  ['protocol-relative link', [{ ...sample, href: '//evil.test/posts/astro/' }], /unsafe path/],
  ['wrong base link', [{ ...sample, href: '/other/posts/astro/' }], /unsafe path/],
  ['wrong type link', [{ ...sample, href: '/blog/notes/astro/' }], /unsafe path/],
  ['dot-segment traversal', [{ ...sample, href: '/blog/posts/../notes/astro/' }], /unsafe path/],
  ['encoded dot-segment traversal', [{ ...sample, href: '/blog/posts/%2e%2e/notes/astro/' }], /unsafe path/],
  ['query suffix', [{ ...sample, href: '/blog/posts/astro/?debug=1' }], /unsafe path/],
  ['fragment suffix', [{ ...sample, href: '/blog/posts/astro/#more' }], /unsafe path/],
  ['invalid percent encoding', [{ ...sample, href: '/blog/posts/%FZ/' }], /invalid path encoding/],
  ['duplicate path', [sample, { ...sample }], /duplicate path/],
];
for (const [name, entries, expected] of failures) {
  assert.throws(() => assertSearchEntries(entries, '/blog'), expected, name);
}

const built = JSON.parse(fs.readFileSync('dist/search-index.json', 'utf8'));
assertSearchEntries(built.posts, process.env.BLOG_BASE ?? '/blog');
assert.ok(built.posts.some((item) => item.type === 'post'), 'missing published articles');
assert.ok(built.posts.some((item) => item.type === 'note'), 'missing published notes');
console.log(`✓ Search index shape gate: ${failures.length} negative fixtures and ${built.posts.length} emitted entries`);
