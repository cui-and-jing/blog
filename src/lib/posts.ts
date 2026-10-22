import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

/**
 * 草稿只在 `astro dev` 里出现，方便写一半先看排版。
 *
 * 构建时 `import.meta.env.DEV` 恒为 false，所以 RSS、sitemap、搜索索引
 * 这些在构建期生成的产物都不会把草稿带出去——判断只写在这一处。
 */
export const showDrafts = import.meta.env.DEV;

export const isDraft = (post: Post): boolean => post.data.draft === true;

/** 取全部文章，按日期倒序。调用方不用再排一次。 */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => showDrafts || !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
