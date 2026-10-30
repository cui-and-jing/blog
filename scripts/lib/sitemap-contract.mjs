/**
 * Audit the published sitemap, robot instructions and the freshness of note tags.
 * The test reads build output and source frontmatter; no browser or new dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const xmlText = (xml, tag) => {
  const hit = xml.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return hit?.[1]?.trim().replace(/&amp;/g, '&') ?? '';
};

function walkMarkdown(folder, found = []) {
  if (!fs.existsSync(folder)) return found;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) walkMarkdown(file, found);
    else if (entry.isFile() && /\.mdx?$/.test(entry.name)) found.push(file);
  }
  return found;
}

function latestNoteChanges(folder) {
  const updates = new Map();
  const bump = (route, date) => {
    const previous = updates.get(route);
    if (!previous || date > previous) updates.set(route, date);
  };
  for (const file of walkMarkdown(folder)) {
    const markdown = fs.readFileSync(file, 'utf8');
    const front = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!front) continue;
    let data;
    try { data = parseYaml(front[1]) ?? {}; }
    catch { continue; } // Content lint checks malformed frontmatter separately.
    if (data.draft) continue;
    const date = data.date instanceof Date ? data.date : new Date(String(data.date));
    if (!Number.isFinite(date.getTime())) continue;
    for (const route of ['/', '/notes/', '/tags/']) bump(route, date);
    for (const tag of Array.isArray(data.tags) ? data.tags : []) {
      bump('/tags/' + String(tag) + '/', date);
    }
  }
  return updates;
}

export function auditSitemap({
  dist = 'dist',
  notesDir = 'src/content/notes',
  site = 'https://cui-and-jing.github.io',
  base = '/blog',
} = {}) {
  const errors = [];
  const root = path.resolve(dist);
  const prefix = base === '/' ? '' : '/' + String(base).replace(/^\/+|\/+$/g, '');
  const origin = new URL(site).origin;
  const expectedIndex = origin + prefix + '/sitemap-index.xml';
  const record = new Map();
  const seen = new Set();
  let maps = 0;

  const read = (file) => {
    const location = path.resolve(root, file);
    if (!location.startsWith(root + path.sep) || !fs.existsSync(location)) {
      errors.push('Missing generated file: ' + file);
      return '';
    }
    return fs.readFileSync(location, 'utf8');
  };

  const robots = read('robots.txt');
  if (!robots.split(/\r?\n/).some((line) => line.trim() === 'Sitemap: ' + expectedIndex)) {
    errors.push('robots.txt does not advertise ' + expectedIndex);
  }

  const sitemapIndex = read('sitemap-index.xml');
  const entries = [...sitemapIndex.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)];
  if (!entries.length) errors.push('No sitemap children listed in sitemap-index.xml');

  for (const entry of entries) {
    const location = xmlText(entry[1], 'loc');
    let sitemap;
    try { sitemap = new URL(location); }
    catch {
      errors.push('Invalid sitemap index location: ' + location);
      continue;
    }
    if (sitemap.origin !== origin || !sitemap.pathname.startsWith(prefix + '/')) {
      errors.push('Sitemap index location bypasses site base: ' + location);
      continue;
    }
    const name = decodeURIComponent(sitemap.pathname.slice(prefix.length + 1));
    if (!/^sitemap-\d+\.xml$/.test(name)) {
      errors.push('Unexpected sitemap child: ' + location);
      continue;
    }
    const child = read(name);
    if (!child) continue;
    maps += 1;
    const urls = [...child.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)];
    for (const item of urls) {
      const loc = xmlText(item[1], 'loc');
      let target;
      try { target = new URL(loc); }
      catch {
        errors.push('Invalid page location: ' + loc);
        continue;
      }
      if (target.origin !== origin || !target.pathname.startsWith(prefix + '/')
          || target.search || target.hash) {
        errors.push('Invalid sitemap page origin/base/query: ' + loc);
        continue;
      }
      let route;
      try { route = decodeURIComponent(target.pathname.slice(prefix.length)) || '/'; }
      catch {
        errors.push('Invalid percent-encoded sitemap route: ' + loc);
        continue;
      }
      if (seen.has(route)) errors.push('Duplicate sitemap route: ' + route);
      seen.add(route);
      const relative = route.replace(/^\/+/, '');
      const candidates = [
        relative,
        relative ? relative.replace(/\/?$/, '/') + 'index.html' : 'index.html',
      ];
      const targetFile = candidates.map((candidate) => path.resolve(root, candidate))
        .find((candidate) => candidate.startsWith(root + path.sep)
          && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!targetFile) {
        errors.push('Sitemap points at missing generated route: ' + loc);
        continue;
      }
      if (path.basename(targetFile) === '404.html') {
        errors.push('404 fallback must not appear in sitemap: ' + loc);
      }
      if (targetFile.endsWith('.html')) {
        const html = fs.readFileSync(targetFile, 'utf8');
        const noindex = [...html.matchAll(/<meta\b[^>]*>/gi)].some(([meta]) =>
          /\bname=["']robots["']/i.test(meta)
          && /\bcontent=["'][^"']*\bnoindex\b/i.test(meta));
        if (noindex) errors.push('Noindex page included in sitemap: ' + loc);
      }
      const lastmod = xmlText(item[1], 'lastmod');
      record.set(route, lastmod ? new Date(lastmod) : null);
    }
  }

  for (const [route, date] of latestNoteChanges(notesDir)) {
    if (!record.has(route)) {
      errors.push('Published note collection route missing from sitemap: ' + route);
      continue;
    }
    const modified = record.get(route);
    if (!(modified instanceof Date) || !Number.isFinite(modified.getTime())
        || modified.getTime() + 1000 < date.getTime()) {
      errors.push('Stale/missing lastmod for ' + route
        + ': expected at least ' + date.toISOString());
    }
  }

  return { maps, pages: seen.size, noteRoutes: latestNoteChanges(notesDir).size, errors };
}
