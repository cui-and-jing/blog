import assert from 'node:assert/strict';
import { plain } from '../src/lib/search-plain.mjs';

assert.equal(plain('CSS-in-JS 与 Vue-3'), 'CSS-in-JS 与 Vue-3',
  'hyphens inside search terms must survive indexing');
assert.equal(plain('- CSS-in-JS\n- foo-bar'), 'CSS-in-JS foo-bar',
  'list bullets are formatting, not searchable dashes');
assert.equal(plain('---\nReact-Native\n---'), 'React-Native',
  'horizontal rules must be stripped without damaging neighboring labels');
assert.equal(plain('**API-v2** [foo-bar](https://example.com/) ![cover](x.png)'),
  'API-v2 foo-bar', 'markdown decoration must not be searchable');
assert.equal(plain('one-two\n```js\nsecret-token\n```\nthree-four'),
  'one-two three-four', 'fenced code remains excluded');
assert.equal(plain('中文-英文  A-B  foo - bar'), '中文-英文 A-B foo - bar',
  'Chinese/Latin hyphens and spaced punctuation are not flattened');
assert.equal(plain(''), '', 'empty content stays empty');
console.log('✓ Search plain text: hyphenated terms, list markers, rules, links and code fences');
