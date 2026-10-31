import type { CollectionEntry } from 'astro:content';
import { url } from './site';
import { latestActivity } from './recent-date.mjs';
import { sharedSeriesTags } from './series-tags.mjs';
import SERIES_META from '../data/series.json';

export type Post = CollectionEntry<'posts'>;

interface SeriesMeta {
  title?: string;
  description?: string;
}

const meta = SERIES_META as Record<string, SeriesMeta>;

export interface Series {
  name: string;
  title: string;
  href: string;
  description: string;
  posts: Post[];
  count: number;
  start: Date;
  end: Date;
  /** Publication range and editorial activity are different dates. */
  lastActivity: Date;
  /** 系列内文章共同出现过的标签，用来给页面一点线索 */
  tags: string[];
  latest: Post;
}

/** 系列内的顺序：先看 seriesOrder，没写的按日期垫后 */
export function sortByOrder(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const ao = a.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.data.date.valueOf() - b.data.date.valueOf();
  });
}

function build(name: string, posts: Post[]): Series {
  const ordered = sortByOrder(posts);
  const dates = ordered.map((post) => post.data.date.valueOf());
  return {
    name,
    title: meta[name]?.title ?? name,
    href: url(`/series/${encodeURIComponent(name)}/`),
    description: meta[name]?.description ?? '',
    posts: ordered,
    count: ordered.length,
    start: new Date(Math.min(...dates)),
    end: new Date(Math.max(...dates)),
    lastActivity: latestActivity(ordered.map((post) => post.data))!,
    tags: sharedSeriesTags(ordered),
    latest: ordered.reduce((a, b) => (a.data.date > b.data.date ? a : b)),
  };
}

/** 全部系列，最近更新的排前面；少于 2 篇的不算系列 */
export function collectSeries(posts: Post[]): Series[] {
  const byName = new Map<string, Post[]>();
  for (const post of posts) {
    const name = post.data.series;
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(post);
  }
  return [...byName.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => build(name, list))
    .sort((a, b) => b.lastActivity.valueOf() - a.lastActivity.valueOf());
}

export function findSeries(posts: Post[], name: string): Series | undefined {
  const list = posts.filter((post) => post.data.series === name);
  return list.length > 1 ? build(name, list) : undefined;
}

/** 文章在系列里的位置，用于「第 n / N 篇」 */
export function positionIn(series: Series, post: Post): number {
  return series.posts.findIndex((item) => item.id === post.id);
}
