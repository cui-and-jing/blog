/**
 * Reduce Markdown to plain search terms while preserving meaningful hyphens.
 * Structural list markers, horizontal rules and fenced code are not part of the prose.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function plain(markdown) {
  // Fenced code can use backticks or tildes; a closing fence must use the
  // same marker and be at least as long. An unclosed fence hides the rest.
  let fence = '';
  const prose = markdown.split(/\r?\n/).filter((line) => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length
          && !line.slice(match[0].length).trim()) fence = '';
      return false;
    }
    if (match) {
      fence = match[1];
      return false;
    }
    return true;
  }).join('\n');

  return prose
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
