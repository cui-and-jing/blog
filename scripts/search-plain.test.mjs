import assert from 'node:assert/strict';
import { plain } from '../src/lib/search-plain.mjs';

// Reference-style Markdown links should index the visible label, never the destination.
assert.equal(plain('Read [TypeScript][ts] and [C#][] now.\n[ts]: https://example.com/secret-token\n[C#]: /docs/api_v2 "Guide"'),
  'Read TypeScript and C# now.',
  'full and collapsed reference links keep visible labels without leaking URLs or titles');
assert.equal(plain('before ![private thumbnail][asset] after\n[asset]: /images/secret-diagram.png'),
  'before after', 'reference-style images and their definitions must not become search hits');
assert.equal(plain('before ![logo][] and ![badge] after\n[logo]: /logo.svg'),
  'before and after', 'collapsed and shortcut reference images should also stay out of prose');
assert.equal(plain('intro\n  [ref]: https://example.com/internal-id "title"\noutro'),
  'intro outro', 'indented reference definitions must not pollute search content');

assert.equal(plain('user_id get_user_name foo__bar'), 'user_id get_user_name foo__bar',
  'underscores within code identifiers must survive full-text indexing');
assert.equal(plain('用户_编号 api_v2'), '用户_编号 api_v2',
  'Unicode identifiers and digit suffixes must retain their underscores');
assert.equal(plain('_italic_ and __strong__'), 'italic and strong',
  'Markdown underscore emphasis remains plain text rather than search punctuation');
assert.equal(plain('**set_user_id** 与 [user_id](https://example.com/a_b)'),
  'set_user_id 与 user_id', 'formatted identifiers and link labels must remain searchable');

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
assert.equal(plain('intro\n```inline-code``` trailing prose\nnext-section'),
  'intro trailing prose next-section',
  'a line-start inline code span is not a fenced block that hides subsequent paragraphs');
assert.equal(plain('intro\n````inline-code```` trailing prose\nnext-section'),
  'intro trailing prose next-section',
  'long inline backtick spans at line start must also preserve subsequent paragraphs');
assert.equal(plain('intro\n~~~lang`variant\nhidden-code\n~~~\noutro'),
  'intro outro',
  'tilde fences may include backticks in their info string');
assert.equal(plain('C# 与 F#，以及 #Astro 话题'), 'C# 与 F#，以及 #Astro 话题',
  'hash marks inside technical terms and normal prose must remain searchable');
assert.equal(plain('# C# 入门\n第二段讲 F#'), 'C# 入门 第二段讲 F#',
  'ATX heading syntax is removed without erasing a C# or F# title');
assert.equal(plain('### C# 与 F# ###\n代码之外的说明'), 'C# 与 F# 代码之外的说明',
  'optional trailing ATX heading markers must not leak into search terms');
assert.equal(plain('#不是标题\n# 合法标题'), '#不是标题 合法标题',
  'without a heading separator, a leading hash is literal text');
assert.equal(plain('###\n正文'), '正文',
  'an empty CommonMark ATX heading must not become search noise');
assert.equal(plain('x < 10 && y > 5'), 'x < 10 && y > 5',
  'technical comparisons must survive HTML stripping and Markdown cleanup');
assert.equal(plain('a < b > c'), 'a < b > c',
  'spaced angle comparisons are prose, not HTML tags');
assert.equal(plain('> 引用 C#\n> > 深层引用'), '引用 C# 深层引用',
  'blockquote prefixes, including nested quotes, must still be removed');
assert.equal(plain('<strong>强调</strong> <!-- hidden --> <em>斜体</em>'),
  '强调 斜体', 'actual HTML tags and comments must still be excluded');
assert.equal(plain('x < 10 && y > 5\n> 引用解释'), 'x < 10 && y > 5 引用解释',
  'comparison operators and blockquote markup can coexist');
assert.equal(plain('Map<string, number> 与 Array<Result<T>>'),
  'Map<string, number> 与 Array<Result<T>>',
  'generic arguments must remain searchable instead of being mistaken for HTML tags');
assert.equal(plain('List<用户> 和 std::vector<int>'), 'List<用户> 和 std::vector<int>',
  'generic brackets following Chinese and Latin identifiers must remain intact');
assert.equal(plain('文字 <strong>加粗</strong> 和 <span class="note">注释</span>'),
  '文字 加粗 和 注释', 'actual HTML elements and attributes must still be removed');
assert.equal(plain('Hello<strong>world</strong>'), 'Hello world',
  'paired inline HTML without spacing must not leak markup into search');
assert.equal(plain('中文<a href="/">链接</a>'), '中文 链接',
  'inline HTML following Unicode prose must still be removed');
assert.equal(plain('Hello<br>world'), 'Hello world',
  'void HTML elements adjacent to text must not leak into search');
assert.equal(plain('图片<img src="x">说明'), '图片 说明',
  'inline HTML images must remain excluded from search text');
assert.equal(plain('开头<pre class="language-js"><code>secret-token</code></pre>结尾'),
  '开头 结尾', 'HTML preformatted code must not leak into search text');
assert.equal(plain('before\n<PRE>\nprivate-token\n</PRE>\nafter'), 'before after',
  'multiline and uppercase pre blocks must also be excluded');
assert.equal(plain('正文<script>secretJs()</script><style>.secretCss { color: red }</style>后续'),
  '正文 后续', 'embedded scripts and styles are not readable article prose');
assert.equal(plain('保留<code>C#</code> 内联代码'), '保留 C# 内联代码',
  'ordinary inline HTML code should remain searchable');
assert.equal(plain(''), '', 'empty content stays empty');
console.log('✓ Search plain text: hyphenated terms, list markers, rules, links and both code-fence styles');
