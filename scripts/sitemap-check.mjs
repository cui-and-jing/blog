import { auditSitemap } from './lib/sitemap-contract.mjs';

const result = auditSitemap({
  dist: process.argv[2] ?? 'dist',
  site: process.env.BLOG_SITE ?? 'https://cui-and-jing.github.io',
  base: process.env.BLOG_BASE ?? '/blog',
});
console.log('Sitemap contract: ' + result.maps + ' XML maps, ' + result.pages
  + ' indexed routes, ' + result.noteRoutes + ' note-affected routes');
if (result.errors.length) {
  for (const error of result.errors.slice(0, 30)) console.error('✗ ' + error);
  if (result.errors.length > 30) console.error('... and ' + (result.errors.length - 30) + ' more');
  process.exitCode = 1;
} else {
  console.log('✓ Sitemap pages, noindex exclusions, robots and note-tag lastmod verified');
}
