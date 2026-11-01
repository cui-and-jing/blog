import type { APIRoute } from 'astro';
import { url, formatDate, readingTime, base } from '../lib/site';
import { getPosts } from '../lib/posts';
import { getNotes, noteText, noteTitle, noteExcerpt } from '../lib/notes';
import { activityDate } from '../lib/recent-date.mjs';
import { uniqueSearchTags } from '../lib/search-tags.mjs';
import { plain } from '../lib/search-plain.mjs';
import { assertSearchEntries } from '../lib/search-index-contract.mjs';

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
      tags: uniqueSearchTags(post.data.tags),
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
      // Search previews should continue after the title's complete first sentence.
      // For a single-sentence note, keep the original text instead of an empty preview.
      description: noteExcerpt(note, 120) || text.slice(0, 120),
      date: formatDate(note.data.date),
      category: '',
      tags: uniqueSearchTags(note.data.tags),
      minutes: 0,
      href: url(`/notes/${note.id}/`),
      text: text.slice(0, 2000),
    };
  });

  const entries = [...posts, ...notes];
  assertSearchEntries(entries, base);
  return new Response(JSON.stringify({ posts: entries }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
