import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const site = process.env.BLOG_SITE ?? 'https://cui-and-jing.github.io';
const base = process.env.BLOG_BASE ?? '/blog';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [
    mdx(),
    sitemap({
      /* 搜索页是纯客户端工具，没有独立内容，放进 sitemap 只是让爬虫白跑一趟 */
      filter: (page) => !page.replace(/\/$/, '').endsWith('/search'),
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
