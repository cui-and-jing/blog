/** First-visit transfer-budget fixtures shared by the browser runner and post-build contract.
 * Keep per-route limits unchanged; a stale 404 must never pass as a small page.
 */
/**
 * 每条路由的上限（KB，含 gzip）。
 * 留 8% 左右的余量：卡到小数点后一位那种预算只会逼人改数字，不会促成优化。
 * 2026-10-23 实测：首页 210.8、文章 241.1、笔记 206.5、关于 222.9。
 */
export const WIRE_ROUTES = [
  { path: '/', label: '首页', limit: 230 },
  { path: '/posts/hello-astro/', label: '文章（有配图）', limit: 265 },
  { path: '/posts/writing-workflow/', label: '文章（长文）', limit: 265 },
  { path: '/notes/2026-10-22-1015/', label: '笔记', limit: 230 },
  { path: '/about/', label: '关于', limit: 250 },
  { path: '/archive/', label: '归档', limit: 240 },

  /* 游戏页单独一组。beanrush 把 three.js 内联在单文件里，是站内最重的单页；
     量的是外层试玩页，iframe 的字节也算在总数里——那才是真实首访代价。
     2026-10-25 实测：大厅 200.2、BEAN RUSH 351.6（0 字体）、其余 9.1–9.9。
     大厅重是因为它是普通站点页，要吃 150KB 字体 + 全站 CSS，不是游戏本体的问题。 */
  { path: '/games/', label: '游戏大厅', limit: 220 },
  { path: '/games/beanrush/', label: 'BEAN RUSH', limit: 385 },
  { path: '/games/pixelraid/', label: 'PIXEL RAID', limit: 65 },
];


/** Reject a failed HTTP navigation, including missing responses (e.g. aborted requests). */
export function assertNavigationOk(response, path) {
  if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'no response'} at ${path}`);
}
