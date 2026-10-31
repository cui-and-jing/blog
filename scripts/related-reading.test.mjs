/**
 * Assert the article "接着读" cards respect the same sequence as the
 * published series timeline, rather than reversing chapters by post date.
 * Run after npm run build. No browser or runtime dependency is needed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { relatedTagRelevance } from '../src/lib/related-tags.mjs';

const root = path.resolve('dist');
const seriesDir = path.join(root, 'series');
const findSeriesPages = (dir) => {
  const pages = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) pages.push(...findSeriesPages(full));
    else if (entry.name === 'index.html' && dir !== seriesDir) pages.push(full);
  }
  return pages;
};

const seriesPages = findSeriesPages(seriesDir);
assert.ok(seriesPages.length, 'expected at least one generated multi-article series');

const anchors = (markup) => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)]
  .map((match) => match[1].replace(/&amp;/g, '&'));

const articlePage = (href) => {
  assert.match(href, /^\/blog\/posts\/[^/]+\/$/, 'series links must be article permalinks');
  const route = decodeURIComponent(href.replace(/^\/blog\//, ''));
  return fs.readFileSync(path.join(root, route, 'index.html'), 'utf8');
};

let checked = 0;
for (const seriesPage of seriesPages) {
  const seriesHtml = fs.readFileSync(seriesPage, 'utf8');
  const list = seriesHtml.match(/<ol\b[^>]*class="series-timeline"[^>]*>([\s\S]*?)<\/ol>/);
  assert.ok(list, seriesPage + ': missing series timeline');
  const ordered = anchors(list[1]);
  assert.ok(ordered.length >= 2, seriesPage + ': series must have two or more chapters');
  assert.equal(new Set(ordered).size, ordered.length, 'duplicate series chapter href');

  for (let index = 0; index < ordered.length; index++) {
    const current = ordered[index];
    const html = articlePage(current);
    const section = html.match(/<ul\b[^>]*class="related-grid"[^>]*>([\s\S]*?)<\/ul>/);
    assert.ok(section, current + ': missing related reading cards');
    const cards = [...section[1].matchAll(/<li\b[^>]*class="related-card"[^>]*>([\s\S]*?)<\/li>/g)]
      .map((match) => ({ href: anchors(match[1])[0], html: match[1] }));
    assert.ok(cards.length <= 3 && cards.length > 0, current + ': invalid related card count');
    assert.equal(new Set(cards.map((card) => card.href)).size, cards.length,
      current + ': duplicate related cards');
    assert.ok(!cards.some((card) => card.href === current), current + ': self recommendation');

    const chapters = [...ordered.slice(index + 1), ...ordered.slice(0, index).reverse()]
      .slice(0, 3);
    assert.deepEqual(cards.slice(0, chapters.length).map((card) => card.href), chapters,
      current + ': related cards must suggest following chapters before earlier chapters');
    assert.ok(cards.slice(0, chapters.length).every((card) => card.html.includes('同一系列')),
      current + ': series recommendations must keep their visible reason');
    checked += 1;
  }
}
console.log('✓ Series-related recommendations: ' + checked +
  ' article pages follow published chapter order and exclude duplicates/self');

const currentTags = ['CSS', 'CSS', 'Astro'];
const candidateTags = ['CSS', 'CSS', 'Astro', 'Astro', 'other', 'other'];
const originalCurrent = [...currentTags];
const originalCandidate = [...candidateTags];
assert.deepEqual(relatedTagRelevance([], []), { score: 0, reason: '' },
  'empty tags produce zero relevance');
assert.deepEqual(relatedTagRelevance(currentTags, ['unrelated', 'unrelated']),
  { score: 0, reason: '' }, 'unrelated repeats do not count');
assert.deepEqual(relatedTagRelevance(currentTags, ['CSS', 'CSS', 'CSS']),
  { score: 2, reason: '#CSS' }, 'repeating one label cannot inflate the score');
assert.deepEqual(relatedTagRelevance(currentTags, candidateTags),
  { score: 4, reason: '#CSS #Astro' }, 'each overlapping label counts once');
assert.deepEqual(relatedTagRelevance(['CSS', 'Astro', '博客'], ['博客', '博客', 'CSS', 'Astro']),
  { score: 6, reason: '#博客 #CSS' }, 'more unique tags increase score but the reason shows two');
assert.deepEqual(relatedTagRelevance(['A', 'B'], ['B', 'A', 'A', 'B']),
  { score: 4, reason: '#B #A' }, 'reason follows candidate tag order');
assert.ok(relatedTagRelevance(['A', 'B'], ['A', 'B']).score >
  relatedTagRelevance(['A', 'B'], ['A', 'A', 'A']).score,
  'two genuine shared tags outrank one repeatedly authored tag');
assert.deepEqual(currentTags, originalCurrent, 'current article tags stay unchanged');
assert.deepEqual(candidateTags, originalCandidate, 'candidate article tags stay unchanged');
console.log('✓ Related tag relevance: 9 unique-overlap, ranking, reason and non-mutation assertions');
