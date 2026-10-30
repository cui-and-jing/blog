import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditSitemap } from './lib/sitemap-contract.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-sitemap-'));
const dist = path.join(root, 'dist');
const notesDir = path.join(root, 'notes');
const write = (folder, name, content) => {
  const file = path.join(folder, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const site = 'https://example.test';
const base = '/blog';
const loc = (route) => site + base + route;
const item = (route, date = '2026-10-22T00:00:00.000Z') =>
  '<url><loc>' + loc(route) + '</loc><lastmod>' + date + '</lastmod></url>';
const writeMap = (items) => write(dist, 'sitemap-0.xml',
  '<?xml version="1.0"?><urlset>' + items.join('') + '</urlset>');
const opts = { dist, notesDir, site, base };

try {
  write(notesDir, 'note.md', '---\nauthor: jing\ndate: 2026-10-22\ntags: [笔记]\n---\n一条笔记。\n');
  write(notesDir, 'draft.md', '---\nauthor: jing\ndraft: true\ndate: 2026-10-29\ntags: [草稿]\n---\n草稿。\n');
  for (const file of ['index.html', 'notes/index.html', 'tags/index.html', 'tags/笔记/index.html']) {
    write(dist, file, '<!doctype html><html><body>content</body></html>');
  }
  write(dist, '404.html', '<html><head><meta name="robots" content="noindex"></head></html>');
  write(dist, 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: ' + loc('/sitemap-index.xml') + '\n');
  write(dist, 'sitemap-index.xml', '<sitemapindex><sitemap><loc>' + loc('/sitemap-0.xml')
    + '</loc></sitemap></sitemapindex>');
  const valid = [item('/'), item('/notes/'), item('/tags/'), item('/tags/%E7%AC%94%E8%AE%B0/')];
  writeMap(valid);
  assert.deepEqual(auditSitemap(opts).errors, [], 'fresh note tags and proper sitemap pages pass');

  writeMap([item('/'), item('/notes/'), item('/tags/'),
    item('/tags/%E7%AC%94%E8%AE%B0/', '2026-10-20T00:00:00.000Z')]);
  assert.ok(auditSitemap(opts).errors.some((e) => e.includes('Stale/missing lastmod')),
    'a stale note-only tag must fail');
  writeMap(valid.concat(item('/404.html')));
  assert.ok(auditSitemap(opts).errors.some((e) => e.includes('404 fallback')),
    'a noindex 404 page must be rejected');
  writeMap(valid.filter((entry) => !entry.includes('%E7%AC%94')));
  assert.ok(auditSitemap(opts).errors.some((e) => e.includes('missing from sitemap')),
    'a missing note-only tag must fail');
  writeMap(valid);
  write(dist, 'robots.txt', 'User-agent: *\n');
  assert.ok(auditSitemap(opts).errors.some((e) => e.includes('robots.txt')),
    'robots must advertise the generated sitemap index');
  console.log('✓ Sitemap fixtures: note-only freshness, draft exclusion, missing tags, 404 and robots');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
