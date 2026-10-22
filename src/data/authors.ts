/**
 * 作者档案。
 *
 * 站名是两个人的名字，但在这之前，整站没有任何一处表达「这篇文章是谁写的」：
 * JSON-LD 的 author 写死成站名，RSS 没有 author 字段，文章页也没有署名。
 * 这里把「人」抽成数据，页面、feed、结构化数据、分享卡都从这一份取。
 *
 * 改这里的 bio 就是改 /authors/ 与关于页上的介绍。
 */
export interface Author {
  /** 写进 frontmatter 的值，也是锚点：/authors/#cui */
  id: string;
  name: string;
  /** 一句话定位，卡片上一行 */
  tagline: string;
  /** 自我介绍，一段一条 */
  bio: string[];
  topics: string[];
  /** 头像色相；深浅两套主题下都按同一算法生成，和标签配色一致 */
  hue: number;
  /** 头像里的字 */
  glyph: string;
  links?: { label: string; href: string }[];
}

export const AUTHORS: Author[] = [
  {
    id: 'cui',
    name: 'Cui',
    tagline: '写代码，也写踩过的坑',
    bio: [
      '多数时候在跟前端纠缠：排版、构建，以及那些「看起来只是改个样式」最后改到凌晨的问题。',
      '喜欢把一件事的来龙去脉写清楚，而不是贴一段能跑的代码就完事。踩过的坑如果不写下来，下次还会踩第二遍。',
    ],
    topics: ['前端', 'Astro', '构建工具', '可访问性'],
    hue: 18,
    glyph: 'C',
  },
  {
    id: 'jing',
    name: 'Jing',
    tagline: '读得慢，想得久',
    bio: [
      '更愿意把时间花在读和写上。一本薄书读两周是常事，读完了也不急着总结。',
      '关心的是「怎么把想清楚的事说明白」：笔记与文章的分界、改稿的时机，以及为什么有些话只适合写给明天的自己。',
    ],
    topics: ['阅读', '写作', '笔记方法', '生活'],
    hue: 168,
    glyph: 'J',
  },
];

/** frontmatter 里可填的作者 id，schema 的 enum 与这里同源 */
export const AUTHOR_IDS = AUTHORS.map((author) => author.id);

export function findAuthor(id: string | undefined): Author {
  return AUTHORS.find((author) => author.id === id) ?? AUTHORS[0];
}

/** 头像底色用深一点的色阶，白字压上去才够 4.5:1 */
export const authorAvatarStyle = (author: Author): string =>
  `--h:${author.hue};background:linear-gradient(135deg,hsl(${author.hue} 58% 42%),hsl(${author.hue + 22} 52% 33%))`;
