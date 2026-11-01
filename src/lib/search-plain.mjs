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
    // Reference destinations and image alt labels are not readable prose.
    // Reference definitions may continue with an indented destination and title.
    // Exclude these invisible lines before stripping ordinary link markup.
    .replace(/^ {0,3}\[[^\]\n]+\]:[ \t]*\n[ \t]+(?:<[^>\n]+>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?(?:\n[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*$/gm, ' ')
    .replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*(?:\n[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))[ \t]*$/gm, ' ')
    .replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*$/gm, ' ')
    // HTML code and embedded scripts/styles are not article prose.
    .replace(/<(pre|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![A-Za-z][^>]*>/g,
      (tag, index, source) => {
        // Generic type arguments follow an identifier, unlike standalone HTML tags.
        // Paired inline HTML immediately after text still loses its markup.
        if (tag[1] !== '/' && /^<[A-Za-z]/.test(tag)
            && /[\p{L}\p{N}_]/u.test(source[index - 1] ?? '')) {
          const name = /^<([A-Za-z][\w-]*)/.exec(tag)?.[1];
          if (name && !tag.endsWith('/>')
              && !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(name)
              && !source.slice(index + tag.length).includes('</' + name + '>')) return tag;
        }
        return ' ';
      })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/!\[[^\]\n]*\](?:\[[^\]\n]*\])?/g, ' ')
    // Preserve link labels for full/collapsed reference-style Markdown links.
    .replace(/\[([^\]\n]*)\]\[[^\]\n]*\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // CommonMark ATX headings need a space after 1–6 leading hashes.
    // Keep inline hashes in technical terms like C# and F#.
    .replace(/^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/gm,
      (_line, heading) => heading.replace(/[ \t]+#+[ \t]*$/, ''))
    .replace(/(^|\n)[ \t]*-[ \t]+/g, '$1 ')
    .replace(/(^|\n)[ \t]*-{3,}(?=[ \t]*(?:\n|$))/g, '$1 ')
    // Only line-start blockquote markers are formatting; inline > is searchable.
    .replace(/(^|\n)[ \t]{0,3}(?:>[ \t]?)+/g, '$1')
    .replace(/[*~`|=]+/g, ' ')
    // Underscores inside identifiers are searchable; outside them they mark emphasis.
    .replace(/_+/g, (marks, at, text) =>
      /[\p{L}\p{N}]/u.test(text[at - 1] ?? '')
      && /[\p{L}\p{N}]/u.test(text[at + marks.length] ?? '') ? marks : ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
