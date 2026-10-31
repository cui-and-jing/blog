import assert from 'node:assert/strict';
import { sharedSeriesTags } from '../src/lib/series-tags.mjs';

const posts = [
  { id: 'first', data: { tags: ['solo', 'solo', 'common', 'common', 'A', 'B', 'C', 'D', 'E'] } },
  { id: 'second', data: { tags: ['common', 'A', 'B', 'C', 'D', 'E', 'A'] } },
  { id: 'third', data: { tags: ['common', 'C', 'D', 'E', 'B'] } },
  { id: 'fourth', data: { tags: ['D', 'E'] } },
];
const original = posts.map((post) => [...post.data.tags]);

assert.deepEqual(sharedSeriesTags([]), [], 'no articles have no shared tags');
assert.deepEqual(sharedSeriesTags([posts[0]]), [], 'duplicates in one article are not shared');
assert.deepEqual(sharedSeriesTags(posts.slice(0, 2)), ['common', 'A', 'B', 'C'],
  'equal frequency uses reading order and caps at four labels');
assert.deepEqual(sharedSeriesTags(posts), ['D', 'E', 'common', 'B'],
  'frequency is per distinct article, not repeated mentions');
assert.deepEqual(sharedSeriesTags(posts, 10), ['D', 'E', 'common', 'B', 'C', 'A'],
  'larger limits preserve all actual shared tags in stable order');
assert.deepEqual(sharedSeriesTags(posts, 0), [], 'zero limit emits no tags');
assert.ok(!sharedSeriesTags(posts, 10).includes('solo'),
  'a duplicated label from one article never appears as shared');
assert.deepEqual(posts.map((post) => post.data.tags), original, 'author metadata stays unchanged');
assert.deepEqual(sharedSeriesTags([
  { data: { tags: [] } }, { data: { tags: ['only'] } },
]), [], 'no intersection means no shared tags');
assert.deepEqual(sharedSeriesTags([
  { data: { tags: ['CSS', 'CSS'] } },
  { data: { tags: ['CSS'] } },
]), ['CSS'], 'a real shared tag survives duplicates on one side');

console.log('✓ Series labels: 10 distinct-article count, stable order, cap and non-mutation assertions');
