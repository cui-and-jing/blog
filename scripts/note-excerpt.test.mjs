import assert from 'node:assert/strict';
import { excerptFromText, plainNote, titleFromText } from '../src/lib/note-text.ts';

const checks = [
  ['ordinary note', '先说第一句。真正的后续摘要。', '真正的后续摘要。'],
  ['question boundary', '这是问题？接着解释原因。', '接着解释原因。'],
  ['one sentence', '只有这一句话。', ''],
  ['punctuation-free note', '未写完的灵感和碎片', '未写完的灵感和碎片'],
  ['empty text', '', ''],
];

for (const [label, text, expected] of checks) {
  assert.equal(excerptFromText(text), expected, label);
}

const longLead = '一段很长的开场'.repeat(20); // 140 characters, beyond the old 120-char cutoff
assert.ok(longLead.length > 120);
const longNote = `${longLead}。这里才是应该显示的摘要。`;
assert.equal(excerptFromText(longNote), '这里才是应该显示的摘要。');
assert.equal(titleFromText(longNote), `${longLead.slice(0, 40)}…`);
assert.equal(excerptFromText('引子。接下来还有更多文字。', 4), '接下来还');
assert.equal(excerptFromText(plainNote('第一句。后续 **内容**。')), '后续 内容 。');

console.log('Note excerpt boundaries: 10 assertions passed');
