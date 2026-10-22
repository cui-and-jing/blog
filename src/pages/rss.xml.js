import rss from '@astrojs/rss';
import { SITE, base } from '../lib/site';
import { getPosts } from '../lib/posts';

const FALLBACK_ORIGIN = 'https://cui-and-jing.github.io';

export async function GET(context) {
  const origin = new URL(context.site ?? FALLBACK_ORIGIN).origin;
  const sorted = await getPosts();

  /* 阅读器里没有站点上下文：正文中的 /blog/... 与 #锚点 都得补成绝对地址 */
  const absolutize = (html, pageLink) =>
    html
      .replace(/(\s(?:href|src))="(\/[^"]*)"/g, (_, attr, path) => `${attr}="${origin}${path}"`)
      .replace(/(\s(?:href|src))="#([^"]*)"/g, (_, attr, hash) => `${attr}="${pageLink}#${hash}"`);

  const items = sorted.map((post) => {
    const link = new URL(`${base}/posts/${post.id}/`, context.site ?? FALLBACK_ORIGIN).href;
    const html = absolutize(post.rendered?.html ?? '', link);

    return {
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link,
      /* 除摘要外再给一份全文：订阅器里能直接读完，不必跳回站内。
         库会按 XML 规则转义，阅读器解析后拿到的就是原始 HTML */
      content: html || undefined,
    };
  });

  const latest = sorted.reduce((acc, post) => {
    const stamp = Math.max(post.data.date.valueOf(), post.data.updated?.valueOf() ?? 0);
    return Math.max(acc, stamp);
  }, 0);

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: new URL(`${base}/`, context.site ?? FALLBACK_ORIGIN).href,
    items,
    xmlns: { content: 'http://purl.org/rss/1.0/modules/content/' },
    customData: [
      `<language>${SITE.lang}</language>`,
      latest ? `<lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>` : '',
    ].join(''),
  });
}
