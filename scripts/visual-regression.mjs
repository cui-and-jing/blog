/**
 * 视觉回归：把关键路由 × 浅/深 × 3 个视口截图，与基线逐像素比对。
 *
 *   node scripts/visual-regression.mjs --update    # 重建基线（样式改动确认无误后再跑）
 *   node scripts/visual-regression.mjs             # 对比当前构建，差异超阈值退出码 1
 *
 * 说明：
 * - 需要先 `npm run build && npx astro preview`。
 * - 基线绑定生成环境（platform + 浏览器版本）。换机器或换浏览器后会跳过比对，
 *   因为字体栅格化差异会让所有页面都「失败」，那样的红叉没有信息量。
 * - 3D 游戏页用 canvas 实时渲染，逐帧不同，不在比对范围内。
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const update = args.includes('--update');
const base = getArg('--base', 'http://localhost:4321/blog').replace(/\/$/, '');
const threshold = Number(getArg('--threshold', '0.35')); // 允许的差异像素百分比
const only = getArg('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ROUTES = only.length
  ? only
  : [
      '/',
      '/posts/',
      '/posts/hello-astro/',
      '/posts/paper-notes/',
      '/posts/writing-workflow/',
      '/archive/',
      '/series/',
      '/series/从笔记到发布/',
      '/tags/',
      '/tags/Astro/',
      '/category/技术/',
      '/about/',
      '/games/',
      '/search/',
      '/styleguide/',
    ];

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

const THEMES = ['light', 'dark'];
const ROOT = path.join(process.cwd(), 'tests/visual');
const DIR = path.join(ROOT, 'baseline');
const META = path.join(ROOT, 'meta.json');

const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const executablePath = process.env.CHROME_PATH ?? edgeCandidates.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('找不到浏览器，请设置 CHROME_PATH');
  process.exit(2);
}

const slug = (route) =>
  route === '/' ? 'home' : route.replace(/^\/|\/$/g, '').replace(/[/]/g, '-') || 'home';
const fileOf = (route, theme, viewport) =>
  path.join(DIR, `${slug(route)}--${theme}--${viewport.name}.jpg`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
});
const version = await browser.version();

if (!update && fs.existsSync(META)) {
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  if (meta.platform !== process.platform || meta.browser !== version) {
    console.log(
      `跳过：基线生成于 ${meta.platform} / ${meta.browser}，当前是 ${process.platform} / ${version}。`
    );
    console.log('换环境后请在本机跑一次 --update 重建基线。');
    await browser.close();
    process.exit(0);
  }
}

fs.mkdirSync(DIR, { recursive: true });

const shoot = async (route, theme, viewport) => {
  const page = await browser.newPage();
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
  });
  /* 动效会让同一页面每次截出不同的帧 */
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((t) => {
    try {
      localStorage.setItem('theme', t);
    } catch {}
  }, theme);

  await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
  /* giscus 走外网、加载时间不可控；打字机每帧都在变，换成静态文本再拍 */
  await page.evaluate(() => {
    document.querySelectorAll('.comments, .giscus, iframe[src*="giscus"]').forEach((el) => el.remove());
    const typed = document.getElementById('type-line');
    if (typed) {
      const frozen = typed.cloneNode(true);
      frozen.textContent = '你好，我们是 Cui & Jing。';
      typed.replaceWith(frozen);
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await sleep(700);

  const buffer = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
  await page.close();
  return buffer;
};

let failed = 0;
let written = 0;
let compared = 0;

const diffPage = await browser.newPage();
const compare = (aBuf, bBuf) =>
  diffPage.evaluate(
    async (a, b, limit) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { ratio: 100, reason: `尺寸不同 ${ia.width}×${ia.height} vs ${ib.width}×${ib.height}` };
      }
      const canvas = document.createElement('canvas');
      canvas.width = ia.width;
      canvas.height = ia.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      ctx.drawImage(ia, 0, 0);
      const left = ctx.getImageData(0, 0, ia.width, ia.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(ib, 0, 0);
      const right = ctx.getImageData(0, 0, ia.width, ia.height).data;

      let changed = 0;
      for (let i = 0; i < left.length; i += 4) {
        if (
          Math.abs(left[i] - right[i]) > limit ||
          Math.abs(left[i + 1] - right[i + 1]) > limit ||
          Math.abs(left[i + 2] - right[i + 2]) > limit
        ) {
          changed += 1;
        }
      }
      return { ratio: (changed / (left.length / 4)) * 100, reason: '' };
    },
    `data:image/jpeg;base64,${aBuf.toString('base64')}`,
    `data:image/jpeg;base64,${bBuf.toString('base64')}`,
    14
  );

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const target = fileOf(route, theme, viewport);
      let shot;
      try {
        shot = await shoot(route, theme, viewport);
      } catch (error) {
        console.error(`FAIL  ${route} ${theme} ${viewport.name}  截图失败：${error.message}`);
        failed += 1;
        continue;
      }

      if (update) {
        fs.writeFileSync(target, shot);
        written += 1;
        continue;
      }

      if (!fs.existsSync(target)) {
        console.error(`MISS  ${route} ${theme} ${viewport.name}  没有基线`);
        failed += 1;
        continue;
      }

      const before = fs.readFileSync(target);
      const result = await compare(before, shot);
      compared += 1;
      const label = `${route} ${theme} ${viewport.name}`;

      if (result.ratio > threshold) {
        const diffFile = target.replace(/\.jpg$/, '--diff.jpg');
        fs.writeFileSync(diffFile, shot);
        console.error(`FAIL  ${label}  差异 ${result.ratio.toFixed(2)}%${result.reason ? ' ' + result.reason : ''}`);
        failed += 1;
      } else if (result.ratio > 0.05) {
        console.log(`ok    ${label}  差异 ${result.ratio.toFixed(2)}%`);
      }
    }
  }
}

if (update) {
  fs.writeFileSync(
    META,
    JSON.stringify(
      {
        platform: process.platform,
        browser: version,
        generatedAt: new Date().toISOString(),
        routes: ROUTES,
        viewports: VIEWPORTS.map((v) => `${v.name} ${v.width}×${v.height}`),
        quality: 70,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`\n基线已重建：${written} 张，元信息写入 tests/visual/meta.json`);
} else {
  console.log(`\n比对 ${compared} 张，阈值 ${threshold}%${failed ? `，${failed} 张超出` : '，全部在阈值内'}`);
}

await diffPage.close();
await browser.close();
process.exit(failed ? 1 : 0);
