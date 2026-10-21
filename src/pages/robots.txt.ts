import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const root = (site ?? new URL('https://cui-and-jing.github.io')).toString().replace(/\/$/, '');
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${root}${base}/sitemap-index.xml`, ''].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
