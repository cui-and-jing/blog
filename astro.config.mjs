import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const site = process.env.BLOG_SITE ?? 'https://cui-and-jing.github.io';
const base = process.env.BLOG_BASE ?? '/blog';

/* 配置文件比内容层加载得早，这里直接读 frontmatter，不引 astro:content */
const postsDir = fileURLToPath(new URL('./src/content/posts', import.meta.url));
const notesDir = fileURLToPath(new URL('./src/content/notes', import.meta.url));

/** 读某个内容目录的 frontmatter，草稿与坏日期直接跳过 */
function readEntries(dir) {
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
    try {
      data = parseYaml(match[1]) ?? {};
    } catch {
      continue;
    }
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
 * 给 sitemap 补 lastmod：文章取 updated（没有就取 date），
 * 聚合页取该页涉及文章里最新的一天。没有日期的静态页就不写，不拿构建时间凑数。
 */
function collectLastmod() {
  const map = new Map();
  const posts = readEntries(postsDir);
  const notes = readEntries(notesDir);

  const bump = (route, date) => {
    const prev = map.get(route);
    if (!prev || date > prev) map.set(route, date);
  };

  let latest = null;
  for (const post of posts) {
    if (!latest || post.date > latest) latest = post.date;
    bump(`/posts/${post.slug}/`, post.date);
    if (post.series) bump(`/series/${post.series}/`, post.date);
    for (const tag of post.tags) bump(`/tags/${tag}/`, post.date);
    if (post.category) bump(`/category/${post.category}/`, post.date);
  }
  if (latest) {
    for (const route of ['/posts/', '/archive/', '/tags/', '/series/']) bump(route, latest);
  }

  /* 笔记不参与上面任何聚合，只影响笔记页和首页（首页有「最近想法」） */
  const latestNote = notes.reduce((acc, note) => (!acc || note.date > acc ? note.date : acc), null);
  if (latestNote) {
    bump('/notes/', latestNote);
    bump('/tags/', latestNote);
    bump('/', latestNote);
  }
  /* Tag pages aggregate both articles and notes, so note-only changes refresh lastmod. */
  for (const note of notes) {
    for (const tag of note.tags) bump(`/tags/${tag}/`, note.date);
  }
  if (latest) bump('/', latest);

  /* 索引键带上 base；sitemap 给的 URL 是编码过的，比较前会先解码 */
  const keyed = new Map();
  for (const [route, date] of map) keyed.set(`${base}${route}`, date);
  return keyed;
}

const lastmod = collectLastmod();

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [
    mdx(),
    sitemap({
      /* 搜索页是纯客户端工具，排版样例页是给作者自己查的，都不该进搜索结果；
         笔记独立页带 noindex，也不该一边说别索引、一边写进 sitemap */
      filter: (page) => {
        const path = page.replace(/\/$/, '');
        if (/\/(search|styleguide|404(?:\.html)?)$/.test(path)) return false;
        return !/\/notes\/[^/]+$/.test(path);
      },
      serialize: (item) => {
        let pathname;
        try {
          pathname = decodeURIComponent(new URL(item.url).pathname);
        } catch {
          return item;
        }
        const date = lastmod.get(pathname);
        return date ? { ...item, lastmod: date.toISOString() } : item;
      },
    }),
  ],
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  markdown: {
    theme: 'github-dark',
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});
