import type { APIRoute } from 'astro';
import rss from '@astrojs/rss';
import { SITE, base } from '../lib/site';
import { findAuthor } from '../data/authors';
import { getNotes, noteText, noteTitle } from '../lib/notes';

const FALLBACK_ORIGIN = 'https://cui-and-jing.github.io';
const COPYRIGHT = `© ${SITE.since} ${SITE.author} · 文字采用 CC BY-NC-SA 4.0`;

/**
 * 笔记单独一份 feed：主 feed 只放文章，订阅「文章」的人不该被短句刷屏。
 * 每条笔记指向自己的独立页（有分享卡），阅读器里也能直接读完全文。
 */
export const GET: APIRoute = async (context) => {
  const origin = new URL(context.site ?? FALLBACK_ORIGIN).origin;
  const notes = await getNotes();

  const absolutize = (html: string, pageLink: string) =>
    html
      .replace(/(\s(?:href|src))="(\/[^"]*)"/g, (_, attr: string, path: string) => `${attr}="${origin}${path}"`)
      .replace(/(\s(?:href|src))="#([^"]*)"/g, (_, attr: string, hash: string) => `${attr}="${pageLink}#${hash}"`);

  const items = notes.map((note) => {
    const link = new URL(`${base}/notes/${note.id}/`, context.site ?? FALLBACK_ORIGIN).href;
    /* 构建期每个条目都带 rendered.html；类型定义里没有，取一次即可 */
    const html = absolutize((note as { rendered?: { html?: string } }).rendered?.html ?? '', link);
    const author = findAuthor(note.data.author);

    return {
      title: noteTitle(note, 60),
      pubDate: note.data.date,
      description: noteText(note).slice(0, 200),
      link,
      customData: `<dc:creator>${author.name}</dc:creator>`,
      content: html || undefined,
    };
  });

  const latest = notes.reduce((acc, note) => Math.max(acc, note.data.date.valueOf()), 0);
  const selfUrl = new URL(`${base}/notes.xml`, context.site ?? FALLBACK_ORIGIN).href;

  return rss({
    title: `${SITE.title} · 笔记`,
    description: '短句、碎片和还没长成文章的想法。',
    site: new URL(`${base}/notes/`, context.site ?? FALLBACK_ORIGIN).href,
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
      '<ttl>1440</ttl>',
      latest ? `<lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>` : '',
    ].join(''),
  });
};
