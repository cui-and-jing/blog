/** Search-index note previews must agree with the notes' excerpt semantics.
 * Run after build in both CI Quality and local preflight.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { excerptFromText, titleFromText } from '../src/lib/note-text.ts';

const description = (text) => excerptFromText(text, 120) || text.slice(0, 120);
const longOpening = '超过一百二十字的首句'.repeat(15);
assert.ok(longOpening.length > 120, 'fixture must exceed the old 120-character limit');

const fixtures = [
  ['ordinary', '先说第一句。后面才是新信息。', '后面才是新信息。'],
  ['question', '为什么会这样？随后补充分析。', '随后补充分析。'],
  ['long opening', `${longOpening}。真正的摘要从这里开始。`, '真正的摘要从这里开始。'],
  ['single sentence', '只有一句话。', '只有一句话。'],
  ['no punctuation', '没有句末标点的零散记录', '没有句末标点的零散记录'],
  ['empty text', '', ''],
];
for (const [label, text, expected] of fixtures) {
  assert.equal(description(text), expected, label);
}
assert.equal(description('开头。后续内容比较长。', 120), '后续内容比较长。');

const index = JSON.parse(fs.readFileSync('dist/search-index.json', 'utf8'));
assert.ok(Array.isArray(index.posts), 'search index missing its posts array');
const notes = index.posts.filter((item) => item.type === 'note');
const posts = index.posts.filter((item) => item.type === 'post');
assert.ok(notes.length, 'expected at least one published note');
assert.ok(posts.length, 'search index must still include articles');
for (const note of notes) {
  assert.equal(note.title, titleFromText(note.text), note.href + ': title semantics differ');
  assert.equal(note.description, description(note.text), note.href + ': search preview repeats the title');
  assert.ok(note.description.length <= 120, note.href + ': preview exceeds length cap');
  assert.match(note.href, /^\/blog\/notes\/[^/]+\/$/, note.href + ': note permalink changed');
}
console.log('✓ Search note previews: ' + fixtures.length + ' fixtures and ' + notes.length + ' built notes agree');
