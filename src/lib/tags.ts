import type { Post } from './posts';
import type { Note } from './notes';

/**
 * 标签横跨两种内容形态：文章有分类和系列，笔记只有标签。
 * 聚合放在这里，标签首页与标签详情页共用同一套口径——
 * 之前详情页只按文章生成，笔记页链过去的 /tags/CSS/ 直接 404。
 */
export interface TagBucket {
  tag: string;
  posts: Post[];
  notes: Note[];
  /** 文章 + 笔记，用于排序与计数 */
  total: number;
}

const byDateDesc = (a: { data: { date: Date } }, b: { data: { date: Date } }) =>
  b.data.date.valueOf() - a.data.date.valueOf();

export function collectTags(posts: Post[], notes: Note[]): TagBucket[] {
  const buckets = new Map<string, TagBucket>();

  const ensure = (tag: string): TagBucket => {
    let bucket = buckets.get(tag);
    if (!bucket) {
      bucket = { tag, posts: [], notes: [], total: 0 };
      buckets.set(tag, bucket);
    }
    return bucket;
  };

  for (const post of posts) {
    for (const tag of new Set(post.data.tags)) ensure(tag).posts.push(post);
  }
  for (const note of notes) {
    for (const tag of new Set(note.data.tags)) ensure(tag).notes.push(note);
  }

  for (const bucket of buckets.values()) {
    bucket.posts.sort(byDateDesc);
    bucket.notes.sort(byDateDesc);
    bucket.total = bucket.posts.length + bucket.notes.length;
  }

  /* 内容多的排前面；数量相同按名字排，避免每次构建顺序漂移 */
  return [...buckets.values()].sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag, 'zh-CN'));
}
