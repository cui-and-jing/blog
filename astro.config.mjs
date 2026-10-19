import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const site = process.env.BLOG_SITE ?? 'https://cui-and-jing.github.io';
const base = process.env.BLOG_BASE ?? '/blog';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [mdx(), sitemap()],
  markdown: {
    theme: 'github-dark',
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});
