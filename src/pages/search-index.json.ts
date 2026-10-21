import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { url, formatDate, readingTime } from '../lib/site';

/** 把 Markdown 粗略压成可检索的纯文本，保留中文与英文词 */
function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|=\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const GET: APIRoute = async () => {
  const all = await getCollection('posts', ({ data }) => !data.draft);
  const posts = all
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .map((post) => ({
      title: post.data.title,
      description: post.data.description,
      date: formatDate(post.data.date),
      category: post.data.category ?? '',
      tags: post.data.tags,
      minutes: readingTime(post.body ?? ''),
      href: url(`/posts/${post.id}/`),
      text: plain(post.body ?? '').slice(0, 6000),
    }));

  return new Response(JSON.stringify({ posts }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
