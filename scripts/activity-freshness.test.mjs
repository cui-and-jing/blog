/**
 * Homepage "最近更新" and series discovery must count edited articles,
 * while preserving the original publication dates on article/series pages.
 * Runs after build in CI and local preflight.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { activityDate, latestActivity } from '../src/lib/recent-date.mjs';
import { readEntries } from './lib/sitemap-metadata.mjs';

const stamp = (s) => new Date(s + 'T00:00:00.000Z');
const day = (value) => value?.toISOString().slice(0, 10);
assert.equal(latestActivity([]), undefined, 'empty content should not invent a date');
assert.equal(day(latestActivity([{ date: stamp('2026-10-10') }])), '2026-10-10');
assert.equal(day(latestActivity([
  { date: stamp('2026-10-20'), updated: stamp('2026-10-01') },
  { date: stamp('2026-10-07'), updated: stamp('2026-10-29') },
  { date: stamp('2026-10-22') },
])), '2026-10-29', 'edited older article should advance latest activity');
assert.equal(day(latestActivity([
  { date: stamp('2026-10-20'), updated: stamp('2026-10-01') },
  { date: stamp('2026-10-22') },
])), '2026-10-22', 'an earlier edit must not regress the newest date');
assert.equal(day(latestActivity([{ date: stamp('2026-10-30') }])), '2026-10-30',
  'note-only activity should be supported');
assert.equal(day(activityDate({ date: stamp('2026-10-20'), updated: new Date('bad') })),
  '2026-10-20', 'invalid update should not supersede publication');

const root = path.resolve('dist');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const homepage = read('index.html');
const records = JSON.parse(read('search-index.json')).posts;
assert.ok(Array.isArray(records) && records.length, 'search index must contain published content');
const instant = (date) => {
  assert.match(date, /^\d{4}\.\d{2}\.\d{2}$/, 'bad published activity date: ' + date);
  return Date.parse(date.replaceAll('.', '-') + 'T00:00:00Z');
};
const latestStamp = Math.max(...records.map((item) => instant(item.updated ?? item.date)));
const expectedDate = new Date(latestStamp).toISOString().slice(0, 10).replaceAll('-', '.');
const hero = homepage.match(/<span class="stat"><b>(\d{4}\.\d{2}\.\d{2})<\/b> 最近更新<\/span>/);
assert.ok(hero, 'homepage hero missing its latest activity date');
assert.equal(hero[1], expectedDate,
  'homepage latest update does not match newest published post edit or note');
assert.ok(records.every((item) => !item.updated || (item.type === 'post' && instant(item.updated) > instant(item.date))),
  'the search index must retain publication dates and only expose later revisions');

const publishedPosts = readEntries(path.resolve('src/content/posts'));
const series = new Map();
for (const post of publishedPosts) {
  if (!post.series) continue;
  if (!series.has(post.series)) series.set(post.series, []);
  series.get(post.series).push(post);
}
const activityBySeries = new Map([...series].filter(([, list]) => list.length > 1)
  .map(([name, list]) => [
    '/blog/series/' + encodeURIComponent(name) + '/',
    Math.max(...list.map((post) => post.date.valueOf())),
  ]));
const html = read('series/index.html');
const listing = [...html.matchAll(/<article class="series-card">[\s\S]*?<h2>\s*<a href="([^"]+)"/g)]
  .map((match) => match[1].replaceAll('&amp;', '&'));
assert.equal(listing.length, activityBySeries.size, 'series directory is incomplete');
assert.equal(new Set(listing).size, listing.length, 'duplicate series directory links');
for (let i = 0; i < listing.length; i++) {
  assert.ok(activityBySeries.has(listing[i]), 'unexpected series route ' + listing[i]);
  if (i) assert.ok(activityBySeries.get(listing[i - 1]) >= activityBySeries.get(listing[i]),
    'series directory not sorted by editorial activity');
}
const homeSeries = [...homepage.matchAll(/<h3><a href="(\/blog\/series\/[^"]+)"/g)]
  .map((match) => match[1].replaceAll('&amp;', '&'));
assert.deepEqual(homeSeries, listing.slice(0, 2),
  'homepage series previews must match the first two active series');
console.log('✓ Home hero activity matches published search index; series preview/list dates preserve revisions');
