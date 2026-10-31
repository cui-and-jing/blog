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
assert.equal(plain('before\n~~~ts\nsecret-token\n~~~\nafter'), 'before after',
  'tilde-fenced code must not be searchable');
assert.equal(plain('before\r\n  ````js\r\nsecret-token\r\n  `````\r\nafter'), 'before after',
  'longer closing fence, indentation and CRLF must work');
assert.equal(plain('before\n~~~js\nsecret-token\n```\nstill-code\n~~~~\nafter'), 'before after',
  'another fence character cannot close a tilde block');
assert.equal(plain('before\n```ts\nsecret-token'), 'before',
  'an unclosed code fence must hide trailing code');
assert.equal(plain('before ```secret-token``` after'), 'before after',
  'existing inline triple-backtick handling must remain unchanged');
assert.equal(plain(''), '', 'empty content stays empty');
console.log('✓ Search plain text: hyphenated terms, list markers, rules, links and both code-fence styles');
