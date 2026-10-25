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
  /** 封面角标，写体量或特性，别写营销词 */
  badge: string;
  /** 加载遮罩里提示的首屏体量 */
  weight: string;
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
    accent: ['#ff5f9e', '#ff7a6b'],
    badge: '可离线游玩',
    weight: '首次打开约 2MB，之后会走浏览器缓存',
  },
  {
    slug: '2048',
    title: '2048',
    subtitle: '数字合并',
    description:
      '四乘四的格子，相同的数字撞在一起就翻倍。规则一句话说完，难的是别把自己堵死。留了一步撤销，手滑了还能退回来。',
    tags: ['数字', '策略', '离线单机'],
    facts: [
      { value: '4×4', label: '棋盘' },
      { value: '2048', label: '目标' },
      { value: '1', label: '步撤销' },
    ],
    file: '/games/2048.html',
    accent: ['#c05a24', '#9c3a1b'],
    badge: '约 22 KB',
    weight: '约 22KB，一次加载后走缓存',
  },
  {
    slug: 'snake',
    title: 'SNAKE',
    subtitle: '贪吃蛇',
    description:
      '一条越吃越长的线。撞墙、咬到自己都算结束，唯一的难点是它越吃越快。手机横竖滑动都行，电脑用方向键。',
    tags: ['动作', '手速', '离线单机'],
    facts: [
      { value: '21×21', label: '格棋盘' },
      { value: '10', label: '分一颗' },
      { value: '本地', label: '存最高分' },
    ],
    file: '/games/snake.html',
    accent: ['#3f7a52', '#2f6f66'],
    badge: '约 19 KB',
    weight: '约 19KB，一次加载后走缓存',
  },
  {
    slug: 'breakout',
    title: 'BREAKOUT',
    subtitle: '打砖块',
    description:
      '一块板、一颗球、五排砖。板子接球的位置决定反弹角度，所以角度是能自己控的。三条命，清完一屏换下一关。',
    tags: ['街机', '反应', '离线单机'],
    facts: [
      { value: '3', label: '条命' },
      { value: '2', label: '击砖' },
      { value: '∞', label: '关' },
    ],
    file: '/games/breakout.html',
    accent: ['#b04a2c', '#8f3b63'],
    badge: '约 23 KB',
    weight: '约 23KB，一次加载后走缓存',
  },
  {
    slug: 'minesweeper',
    title: 'MINESWEEPER',
    subtitle: '扫雷',
    description:
      '数字是周围八格里地雷的数量。靠推理一格一格排干净，不靠猜。三档难度，第一次点开的那格永远安全。',
    tags: ['推理', '益智', '离线单机'],
    facts: [
      { value: '3', label: '档难度' },
      { value: '99', label: '颗雷' },
      { value: '首次', label: '必安全' },
    ],
    file: '/games/minesweeper.html',
    accent: ['#4a5b6e', '#2b3a4a'],
    badge: '约 24 KB',
    weight: '约 24KB，一次加载后走缓存',
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
