/**
 * Cross-page tag discovery contract.
 *
 * The /tags/ directory is the canonical post + note tag list. The homepage
 * sidebar and search suggestions must be prefixes of that same ranking,
 * including tags that appear only on notes. Run after Astro build.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (route) => fs.readFileSync(path.resolve('dist', route), 'utf8');

const linksIn = (html, className) => {
  const section = html.match(new RegExp(
    '<div\\s+class="' + className + '"[^>]*>([\\s\\S]*?)<\\/div>', 'i'
  ));
  assert.ok(section, 'missing ' + className + ' tag list');
  return [...section[1].matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)]
    .map((match) => match[1].replace(/&amp;/g, '&'));
};

const allTags = linksIn(read('tags/index.html'), 'tag-cloud');
assert.ok(allTags.length, 'the tag directory has no entries');
assert.equal(new Set(allTags).size, allTags.length, 'duplicate tag directory links');

for (const link of allTags) {
  assert.match(link, /^\/blog\/tags\/[^/]+\/$/, 'invalid tag route: ' + link);
}

const homeTags = linksIn(read('index.html'), 'widget-tags');
const postTags = linksIn(read('posts/hello-astro/index.html'), 'widget-tags');
const searchTags = linksIn(read('search/index.html'), 'search-suggest-tags');

assert.deepEqual(homeTags, allTags.slice(0, 14), 'homepage sidebar omits/misorders note tags');
assert.deepEqual(postTags, allTags.slice(0, 14), 'article sidebar omits/misorders note tags');
assert.deepEqual(searchTags, allTags.slice(0, 6), 'search suggestions omit/misorder note tags');

console.log('✓ Tag discovery: directory, homepage/sidebar and search suggestions share post + note ranking');
