import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { uniqueSearchTags } from '../src/lib/search-tags.mjs';

// Repeated labels must not consume the first three visible tag positions.
const source = ['CSS', 'CSS', 'Astro', 'React', 'React', '设计'];
assert.deepEqual(uniqueSearchTags(source), ['CSS', 'Astro', 'React', '设计']);
assert.deepEqual(uniqueSearchTags(source).slice(0, 3), ['CSS', 'Astro', 'React']);
assert.deepEqual(source, ['CSS', 'CSS', 'Astro', 'React', 'React', '设计'], 'do not mutate source metadata');
assert.deepEqual(uniqueSearchTags(['CSS', 'css', 'CSS']), ['CSS', 'css'], 'preserve exact tag names');
assert.deepEqual(uniqueSearchTags([]), []);

// Built index and initial HTML must use the same first-three, distinct-tag rule.
const dist = (file) => fs.readFileSync(path.resolve('dist', file), 'utf8');
const records = JSON.parse(dist('search-index.json')).posts;
assert.ok(Array.isArray(records) && records.length, 'published search index is missing');
for (const entry of records) {
  assert.ok(entry.type === 'post' || entry.type === 'note');
  assert.ok(Array.isArray(entry.tags), 'search index tags are missing for ' + entry.href);
  assert.deepEqual(entry.tags, uniqueSearchTags(entry.tags), 'duplicate index tags in ' + entry.href);
}

const postTags = new Map(records.filter((entry) => entry.type === 'post')
  .map((entry) => [entry.href, entry.tags]));
// Astro escapes quotes in the data attribute; browsers decode entities before dataset access.
const decodeAttr = (value) => value
  .replace(/&quot;|&#34;|&#x22;/gi, '"')
  .replace(/&#39;|&#x27;/gi, "'")
  .replace(/&lt;|&#60;|&#x3c;/gi, '<')
  .replace(/&gt;|&#62;|&#x3e;/gi, '>')
  .replace(/&amp;|&#38;|&#x26;/gi, '&');
const html = dist('search/index.html');
const cards = [...html.matchAll(/<a\b[^>]*class="search-item"[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
assert.equal(cards.length, postTags.size, 'static search cards must cover every indexed article');
for (const card of cards) {
  const href = card.match(/\bhref="([^"]+)"/)?.[1];
  assert.ok(href && postTags.has(href), 'unexpected static search card: ' + href);
  const labels = [...card.matchAll(/<span class="tag">#([^<]*)<\/span>/g)]
    .map((match) => match[1]);
  assert.deepEqual(labels, postTags.get(href).slice(0, 3), 'static and JS search tags disagree: ' + href);
  const serialized = card.match(/\bdata-tags="([^"]*)"/)?.[1];
  assert.ok(serialized, 'missing JSON tag metadata on static card: ' + href);
  assert.deepEqual(JSON.parse(decodeAttr(serialized)), postTags.get(href),
    'static fallback must preserve multiword tag boundaries and every unique label: ' + href);
}
console.log('✓ Search tags: distinct labels, stable first-three display, matching index and static cards');
