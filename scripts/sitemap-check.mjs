/**
 * Validate both the pure lastmod rules and the built XML sitemap.
 * Run after npm run build. No browser or frontend runtime required.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectLastmod, readEntries } from './lib/sitemap-metadata.mjs';

const base = (process.env.BLOG_BASE ?? '/blog').replace(/\/$/, '');
const site = (process.env.BLOG_SITE ?? 'https://cui-and-jing.github.io').replace(/\/$/, '');
const stamp = (date) => new Date(date + 'T00:00:00.000Z');
const synthetic = collectLastmod([
  { slug: 'older', date: stamp('2026-10-10'), tags: ['共同'], category: '生活', series: '流程' },
  { slug: 'newer', date: stamp('2026-10-19'), tags: ['共同'], category: '技术', series: '流程' },
], [
  { slug: 'note', date: stamp('2026-10-22'), tags: ['共同', '仅笔记'] },
  { slug: 'untagged', date: stamp('2026-10-23'), tags: [] },
], base);

for (const [route, date] of [
  ['/tags/共同/', '2026-10-22'],
  ['/tags/仅笔记/', '2026-10-22'],
  ['/tags/', '2026-10-22'],
  ['/posts/', '2026-10-19'],
  ['/series/流程/', '2026-10-19'],
  ['/notes/', '2026-10-23'],
  ['/', '2026-10-23'],
]) {
  assert.equal(synthetic.get(base + route)?.getTime(), stamp(date).getTime(), 'lastmod ' + route);
}
assert.equal(synthetic.has(base + '/posts/note/'), false, 'notes must not become article routes');
console.log('✓ Metadata fixtures: note-only tags, shared tags, index and article/notes separation');

const root = path.resolve('dist');
const xmlFiles = fs.readdirSync(root).filter((file) => /^sitemap-\d+\.xml$/.test(file));
assert.ok(xmlFiles.length, 'sitemap XML was not emitted by the build');
assert.ok(fs.existsSync(path.join(root, 'sitemap-index.xml')), 'missing sitemap index');

const sitemap = new Map();
for (const file of xmlFiles) {
  const xml = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [, entry] of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = entry.match(/<loc>(.*?)<\/loc>/i)?.[1];
    const lastmod = entry.match(/<lastmod>(.*?)<\/lastmod>/i)?.[1];
    assert.ok(loc, file + ': sitemap entry without loc');
    const url = new URL(loc.replace(/&amp;/g, '&'));
    assert.ok(url.href.startsWith(site + base + '/'), 'sitemap URL escapes site base: ' + url.href);
    const route = decodeURIComponent(url.pathname);
    assert.equal(sitemap.has(route), false, 'duplicate sitemap entry: ' + route);
    sitemap.set(route, lastmod);
  }
}
assert.ok(sitemap.size > 0, 'sitemap contains no URLs');

const posts = readEntries(path.resolve('src/content/posts'));
const notes = readEntries(path.resolve('src/content/notes'));
const expected = collectLastmod(posts, notes, base);
for (const [route, date] of expected) {
  assert.ok(sitemap.has(route), 'missing sitemap route: ' + route);
  const xmlDate = sitemap.get(route);
  assert.ok(xmlDate, route + ': missing lastmod');
  assert.equal(Date.parse(xmlDate), date.getTime(), route + ': outdated lastmod');
}

/* All note detail pages are deliberately noindex; the notes index remains indexable. */
for (const route of sitemap.keys()) {
  assert.doesNotMatch(route, /\/(?:search|styleguide)\/$/, 'noindex helper page leaked to sitemap');
  assert.doesNotMatch(route, /\/404(?:\.html|\/)?$/, 'noindex 404 fallback leaked to sitemap');
  assert.doesNotMatch(route, /\/notes\/[^/]+\/$/, 'noindex note permalink leaked to sitemap');
}
const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
assert.ok(robots.includes('Sitemap: ' + site + base + '/sitemap-index.xml'),
  'robots.txt points to a missing or incorrect sitemap');
console.log('✓ Built sitemap: ' + sitemap.size + ' routes with ' + expected.size +
  ' verified lastmod timestamps; excludes noindex routes');
