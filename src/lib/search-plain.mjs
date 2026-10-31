/**
 * Reduce Markdown to plain search terms while preserving meaningful hyphens.
 * Structural list markers and horizontal rules are not part of the prose.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function plain(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\n)[ \t]*-[ \t]+/g, '$1 ')
    .replace(/(^|\n)[ \t]*-{3,}(?=[ \t]*(?:\n|$))/g, '$1 ')
    .replace(/[#>*_~`|=]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
