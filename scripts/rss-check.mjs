import assert from 'node:assert/strict';
import fs from 'node:fs';
import { absolutizeFeedHtml } from '../src/lib/rss-html.mjs';

assert.equal(absolutizeFeedHtml('<a href="#chapter">Read</a><img src="/blog/test.png">', 'https://example.org/blog/posts/example/'), '<a href="https://example.org/blog/posts/example/#chapter">Read</a><img src="https://example.org/blog/test.png">');
assert.equal(absolutizeFeedHtml('<a href="javascript:alert(1)">unsafe</a>', 'https://example.org/'), '<a >unsafe</a>');
for (const [file, expected] of [['rss.xml', '为什么又要折腾一次'], ['notes.xml', null]]) {
  const xml = fs.readFileSync('dist/' + file, 'utf8');
  const entries = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  assert.ok(entries.length >= 3, file + ': entries missing');
  for (const [index, entry] of entries.entries()) {
    assert.match(entry, /<content:encoded>/, file + ': entry ' + index + ' missing full text');
    const content = entry.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1] ?? '';
    assert.ok(content.length > 100, file + ': entry ' + index + ' truncated');
    assert.doesNotMatch(content, /(?:href|src)=(?:&quot;|")\s*(?:\/(?!\/)|#)/i);
  }
  if (expected) assert.ok(xml.includes(expected), file + ': missing known MDX body text');
  console.log('✓', file, entries.length, 'full-text entries');
}
