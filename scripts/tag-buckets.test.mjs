import assert from 'node:assert/strict';
import { collectTags } from '../src/lib/tags.ts';

// The content schema accepts arrays with repeated labels. A tag directory must
// count each item once per tag, never duplicate its cards or inflate popularity.
const postOld = {
  id: 'post-old',
  data: { date: new Date('2026-10-01T00:00:00Z'), tags: ['CSS', 'CSS', '读书'] },
};
const postNew = {
  id: 'post-new',
  data: { date: new Date('2026-10-03T00:00:00Z'), tags: ['CSS', 'JavaScript'] },
};
const noteOld = {
  id: 'note-old',
  data: { date: new Date('2026-10-02T00:00:00Z'), tags: ['CSS', 'CSS', '笔记'] },
};
const noteNew = {
  id: 'note-new',
  data: { date: new Date('2026-10-04T00:00:00Z'), tags: ['CSS', '笔记', '笔记'] },
};

const buckets = collectTags([postOld, postNew], [noteOld, noteNew]);
const tags = new Map(buckets.map((bucket) => [bucket.tag, bucket]));
const css = tags.get('CSS');
assert.ok(css, 'CSS bucket must exist');
assert.equal(css.total, 4, 'repeated tags must not inflate a bucket count');
assert.deepEqual(css.posts.map((post) => post.id), ['post-new', 'post-old']);
assert.deepEqual(css.notes.map((note) => note.id), ['note-new', 'note-old']);
assert.equal(tags.get('笔记')?.total, 2, 'note duplicates count once');
assert.equal(tags.get('读书')?.total, 1, 'unique post tag preserved');
assert.equal(tags.get('JavaScript')?.total, 1, 'unique post tag preserved');
assert.equal(buckets[0].tag, 'CSS', 'most-used tag appears first');
assert.deepEqual(postOld.data.tags, ['CSS', 'CSS', '读书'], 'source post data remains unchanged');
assert.deepEqual(noteNew.data.tags, ['CSS', '笔记', '笔记'], 'source note data remains unchanged');
assert.deepEqual(collectTags([], []), [], 'empty content has no tags');

console.log('Tag bucket unique-item regression: 11 assertions passed');
