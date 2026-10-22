import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 作者 id。**故意不给默认值**：署名不能靠猜，忘了写就该在构建时报错，
 * 而不是默默把 Jing 的文章标成 Cui。新增作者时同步 src/data/authors.ts。
 */
const author = z.enum(['cui', 'jing'], {
  message: 'author 只能是 cui 或 jing，见 src/data/authors.ts',
});

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    author,
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    description: z.string().default(''),
    tags: z.array(z.string()).default([]),
    category: z.string().optional(),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
    /** 系列名；同名的文章会被串成一条阅读线 */
    series: z.string().optional(),
    /** 系列内的顺序，从 1 开始；不填则按日期排在后面 */
    seriesOrder: z.number().int().positive().optional(),
  }),
});

/**
 * 短笔记：没有标题、没有摘要，一条就是一段话。
 * 标题与摘要都由正文推导（见 src/lib/notes.ts），所以这里只留必要的字段。
 */
const notes = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/notes' }),
  schema: z.object({
    author,
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts, notes };
