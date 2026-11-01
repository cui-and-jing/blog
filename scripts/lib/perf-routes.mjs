/** Route fixtures for the manual performance profiler.
 * Shared with the post-build contract so removed site routes cannot silently produce 404 metrics.
 */
export const ROUTES = [
  { path: '/', name: '首页', type: 'home' },
  { path: '/posts/hello-astro/', name: '文章页', type: 'post' },
  { path: '/notes/', name: '笔记列表', type: 'list' },
  { path: '/tags/Astro/', name: '标签聚合', type: 'list' },
  { path: '/games/', name: '游戏大厅', type: 'list' },
  { path: '/games/pixelraid/', name: '游戏试玩', type: 'game' },
];
