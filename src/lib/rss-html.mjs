/**
 * RSS readers do not have the page's base URL. Normalize only URL attributes
 * in trusted, site-authored HTML; this is not an HTML sanitizer.
 */
export function absolutizeFeedHtml(html, pageUrl) {
  return html.replace(/(\s(?:href|src)=)(["'])(.*?)\2/gi, (match, attr, quote, value) => {
    try {
      const target = new URL(value.replace(/&amp;/gi, '&'), pageUrl);
      if (!['https:', 'http:', 'mailto:', 'tel:'].includes(target.protocol)) return '';
      return attr + quote + target.href.replace(/&/g, '&amp;') + quote;
    } catch {
      return match;
    }
  });
}
