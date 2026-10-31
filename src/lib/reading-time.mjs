import { plain } from './search-plain.mjs';

/** Estimate prose reading time, excluding fenced code, URLs and Markdown syntax. */
export function readingTime(body) {
  if (!body) return 1;
  return Math.max(1, Math.round(plain(body).replace(/\s+/g, '').length / 400));
}
