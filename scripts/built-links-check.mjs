/**
 * Audit the actual static-site output, not only authored Markdown links.
 * Usage: npm run links:check (after npm run build).
 */
import path from 'node:path';
import { auditBuiltLinks } from './lib/built-links.mjs';

const result = auditBuiltLinks({
  dist: path.resolve(process.argv[2] || 'dist'),
  base: process.env.BLOG_BASE || '/blog',
  site: process.env.BLOG_SITE || 'https://cui-and-jing.github.io',
});

console.log('Built site links: ' + result.pages + ' HTML pages, ' + result.references + ' references');
if (result.errors.length) {
  for (const entry of result.errors.slice(0, 35)) {
    console.error('✗ ' + entry.page + ': ' + entry.value + ' — ' + entry.reason);
  }
  if (result.errors.length > 35) console.error('... and ' + (result.errors.length - 35) + ' more');
  console.error('FAIL ' + result.errors.length + ' invalid emitted links/resources');
  process.exitCode = 1;
} else {
  console.log('✓ All emitted internal navigation links, media and existing anchors resolve');
}
