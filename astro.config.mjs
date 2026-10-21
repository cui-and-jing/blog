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
      /* 搜索页是纯客户端工具，排版样例页是给作者自己查的，都不该进搜索结果 */
      filter: (page) => !/\/(search|styleguide)$/.test(page.replace(/\/$/, '')),
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
