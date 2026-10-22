export const SITE = {
  title: 'Cui & Jing',
  tagline: '关于技术、阅读与生活的长期笔记',
  description: '一个慢慢写的地方。关于技术、阅读与生活，不追热点，只写想清楚的事。',
  author: 'Cui & Jing',
  lang: 'zh-CN',
  since: 2026,
  github: 'https://github.com/cui-and-jing',
};

export const NAV = [
  { label: '文章', href: '/posts/' },
  { label: '笔记', href: '/notes/' },
  { label: '系列', href: '/series/' },
  { label: '归档', href: '/archive/' },
  { label: '标签', href: '/tags/' },
  { label: '游戏', href: '/games/' },
  { label: '关于', href: '/about/' },
];

export interface Game {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
  facts: { value: string; label: string }[];
  /** public/ 下的单文件游戏路径 */
  file: string;
  accent: [string, string];
}

export const GAMES: Game[] = [
  {
    slug: 'beanrush',
    title: 'BEAN RUSH 7',
    subtitle: '糖河奇遇',
    description:
      '四个岛屿、九种竞技场、双人同屏的 3D 派对游戏。可以一个人和 AI 逐关挑战，也可以两个人挤在一台电脑上互相推搡，把糖包搬回自家仓库。',
    tags: ['Three.js', '3D 派对', '离线单机'],
    facts: [
      { value: '9', label: '种竞技场' },
      { value: '16', label: '人同场' },
      { value: '12', label: '关挑战' },
      { value: '双人', label: '同屏对战' },
    ],
    file: '/games/beanrush.html',
    accent: ['#ff4e95', '#ff9c6b'],
  },
];

/** Astro 的 BASE_URL 以 / 结尾，统一去掉，便于拼接 */
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function url(path = '/'): string {
  const clean = path.replace(/^\//, '');
  return `${base}/${clean}`;
}

/** public/ 下的静态资源统一带 base 前缀；外链原样返回 */
export function mediaUrl(path: string): string {
  if (/^(https?:)?\/\//.test(path)) return path;
  if (path.startsWith(`${base}/`)) return path;
  return url(path);
}

export function formatDate(date: Date): string {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

export function readingTime(body: string): number {
  if (!body) return 1;
  const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, '');
  return Math.max(1, Math.round(text.length / 400));
}

export function daysSince(year: number): number {
  const start = new Date(year, 0, 1).getTime();
  return Math.max(1, Math.floor((Date.now() - start) / 86_400_000) + 1);
}

/** 由字符串得到稳定色相（0-359），用于彩色标签 */
export function tagHue(tag: string): number {
  let h = 5381;
  for (let i = 0; i < tag.length; i += 1) {
    h = (h * 33) ^ tag.charCodeAt(i);
  }
  return Math.abs(h) % 360;
}
