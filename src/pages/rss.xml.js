import rss from '@astrojs/rss';
import { render } from 'astro:content';
import { loadRenderers } from 'astro:container';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getContainerRenderer } from '@astrojs/mdx/container-renderer';
import { mdxComponents } from '../lib/mdx-components';
import { absolutizeFeedHtml } from '../lib/rss-html.mjs';
import { SITE, base } from '../lib/site';
import { findAuthor } from '../data/authors';
import { getPosts } from '../lib/posts';

const FALLBACK_ORIGIN = 'https://cui-and-jing.github.io';
const COPYRIGHT = `© ${SITE.since} ${SITE.author} · 文字采用 CC BY-NC-SA 4.0`;

export async function GET(context) {
  const sorted = await getPosts();

  /* 阅读器里没有站点上下文：正文中的 /blog/... 与 #锚点 都得补成绝对地址 */
  const absolutize = (html, pageLink) =>
    html
      .replace(/(\s(?:href|src))="(\/[^"]*)"/g, (_, attr, path) => `${attr}="${origin}${path}"`)
      .replace(/(\s(?:href|src))="#([^"]*)"/g, (_, attr, hash) => `${attr}="${pageLink}#${hash}"`);

  const items = sorted.map((post) => {
    const link = new URL(`${base}/posts/${post.id}/`, context.site ?? FALLBACK_ORIGIN).href;
    const { Content } = await render(post);
    const rendered = await container.renderToString(Content, { props: { components: mdxComponents } });
    const html = absolutizeFeedHtml(rendered.replace(/^<!DOCTYPE html>/i, ''), link);
    const author = findAuthor(post.data.author);

    return {
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link,
      /* RSS 2.0 的 <author> 要求写成 email (Name)，我们没有公开邮箱；
         dc:creator 就是为这种情况准备的，主流阅读器都认 */
      customData: `<dc:creator>${author.name}</dc:creator>`,
      /* 除摘要外再给一份全文：订阅器里能直接读完，不必跳回站内。
         库会按 XML 规则转义，阅读器解析后拿到的就是原始 HTML */
      content: html || undefined,
    };
  }));

  const latest = sorted.reduce((acc, post) => {
    const stamp = Math.max(post.data.date.valueOf(), post.data.updated?.valueOf() ?? 0);
    return Math.max(acc, stamp);
  }, 0);

  const selfUrl = new URL(`${base}/rss.xml`, context.site ?? FALLBACK_ORIGIN).href;

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: new URL(`${base}/`, context.site ?? FALLBACK_ORIGIN).href,
    items,
    xmlns: {
      content: 'http://purl.org/rss/1.0/modules/content/',
      atom: 'http://www.w3.org/2005/Atom',
      dc: 'http://purl.org/dc/elements/1.1/',
    },
    customData: [
      `<atom:link href="${selfUrl}" rel="self" type="application/rss+xml" />`,
      `<language>${SITE.lang}</language>`,
      `<copyright>${COPYRIGHT}</copyright>`,
      /* 建议阅读器隔一天再来取一次；这只是提示，不是强制的 */
      '<ttl>1440</ttl>',
      latest ? `<lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>` : '',
    ].join(''),
  });
}
