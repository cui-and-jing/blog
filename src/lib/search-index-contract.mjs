/**
 * Fail the build before publishing an unusable search index.
 * Client-side fallback still handles network errors; this contract protects
 * the JSON our own build emits, not third-party or corrupted HTTP responses.
 */
export function assertSearchEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('Search index needs an entries array');
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const fail = (detail) => { throw new Error(`Search index entry #${index}: ${detail}`); };
    if (!entry || (entry.type !== 'post' && entry.type !== 'note')) fail('invalid type');
    for (const key of ['title', 'description', 'date', 'category', 'href', 'text']) {
      if (typeof entry[key] !== 'string') fail(`${key} must be a string`);
    }
    if (!entry.title.trim() || !entry.date || !entry.href.startsWith('/')) fail('missing title, date or path');
    if (entry.updated !== undefined && typeof entry.updated !== 'string') fail('updated must be a string');
    if (!Array.isArray(entry.tags) || !entry.tags.every((tag) => typeof tag === 'string')) {
      fail('tags must be strings');
    }
    if (!Number.isFinite(entry.minutes) || entry.minutes < 0) fail('minutes must be nonnegative');
    if (seen.has(entry.href)) fail(`duplicate path: ${entry.href}`);
    seen.add(entry.href);
  }
}
