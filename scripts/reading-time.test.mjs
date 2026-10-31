import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readingTime } from '../src/lib/reading-time.mjs';

const longProse = '文'.repeat(1200);
const longCode = 'secret-token = 123;'.repeat(180);
const tick = String.fromCharCode(96);
const ticks = tick.repeat(4);

assert.equal(readingTime(''), 1, 'empty text still has a one-minute minimum');
assert.equal(readingTime('短篇'), 1, 'short prose still takes at least a minute');
assert.equal(readingTime(longProse), 3, 'long prose must still contribute to the reading estimate');
assert.equal(readingTime('开头\n~~~ts\n' + longCode + '\n~~~\n结尾'), 1,
  'tilde code fences should not inflate the reading estimate');
assert.equal(readingTime('开头\n  ' + ticks + 'js\n' + longCode + '\n  ' + ticks + '\n结尾'), 1,
  'long and indented backtick fences should not inflate the estimate');
assert.equal(readingTime('开头\n~~~sh\n' + longCode), 1,
  'unclosed fenced code should be excluded');
assert.equal(readingTime('开头\n' + ticks + 'inline' + ticks + ' 结尾\n' + '文'.repeat(800)), 2,
  'line-start inline backticks must preserve prose after the span');
assert.equal(readingTime('开头\n' + tick.repeat(3) + 'js\n' + longCode + '\n' + tick.repeat(3) + '\n结尾'), 1,
  'the existing triple-backtick behavior must remain');
assert.equal(readingTime('开头<pre><code>' + longCode + '</code></pre>结尾'), 1,
  'HTML preformatted code must not inflate reading time');
assert.equal(readingTime('**' + '文'.repeat(800) + '**'), 2,
  'Markdown decoration should not distort prose length');

// The JSON index and pre-rendered article cards should use the same shared estimator.
const dist = (name) => fs.readFileSync(path.resolve('dist', name), 'utf8');
const entries = JSON.parse(dist('search-index.json')).posts.filter((post) => post.type === 'post');
const html = dist('search/index.html');
const cards = [...html.matchAll(/<a\b[^>]*class="search-item"[^>]*>/g)].map((match) => match[0]);
const minutes = new Map(cards.map((card) => [
  card.match(/\bhref="([^"]+)"/)?.[1],
  Number(card.match(/\bdata-minutes="(\d+)"/)?.[1]),
]));
assert.ok(entries.length > 0 && cards.length === entries.length, 'all articles need search cards');
for (const post of entries) {
  assert.ok(minutes.has(post.href), 'missing search card: ' + post.href);
  assert.equal(minutes.get(post.href), post.minutes, 'inconsistent reading time: ' + post.href);
  assert.ok(post.minutes >= 1 && Number.isInteger(post.minutes), 'invalid reading time: ' + post.href);
}
console.log('✓ Reading time: prose-only Markdown fixtures and ' + entries.length + ' built search cards');
