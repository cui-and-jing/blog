import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditBuiltLinks } from './lib/built-links.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-links-'));
const write = (name, content) => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
};

try {
  write('index.html', '<!doctype html><html><body>' +
    '<a href="/blog/posts/%E4%B8%AD%E6%96%87/?from=home#part">中文文章</a>' +
    '<a href="/blog/posts/?q=hello&amp;type=post">全部文章</a>' +
    '<a href="#">unused placeholder</a>' +
    '<a href="https://external.example/path">External</a>' +
    '<img srcset="/blog/assets/a.svg 1x, /blog/assets/b.svg 2x">' +
    '<link rel="alternate" href="/blog/rss.xml">' +
    '<script>const sample = \'<a href="/blog/not-a-real-page/">\';</script>' +
    '</body></html>');
  write('posts/index.html', '<!doctype html><html><body><a href="/blog/">首页</a></body></html>');
  write('posts/中文/index.html', '<!doctype html><html><body><section id="part">正文</section><a href="../../">返回首页</a></body></html>');
  /* GitHub Pages uses 404.html, not the pretty /404/ route. */
  write('404.html', '<!doctype html><html><head><link rel="canonical" href="https://example.test/blog/404.html"></head></html>');
  write('rss.xml', '<rss/>');
  write('assets/a.svg', '<svg/>');
  write('assets/b.svg', '<svg/>');

  /* CSS assets may be relative to the emitted _astro bundle or absolute under /blog/. */
  write('_astro/site.css', [
    '.relative{background:url("../assets/a.svg")}',
    '.absolute{mask:url("/blog/assets/b.svg#symbol")}',
    '.inline{background:url(data:image/svg+xml,%3Csvg%3E)}',
    '/* url("/blog/assets/ignored-comment.svg") */',
  ].join('\n'));

  const config = { dist: root, base: '/blog', site: 'https://example.test' };
  const good = auditBuiltLinks(config);
  assert.equal(good.pages, 4, 'must inspect emitted pages including the 404 fallback');
  assert.ok(good.references >= 6, 'must inspect real navigation and media references');
  assert.deepEqual(good.errors, [], 'valid encoded routes, anchors, assets and base links pass');

  write('index.html', '<!doctype html><html><body>' +
    '<a href="/blog/not-found/">Broken route</a>' +
    '<a href="/blog/posts/%E4%B8%AD%E6%96%87/#missing">Broken anchor</a>' +
    '<img src="/blog/assets/gone.svg">' +
    '<a href="/posts/">Bypasses base</a>' +
    '<a href="javascript:alert(1)">Unsafe href</a>' +
    '</body></html>');

  const broken = auditBuiltLinks(config);
  assert.equal(broken.errors.length, 5, 'all five independent broken references must fail');
  assert.ok(broken.errors.some((e) => e.reason.includes('missing emitted')));
  assert.ok(broken.errors.some((e) => e.reason.includes('missing target fragment')));
  assert.ok(broken.errors.some((e) => e.reason.includes('bypasses')));
  assert.ok(broken.errors.some((e) => e.reason.includes('javascript')));

  write('_astro/site.css', [
    '.missing{background:url("../assets/missing.svg")}',
    '.wrong-base{mask:url("/assets/a.svg")}',
  ].join('\n'));
  const badCss = auditBuiltLinks(config);
  assert.equal(badCss.errors.length, 7, 'must reject missing and out-of-base CSS resources');
  assert.ok(badCss.errors.some((e) => e.page === '_astro/site.css' && e.reason.includes('missing emitted CSS asset')));
  assert.ok(badCss.errors.some((e) => e.page === '_astro/site.css' && e.reason.includes('CSS asset bypasses')));
  console.log('✓ Link-check fixtures: HTML routes, fragments, srcset, CSS asset URLs, data URLs, comments, missing files and base paths');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
