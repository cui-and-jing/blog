/**
 * Build-time sitemap lastmod metadata, shared by Astro config and CI contracts.
 * Aggregate pages (home, archive, authors, tags) follow both articles and notes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Read published Markdown/MDX frontmatter without loading astro:content. */
export function readEntries(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (current) =>
    fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.mdx?$/.test(entry.name) ? [full] : [];
    });

  for (const file of walk(dir)) {
    const raw = fs.readFileSync(file, 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) continue;

    let data;
    try { data = parseYaml(match[1]) ?? {}; }
    catch { continue; }
    if (data.draft) continue;

    const published = data.date instanceof Date ? data.date : new Date(String(data.date));
    const updated = data.updated instanceof Date ? data.updated : data.updated ? new Date(String(data.updated)) : null;
    if (Number.isNaN(published.valueOf()) || (updated && Number.isNaN(updated.valueOf()))) continue;
    // An incorrect earlier updated date cannot make a published page look older.
    const date = updated && updated > published ? updated : published;

    out.push({
      slug: path.relative(dir, file).replace(/\.mdx?$/, '').split(path.sep).join('/'),
      date,
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      category: data.category ? String(data.category) : '',
      series: data.series ? String(data.series) : '',
    });
  }
  return out;
}

/**
 * Return decoded, base-prefixed paths used by @astrojs/sitemap.serialize.
 * Aggregation routes include the newest content that can change their HTML.
 */
export function collectLastmod(posts, notes, base) {
  const changes = new Map();
  const bump = (route, date) => {
    const prev = changes.get(route);
    if (!prev || date > prev) changes.set(route, date);
  };

  /* Only series with at least two posts receive a dedicated page. */
  const seriesCounts = new Map();
  for (const post of posts) if (post.series) {
    seriesCounts.set(post.series, (seriesCounts.get(post.series) ?? 0) + 1);
  }

  let latestPost = null;
  for (const post of posts) {
    if (!latestPost || post.date > latestPost) latestPost = post.date;
    bump('/posts/' + post.slug + '/', post.date);
    if (post.series && seriesCounts.get(post.series) > 1) bump('/series/' + post.series + '/', post.date);
    for (const tag of post.tags) bump('/tags/' + tag + '/', post.date);
    if (post.category) bump('/category/' + post.category + '/', post.date);
  }
  if (latestPost) {
    for (const route of ['/posts/', '/archive/', '/authors/', '/tags/', '/series/', '/']) bump(route, latestPost);
  }

  let latestNote = null;
  for (const note of notes) {
    if (!latestNote || note.date > latestNote) latestNote = note.date;
    for (const tag of note.tags) {
      bump('/tags/' + tag + '/', note.date);
      bump('/tags/', note.date);
    }
  }
  if (latestNote) {
    // Archive and authors list notes too: note-only changes must refresh their lastmod.
    for (const route of ['/notes/', '/archive/', '/authors/', '/']) bump(route, latestNote);
  }

  return new Map([...changes].map(([route, date]) => [base + route, date]));
}
