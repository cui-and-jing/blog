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
      // A backtick fence cannot have backticks in its info string (CommonMark).
      // An inline code span at line start must not swallow all following prose.
      if (match[1][0] === '`' && line.slice(match[0].length).includes('`')) return true;
      fence = match[1];
      return false;
    }
    return true;
  }).join('\n');

  // Match actual HTML elements/comments, not mathematical comparisons such as x < 10.
  return prose
    .replace(/```[\s\S]*?```/g, ' ')
    // Preserve generic type parameters after identifiers; remove actual HTML tags.
    // Closing tags are stripped independently from opening tags.
    .replace(/<!--[\s\S]*?-->|<\/[A-Za-z][^>]*>|(?<![\p{L}\p{N}_])<[A-Za-z][^>]*>|<![A-Za-z][^>]*>/gu, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // CommonMark ATX headings need a space after 1–6 leading hashes.
    // Keep inline hashes in technical terms like C# and F#.
    .replace(/^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/gm,
      (_line, heading) => heading.replace(/[ \t]+#+[ \t]*$/, ''))
    .replace(/(^|\n)[ \t]*-[ \t]+/g, '$1 ')
    .replace(/(^|\n)[ \t]*-{3,}(?=[ \t]*(?:\n|$))/g, '$1 ')
    // Only line-start blockquote markers are formatting; inline > is searchable.
    .replace(/(^|\n)[ \t]{0,3}(?:>[ \t]?)+/g, '$1')
    .replace(/[*_~`|=]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
