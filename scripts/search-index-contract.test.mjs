/** Keep published search metadata safe for the browser scorer and renderer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertSearchEntries } from '../src/lib/search-index-contract.mjs';

const sample = {
  type: 'post', title: 'Astro 入门', description: '', date: '2026-10-31',
  category: '技术', tags: ['Astro', 'React Native'], minutes: 1,
  href: '/blog/posts/astro/', text: '本文介绍 Astro。',
};
const note = {
  ...sample, type: 'note', title: '笔记', category: '', minutes: 0,
  href: '/blog/notes/2026-10-31/', text: '',
};
assert.doesNotThrow(() => assertSearchEntries([sample, note]));
assert.doesNotThrow(() => assertSearchEntries([{ ...sample, updated: '2026-10-31' }]));
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
  ['malformed revision', [{ ...sample, updated: 7 }], /updated must be a string/],
  ['duplicate path', [sample, { ...sample }], /duplicate path/],
];
for (const [name, entries, expected] of failures) {
  assert.throws(() => assertSearchEntries(entries), expected, name);
}

const built = JSON.parse(fs.readFileSync('dist/search-index.json', 'utf8'));
assertSearchEntries(built.posts);
assert.ok(built.posts.some((item) => item.type === 'post'), 'missing published articles');
assert.ok(built.posts.some((item) => item.type === 'note'), 'missing published notes');
console.log(`✓ Search index shape gate: ${failures.length} negative fixtures and ${built.posts.length} emitted entries`);
