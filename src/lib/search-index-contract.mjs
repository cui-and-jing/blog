/**
 * Fail the build before publishing an unusable search index.
 * Client-side fallback still handles network errors; this contract protects
 * the JSON our own build emits, not third-party or corrupted HTTP responses.
 */
export function assertSearchEntries(entries, base = '') {
  const siteBase = base.replace(/\/$/, '');
  const validDate = (value) => {
    if (!/^\d{4}\.(?:0[1-9]|1[0-2])\.(?:0[1-9]|[12]\d|3[01])$/.test(value)) return false;
    const [year, month, day] = value.split('.').map(Number);
    if (year === 0) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
  };
  if (!Array.isArray(entries)) throw new Error('Search index needs an entries array');
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const fail = (detail) => { throw new Error(`Search index entry #${index}: ${detail}`); };
    if (!entry || (entry.type !== 'post' && entry.type !== 'note')) fail('invalid type');
    for (const key of ['title', 'description', 'date', 'category', 'href', 'text']) {
      if (typeof entry[key] !== 'string') fail(`${key} must be a string`);
    }
    if (!entry.title.trim() || !entry.date || !entry.href) fail('missing title, date or path');
    if (!validDate(entry.date)) fail('invalid publication date');
    if (entry.updated !== undefined && (typeof entry.updated !== 'string' || !validDate(entry.updated))) {
      fail('invalid updated date');
    }
    // Enforce the same base-relative, typed routes that the search UI expects.
    // Reject protocol-relative URLs, traversal (including encoded dots), and
    // query/fragment suffixes before a malformed index can be published.
    const prefix = `${siteBase}/${entry.type === 'post' ? 'posts' : 'notes'}/`;
    let decoded;
    try { decoded = decodeURIComponent(entry.href); }
    catch { fail('invalid path encoding'); }
    if (!entry.href.startsWith(prefix) || !entry.href.endsWith('/')
        || /[\\?#\s]/.test(entry.href) || entry.href.includes('//')
        || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded)
        || decoded.slice(prefix.length, -1).length === 0) fail('unsafe path');
    if (!Array.isArray(entry.tags) || !entry.tags.every((tag) => typeof tag === 'string')) {
      fail('tags must be strings');
    }
    if (!Number.isFinite(entry.minutes) || entry.minutes < 0) fail('minutes must be nonnegative');
    if (seen.has(entry.href)) fail(`duplicate path: ${entry.href}`);
    seen.add(entry.href);
  }
}
