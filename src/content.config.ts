import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
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

export const collections = { posts };
