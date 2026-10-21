/**
 * 生成分享封面：每篇文章一张 public/og/<slug>.png，外加首页默认 public/og.png
 *
 * 用法：npm run og （新增/修改文章后手动跑一次，产物直接提交）
 * 依赖本机 Chrome / Edge；字体走系统字体，所以换个系统渲染结果会有差异。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { parse as parseYaml } from 'yaml';
import { coverStyle } from '../src/lib/cover.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postsDir = path.join(root, 'src/content/posts');
const outDir = path.join(root, 'public/og');
/* 与 src/lib/site.ts 保持一致；那边用了 import.meta.env，在 Node 里跑不起来，所以在这里另抄一份 */
const SITE = { title: 'Cui & Jing', tagline: '关于技术、阅读与生活的长期笔记', url: 'cui-and-jing.github.io/blog' };

/* ---------- 找浏览器 ---------- */
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('没找到 Chrome / Edge，用 CHROME_PATH 指一个再跑。');
  process.exit(1);
}

/* ---------- 读文章 ---------- */
const files = (await fs.readdir(postsDir)).filter((f) => /\.mdx?$/.test(f));
const posts = [];
for (const file of files) {
  const raw = await fs.readFile(path.join(postsDir, file), 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) continue;
  const data = parseYaml(match[1]) ?? {};
  if (data.draft) continue;
  const slug = file.replace(/\.mdx?$/, '');
  const body = raw.slice(match[0].length);
  const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, '');
  posts.push({
    slug,
    title: String(data.title ?? slug),
    description: String(data.description ?? ''),
    date: data.date instanceof Date ? data.date : new Date(String(data.date)),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    category: data.category ? String(data.category) : '',
    minutes: Math.max(1, Math.round(text.length / 400)),
  });
}
posts.sort((a, b) => b.date.valueOf() - a.date.valueOf());

/* ---------- 模板 ---------- */
const fmtDate = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
const hueOf = (tag) => {
  let h = 5381;
  for (let i = 0; i < tag.length; i += 1) h = (h * 33) ^ tag.charCodeAt(i);
  return Math.abs(h) % 360;
};
/* 标题越长字号越小，避免折成四行 */
const titleSize = (title) => {
  const weight = Array.from(title).reduce((sum, ch) => sum + (/[\u4e00-\u9fa5]/.test(ch) ? 1 : 0.56), 0);
  if (weight <= 10) return 78;
  if (weight <= 14) return 70;
  if (weight <= 18) return 62;
  if (weight <= 24) return 56;
  return 50;
};

function card(palette, label, glyph, extra = '') {
  return `<div class="card ${extra}" style="--c1:${palette.c1};--c2:${palette.c2};--c3:${palette.c3};--angle:${palette.angle}deg">
    <span class="card-label">${label}</span>
    <span class="card-glyph">${glyph}</span>
  </div>`;
}

function html({ title, description, kicker, tags, foot, stack }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px}
  body{position:relative;overflow:hidden;background:#f2f0e9;color:#1b1916;
    font-family:'Noto Sans SC','Microsoft YaHei','PingFang SC',sans-serif;
    -webkit-font-smoothing:antialiased}
  .glow{position:absolute;border-radius:50%;filter:blur(2px)}
  .glow.a{width:820px;height:820px;left:-300px;top:-420px;
    background:radial-gradient(circle,rgba(232,133,63,.17),rgba(232,133,63,0) 65%)}
  .glow.b{width:700px;height:700px;right:-240px;bottom:-380px;
    background:radial-gradient(circle,rgba(47,111,102,.13),rgba(47,111,102,0) 65%)}
  .grain{position:absolute;inset:0;opacity:.5;
    background-image:repeating-linear-gradient(0deg,rgba(27,25,22,.026) 0 1px,transparent 1px 4px)}
  .frame{position:absolute;inset:24px;border:1px solid rgba(27,25,22,.09)}
  .stage{position:absolute;inset:0;padding:62px 66px 54px;display:flex}
  .left{width:700px;display:flex;flex-direction:column;position:relative;z-index:3}
  .brand{display:flex;align-items:center;gap:13px}
  .mark{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#bf4a26,#e8853f 58%,#f5c274);
    box-shadow:0 6px 16px -6px rgba(191,74,38,.55)}
  .brand span{font-size:23px;letter-spacing:.01em}
  .kicker{margin-top:46px;font-family:'SFMono-Regular',Consolas,monospace;font-size:14px;
    letter-spacing:.2em;color:#8c8579;text-transform:uppercase;display:flex;align-items:center;gap:12px}
  .kicker i{display:block;width:26px;height:1px;background:#c9c2b4}
  h1{margin-top:20px;font-family:'Noto Serif SC','Source Han Serif SC','Songti SC',SimSun,serif;
    font-weight:600;font-size:${titleSize(title)}px;line-height:1.34;letter-spacing:.005em;
    text-wrap:balance;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .desc{margin-top:22px;max-width:640px;font-size:22px;line-height:1.72;color:#55504a;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .foot{margin-top:auto;display:flex;align-items:center;gap:10px;padding-top:26px}
  .pill{padding:6px 15px;border-radius:999px;font-size:15px;line-height:1.6;white-space:nowrap}
  .url{margin-left:18px;padding-left:18px;border-left:1px solid #ded7c9;
    font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;letter-spacing:.05em;color:#9c9488}
  .stack{position:absolute;right:-36px;top:44px;width:470px;height:560px;z-index:2}
  .card{position:absolute;width:330px;height:440px;border-radius:34px;overflow:hidden;
    padding:26px 28px;display:flex;flex-direction:column;
    background:linear-gradient(var(--angle),var(--c1),var(--c2) 55%,var(--c3));
    box-shadow:0 26px 54px -26px rgba(27,25,22,.55),0 2px 6px rgba(27,25,22,.06)}
  .card::after{content:'';position:absolute;inset:0;
    background:linear-gradient(200deg,rgba(255,255,255,.22),transparent 44%)}
  .card-label{position:relative;z-index:2;font-family:'SFMono-Regular',Consolas,monospace;
    font-size:12.5px;letter-spacing:.18em;color:rgba(255,255,255,.78)}
  .card-glyph{position:absolute;right:-6px;bottom:-42px;z-index:1;
    font-family:'Noto Serif SC','Source Han Serif SC',SimSun,serif;font-size:230px;line-height:1;
    color:rgba(255,255,255,.14)}
  .c1{left:4px;top:56px;transform:rotate(-17deg);opacity:.96}
  .c2{left:122px;top:16px;transform:rotate(12deg)}
  .c3{left:66px;top:74px;transform:rotate(-4.5deg);z-index:3}
  </style></head><body>
  <div class="glow a"></div><div class="glow b"></div><div class="grain"></div><div class="frame"></div>
  <div class="stage">
    <div class="left">
      <div class="brand"><span class="mark"></span><span>${SITE.title}</span></div>
      <div class="kicker"><i></i>${kicker}</div>
      <h1>${title}</h1>
      ${description ? `<p class="desc">${description}</p>` : ''}
      <div class="foot">${foot}</div>
    </div>
  </div>
  <div class="stack">${stack}</div>
  </body></html>`;
}

function pill(text, hue) {
  return `<span class="pill" style="background:hsl(${hue} 46% 91%);color:hsl(${hue} 42% 30%)">#${text}</span>`;
}

const cards = [];

/* 背面两张卡用品牌色打底，正面保持文章自己的配色，三张叠在一起才不糊 */
const BRAND = { c1: '#bf4a26', c2: '#e8853f', c3: '#f5c274', angle: 118 };
const TEAL = { c1: '#2f6f66', c2: '#5b9a8d', c3: '#a9cfc2', angle: 150 };
const NAVY = { c1: '#243a63', c2: '#456999', c3: '#9bbcda', angle: 168 };

const hueOfHex = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const isWarm = (hex) => Math.abs(hueOfHex(hex) - 22) < 28;
/* 正面偏橙时，背面橙色会糊成一片，换深蓝顶上 */
const backPalettes = (front) => [TEAL, isWarm(front.c1) ? NAVY : BRAND];

/* 首页默认封面 */
{
  const base = coverStyle('cui-and-jing', SITE.tagline);
  const [alt1, alt2] = backPalettes(base);
  cards.push({
    file: path.join(root, 'public/og.png'),
    html: html({
      title: SITE.tagline,
      description: '不追热点，只写想清楚的事。',
      kicker: `Blog · ${new Date().getFullYear()}`,
      foot: `${['技术', '阅读', '生活'].map((t) => pill(t, hueOf(t))).join('')}` +
        `<span class="url">${SITE.url}</span>`,
      stack: card(alt1, 'TECH', base.glyph, 'c1') + card(alt2, 'NOTE', '记', 'c2') + card(base, 'POST', base.glyph, 'c3'),
    }),
  });
}

/* 每篇文章 */
for (const post of posts) {
  const style = coverStyle(post.slug, post.title);
  const [back1, back2] = backPalettes(style);
  const kicker = `${post.category || 'POST'} · ${fmtDate(post.date)} · ${post.minutes} MIN`;
  const tags = post.tags.slice(0, 3).map((t) => pill(t, hueOf(t))).join('');
  cards.push({
    file: path.join(outDir, `${post.slug.replace(/\//g, '-')}.png`),
    html: html({
      title: post.title,
      description: post.description,
      kicker,
      foot: `${tags}<span class="url">${SITE.url}</span>`,
      stack:
        card(back1, 'TECH', style.glyph, 'c1') +
        card(back2, 'NOTE', style.glyph, 'c2') +
        card(style, post.category || 'POST', style.glyph, 'c3'),
    }),
  });
}

/* ---------- 渲染 ---------- */
await fs.mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });

for (const item of cards) {
  await page.setContent(item.html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 120));
  await page.screenshot({ path: item.file, type: 'png', captureBeyondViewport: false });
  const { size } = await fs.stat(item.file);
  console.log(`${path.relative(root, item.file).padEnd(28)} ${(size / 1024).toFixed(0)} KB`);
}

await browser.close();
