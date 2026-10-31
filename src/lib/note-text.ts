/**
 * 笔记的纯文本处理。
 *
 * 单独一个文件、不碰 astro:content，是因为分享封面脚本（scripts/og-cards.mjs）
 * 在 Node 里跑，也要用同一套规则推导标题与摘要——两处算得不一样，卡片上就会出现
 * 和页面里不同的标题。
 */

/** 把 Markdown 压成一行纯文本 */
export function plainNote(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|=\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 笔记没有标题字段，取正文第一句当标题。
 * 遇到句号/问号/感叹号就断，太长再硬截，最后补省略号。
 */
export function titleFromText(text: string, limit = 40): string {
  if (!text) return '无标题';
  const match = text.match(/^[^。！？!?]{1,120}[。！？!?]/);
  const first = match ? match[0] : text;
  const body = first.replace(/[。！？!?]$/, '');
  return body.length > limit ? `${body.slice(0, limit)}…` : body;
}

/**
 * 摘要应跳过完整的首句，不受标题 40 字截断或旧的 120 字匹配上限影响。
 * 没有句末标点时沿用原行为：从正文开头取摘要。
 */
export function excerptFromText(text: string, limit = 90): string {
  const first = text.match(/^[^。！？!?]+[。！？!?]/)?.[0];
  const rest = first ? text.slice(first.length) : text;
  return rest.replace(/^[。！？!?，、\s]+/, '').slice(0, limit);
}
