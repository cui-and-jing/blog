/**
 * Build-time sitemap lastmod metadata, shared by Astro config and CI contracts.
 * Post routes update with posts; tags and the tag index also update with notes.
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

    const value = data.updated ?? data.date;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.valueOf())) continue;

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

  let latestPost = null;
  for (const post of posts) {
    if (!latestPost || post.date > latestPost) latestPost = post.date;
    bump('/posts/' + post.slug + '/', post.date);
    if (post.series) bump('/series/' + post.series + '/', post.date);
    for (const tag of post.tags) bump('/tags/' + tag + '/', post.date);
    if (post.category) bump('/category/' + post.category + '/', post.date);
  }
  if (latestPost) {
    for (const route of ['/posts/', '/archive/', '/tags/', '/series/', '/']) bump(route, latestPost);
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
    for (const route of ['/notes/', '/']) bump(route, latestNote);
  }

  return new Map([...changes].map(([route, date]) => [base + route, date]));
}
