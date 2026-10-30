import type { APIRoute } from 'astro';
import { url, formatDate, readingTime } from '../lib/site';
import { getPosts } from '../lib/posts';
import { getNotes, noteText, noteTitle } from '../lib/notes';
import { activityDate } from '../lib/recent-date.mjs';

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

type Entry = {
  type: 'post' | 'note';
  title: string;
  description: string;
  date: string;
  /** Later editorial update; the publication date remains unchanged. */
  updated?: string;
  category: string;
  tags: string[];
  minutes: number;
  href: string;
  text: string;
};

export const GET: APIRoute = async () => {
  const posts = (await getPosts()).map<Entry>((post) => {
    const latest = activityDate(post.data);
    return {
      type: 'post',
      title: post.data.title,
      description: post.data.description,
      date: formatDate(post.data.date),
      updated: latest.getTime() > post.data.date.getTime() ? formatDate(latest) : undefined,
      category: post.data.category ?? '',
      tags: post.data.tags,
      minutes: readingTime(post.body ?? ''),
      href: url(`/posts/${post.id}/`),
      text: plain(post.body ?? '').slice(0, 6000),
    };
  });

  /* 笔记排在文章后面：空查询时列表仍以文章为主，搜索时两类一起参与打分 */
  const notes = (await getNotes()).map<Entry>((note) => {
    const text = noteText(note);
    return {
      type: 'note',
      title: noteTitle(note),
      description: text.slice(0, 120),
      date: formatDate(note.data.date),
      category: '',
      tags: note.data.tags,
      minutes: 0,
      href: url(`/notes/${note.id}/`),
      text: text.slice(0, 2000),
    };
  });

  return new Response(JSON.stringify({ posts: [...posts, ...notes] }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
