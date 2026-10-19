import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE, base } from '../lib/site';

export async function GET(context) {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const sorted = posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: new URL(`${base}/`, context.site ?? 'https://cui-and-jing.github.io').href,
    items: sorted.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link: `${base}/posts/${post.id}/`,
    })),
    customData: `<language>${SITE.lang}</language>`,
  });
}
