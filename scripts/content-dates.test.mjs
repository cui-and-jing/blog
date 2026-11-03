/** Publication dates must not depend on the build machine's timezone. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve('dist');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const calendar = (date) => new Date(date).toISOString().slice(0, 10);
const label = (date) => calendar(date).replaceAll('-', '.');
const fixtures = [
  ['2026-01-01', '2026.01.01', { year: 2026, month: 1, day: 1 }],
  ['2026-03-01', '2026.03.01', { year: 2026, month: 3, day: 1 }],
  ['2024-02-29', '2024.02.29', { year: 2024, month: 2, day: 29 }],
  ['2026-03-08', '2026.03.08', { year: 2026, month: 3, day: 8 }],
  ['2026-11-01', '2026.11.01', { year: 2026, month: 11, day: 1 }],
  ['2026-12-31T23:59:59Z', '2026.12.31', { year: 2026, month: 12, day: 31 }],
  ['2026-01-01T00:30:00+08:00', '2025.12.31', { year: 2025, month: 12, day: 31 }],
  ['2026-12-31T23:30:00-08:00', '2027.01.01', { year: 2027, month: 1, day: 1 }],
];
const expected = fixtures.map(([, full, parts]) => ({ full, short: full.slice(5), parts }));
for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
  const script = `
    import { contentDateParts, formatDate, shortDate } from './src/lib/content-date.mjs';
    console.log(JSON.stringify(${JSON.stringify(fixtures.map(([input]) => input))}.map(input => {
      const date = new Date(input);
      return { full: formatDate(date), short: shortDate(date), parts: contentDateParts(date) };
    })));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: timezone }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${timezone}: ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), expected, `${timezone}: calendar labels or buckets shifted`);
  console.log(`✓ ${timezone}: ${fixtures.length} calendar boundaries`);
}

// Guard the production wiring, not just a helper that templates might stop using.
assert.match(fs.readFileSync('src/lib/site.ts', 'utf8'),
  /export \{ formatDate \} from '\.\/content-date\.mjs'/);
for (const file of ['src/pages/archive.astro', 'src/pages/notes/index.astro']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /import \{ contentDateParts, shortDate \} from/);
  assert.doesNotMatch(source, /\.(?:getFullYear|getMonth|getDate)\s*\(/,
    `${file}: local-time getters must not return to publication-date grouping`);
}

assert.match(fs.readFileSync('scripts/og-cards.mjs', 'utf8'),
  /import \{ formatDate as fmtDate \} from '\.\.\/src\/lib\/content-date\.mjs'/);

const times = (html) => [...html.matchAll(/<time\b([^>]*)>([^<]*)<\/time>/g)]
  .map(([, attrs, text]) => ({ date: attrs.match(/\bdatetime="([^"]+)"/)?.[1], text: text.trim() }));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : file.endsWith('.html') ? [file] : [];
});
let checked = 0;
for (const file of walk(root)) {
  for (const { date, text } of times(fs.readFileSync(file, 'utf8'))) {
    if (!/^(?:\d{4}\.)?\d{2}\.\d{2}$/.test(text)) continue;
    assert.ok(date, `${file}: visible calendar label is missing datetime`);
    assert.equal(text, text.length === 5 ? label(date).slice(5) : label(date),
      `${file}: visible date disagrees with machine-readable datetime`);
    checked++;
  }
}
assert.ok(checked > 0, 'No emitted calendar dates were checked');

const records = JSON.parse(read('search-index.json')).posts;
for (const record of records) {
  const section = record.type === 'post' ? 'posts' : 'notes';
  const slug = decodeURIComponent(new URL(record.href, 'https://example.test').pathname)
    .split(`/${section}/`)[1]?.replace(/\/$/, '');
  assert.ok(slug, 'Search entry must have a content route');
  // Resolve the emitted route instead of guessing its source filename: Astro
  // may normalize case, nested index files or a frontmatter slug override.
  const html = read(`${section}/${slug}/index.html`);
  const meta = (name) => html.match(new RegExp(`<meta[^>]*property="${name}"[^>]*>`))?.[0]
    .match(/content="([^"]+)"/)?.[1];
  const published = record.type === 'post' ? meta('article:published_time')
    : times(html.match(/<p class="note-sheet-meta">([\s\S]*?)<\/p>/)?.[1] ?? '')[0]?.date;
  assert.ok(published, `${record.href}: machine-readable publication date missing`);
  assert.equal(record.date, label(published), `${record.href}: search publication date shifted`);
  const updated = record.type === 'post' ? meta('article:modified_time') : undefined;
  assert.equal(record.updated, updated ? label(updated) : undefined,
    `${record.href}: search revision date shifted`);
}

const archiveGroups = read('archive/index.html').split('<section class="year-group">').slice(1);
let archived = 0;
for (const group of archiveGroups) {
  const year = group.match(/class="year-num">(\d+)</)?.[1];
  assert.ok(year, 'Archive year missing');
  const entries = times(group);
  assert.ok(entries.length, 'Empty archive year');
  const months = new Set();
  for (const { date } of entries) {
    assert.equal(calendar(date).slice(0, 4), year, 'Entry belongs to a different archive year');
    months.add(Number(calendar(date).slice(5, 7)));
    archived++;
  }
  const cells = [...group.matchAll(/class="month-cell( has)?"/g)];
  assert.equal(cells.length, 12, 'Archive needs twelve month cells');
  cells.forEach((cell, index) => assert.equal(Boolean(cell[1]), months.has(index + 1),
    `Archive ${year}: wrong activity in month ${index + 1}`));
}
assert.equal(archived, records.length, 'Archive must include each published article and note');

let groupedNotes = 0;
const noteGroups = read('notes/index.html').split('<section class="note-group"').slice(1);
for (const group of noteGroups) {
  const [, year, month] = group.match(/aria-labelledby="group-(\d+)-(\d+)"/) ?? [];
  assert.ok(year && month, 'Note month identity missing');
  assert.ok(group.includes(`>${year} 年 ${month} 月</h2>`), 'Note heading disagrees with its bucket');
  for (const { date } of times(group)) {
    assert.equal(calendar(date).slice(0, 7), `${year}-${month.padStart(2, '0')}`,
      'Note belongs to a different month');
    groupedNotes++;
  }
}
assert.equal(groupedNotes, records.filter((record) => record.type === 'note').length,
  'Every published note must belong to one calendar month');
console.log(`✓ ${checked} emitted date labels, ${records.length} search dates, archive years/months and note groups agree`);
