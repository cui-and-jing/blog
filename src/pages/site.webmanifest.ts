import type { APIRoute } from 'astro';
import { SITE, url, base } from '../lib/site';

/**
 * 站点清单。做成端点而不是静态 JSON，是为了让 start_url 与图标地址
 * 跟着 astro.config 的 base 走——写死 /blog/ 的话，换部署路径就会静默失效。
 */
export const GET: APIRoute = () => {
  const manifest = {
    name: SITE.title,
    short_name: SITE.title,
    description: SITE.description,
    lang: SITE.lang,
    start_url: url('/'),
    scope: `${base}/`,
    display: 'standalone',
    /* 与 tokens.css 的 --bg 同色，启动时不会闪一下白 */
    background_color: '#f2f0e9',
    theme_color: '#f2f0e9',
    icons: [
      { src: url('/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: url('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
