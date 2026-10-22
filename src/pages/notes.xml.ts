import type { APIRoute } from 'astro';
import rss from '@astrojs/rss';
import { SITE, base } from '../lib/site';
import { getNotes, noteAnchor, noteText, noteTitle } from '../lib/notes';

const FALLBACK_ORIGIN = 'https://cui-and-jing.github.io';

/**
 * 笔记单独一份 feed：主 feed 只放文章，订阅「文章」的人不该被短句刷屏。
 * 每条笔记的链接落在 /notes/ 的锚点上，正文也一起给，阅读器里能直接读完。
 */
export const GET: APIRoute = async (context) => {
  const origin = new URL(context.site ?? FALLBACK_ORIGIN).origin;
  const notes = await getNotes();

  const absolutize = (html: string, pageLink: string) =>
    html
      .replace(/(\s(?:href|src))="(\/[^"]*)"/g, (_, attr: string, path: string) => `${attr}="${origin}${path}"`)
      .replace(/(\s(?:href|src))="#([^"]*)"/g, (_, attr: string, hash: string) => `${attr}="${pageLink}#${hash}"`);

  const items = notes.map((note) => {
    const link = new URL(`${base}/notes/#${noteAnchor(note)}`, context.site ?? FALLBACK_ORIGIN).href;
    /* 构建期每个条目都带 rendered.html；类型定义里没有，取一次即可 */
    const html = absolutize((note as { rendered?: { html?: string } }).rendered?.html ?? '', link);

    return {
      title: noteTitle(note, 60),
      pubDate: note.data.date,
      description: noteText(note).slice(0, 200),
      link,
      content: html || undefined,
    };
  });

  const latest = notes.reduce((acc, note) => Math.max(acc, note.data.date.valueOf()), 0);

  return rss({
    title: `${SITE.title} · 笔记`,
    description: '短句、碎片和还没长成文章的想法。',
    site: new URL(`${base}/notes/`, context.site ?? FALLBACK_ORIGIN).href,
    items,
    xmlns: { content: 'http://purl.org/rss/1.0/modules/content/' },
    customData: [
      `<language>${SITE.lang}</language>`,
      latest ? `<lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>` : '',
    ].join(''),
  });
};
