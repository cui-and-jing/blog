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
  { label: '归档', href: '/archive/' },
  { label: '标签', href: '/tags/' },
  { label: '关于', href: '/about/' },
];

/** Astro 的 BASE_URL 以 / 结尾，统一去掉，便于拼接 */
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function url(path = '/'): string {
  const clean = path.replace(/^\//, '');
  return `${base}/${clean}`;
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
