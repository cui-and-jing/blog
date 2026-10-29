import type { APIRoute } from 'astro';
import rss from '@astrojs/rss';
import { render } from 'astro:content';
import { loadRenderers } from 'astro:container';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getContainerRenderer } from '@astrojs/mdx/container-renderer';
import { absolutizeFeedHtml } from '../lib/rss-html.mjs';
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
  const notes = await getNotes();

  const container = await AstroContainer.create({
    renderers: await loadRenderers([getContainerRenderer()]),
  });

  const items = await Promise.all(notes.map(async (note) => {
    const link = new URL(`${base}/notes/${note.id}/`, context.site ?? FALLBACK_ORIGIN).href;
    const { Content } = await render(note);
    const rendered = await container.renderToString(Content);
    const html = absolutizeFeedHtml(rendered.replace(/^<!DOCTYPE html>/i, ''), link);
    const author = findAuthor(note.data.author);

    return {
      title: noteTitle(note, 60),
      pubDate: note.data.date,
      description: noteText(note).slice(0, 200),
      link,
      customData: `<dc:creator>${author.name}</dc:creator>`,
      content: html || undefined,
    };
  }));

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
