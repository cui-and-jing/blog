/**
 * Choose labels shared by at least two distinct articles in a series.
 * A repeated label inside one article is still only one occurrence.
 * Equal-frequency tags retain their first appearance in reading order.
 * @param {Iterable<{data: {tags: string[]}}>} posts
 * @param {number} [limit]
 * @returns {string[]}
 */
export function sharedSeriesTags(posts, limit = 4) {
  const counts = new Map();
  for (const post of posts) {
    for (const tag of new Set(post.data.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
    .slice(0, limit);
}
