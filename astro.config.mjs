import { fileURLToPath } from 'node:url';
import { readEntries, collectLastmod } from './scripts/lib/sitemap-metadata.mjs';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const site = process.env.BLOG_SITE ?? 'https://cui-and-jing.github.io';
const base = process.env.BLOG_BASE ?? '/blog';

/* 配置文件比内容层加载得早，这里直接读 frontmatter，不引 astro:content */
const postsDir = fileURLToPath(new URL('./src/content/posts', import.meta.url));
const notesDir = fileURLToPath(new URL('./src/content/notes', import.meta.url));

const lastmod = collectLastmod(readEntries(postsDir), readEntries(notesDir), base);

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
        if (/\/(search|styleguide)$/.test(path)) return false;
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
