/**
 * 游戏冒烟：压缩之后，游戏还跑不跑得起来。
 *
 *   node scripts/games-smoke.mjs
 *   node scripts/games-smoke.mjs --base http://localhost:4321/blog
 *
 * 为什么需要这个：`scripts/games.mjs` 会把内联的 three.js 换成「只含用到导出的」裁剪版。
 * 裁剪的依据是静态扫描，而静态扫描一定会漏——这游戏就漏过一次：
 * 视图层用的是别名 `T.OrthographicCamera(...)`，只扫 `THREE.` 看不见它，
 * 表现是公园能进、一开竞技场就白屏，而且构建是绿的。
 *
 * 所以这里做两层：
 *   1. 行为断言：能就绪、画面不是空白、没有报错
 *   2. 运行时守卫：给 window.THREE 套 Proxy，真访问到不存在的成员就把名字记下来，
 *      报错时直接告诉你是缺了哪个类
 *
 * 需要本地先 `npm run build` 并起 `npx astro preview`。
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { launchBrowser } from './lib/browser.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = getArg('--base', 'http://localhost:4321/blog').replace(/\/$/, '');
const SRC_DIR = path.join(process.cwd(), 'public', 'games');

/** 裁剪过 three 的游戏，才需要跑竞技场那条深路径 */
const THREE_GAMES = new Set(['beanrush.html']);

/**
 * 套在 window.THREE 上的守卫。
 *
 * 用 defineProperty 而不是在加载后改属性：游戏里是 `window.THREE=api` 赋值的，
 * 只有在赋值那一刻接管，才能保证后面所有读取都经过我们。
 */
const GUARD = () => {
  const missing = new Set();
  window.__missingThree = missing;
  let wrapped;
  Object.defineProperty(window, 'THREE', {
    configurable: true,
    get: () => wrapped,
    set: (value) => {
      wrapped = new Proxy(value, {
        get(target, key, receiver) {
          const result = Reflect.get(target, key, receiver);
          if (result === undefined && typeof key === 'string' && /^[A-Z]/.test(key)) missing.add(key);
          return result;
        },
      });
    },
  });
};

/** 整屏几乎同色说明白屏了。stdev 比肉眼判断可靠，也不受主题深浅影响 */
async function looksBlank(page) {
  const shot = await page.screenshot({ type: 'png' });
  const stats = await sharp(shot).stats();
  return Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev)) < 6;
}

const browser = await launchBrowser();
const rows = [];
const failures = [];

const games = fs
  .readdirSync(SRC_DIR)
  .filter((file) => file.endsWith('.html'))
  .sort();

for (const file of games) {
  const page = await browser.newPage();
  const errors = [];
  const missing = [];

  page.on('pageerror', (error) => errors.push(`页面异常：${error.message}`));
  page.on('console', (message) => {
    /* 资源 404 会以「Failed to load resource」形式进控制台，但拿不到 URL。
       这类交给下面的 response 监听判断，免得把 favicon 的噪音算成失败。 */
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      errors.push(`控制台错误：${message.text().slice(0, 200)}`);
    }
  });
  page.on('response', (response) => {
    /* 游戏页没有声明图标，浏览器会去根目录要 /favicon.ico，返回 404 属于常态 */
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      errors.push(`资源 ${response.status()}：${response.url()}`);
    }
  });

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(GUARD);

  const started = Date.now();
  try {
    await page.goto(`${base}/games/${file}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    if (THREE_GAMES.has(file)) {
      await page.waitForFunction(() => window.__beanReady === true, { timeout: 60_000 });

      const revision = await page.evaluate(() => window.THREE?.REVISION ?? null);
      /* OrthographicCamera 是踩过的坑：它只被别名访问，静态扫描漏过它，这里钉住 */
      const required = await page.evaluate(() =>
        ['Mesh', 'WebGLRenderer', 'OrthographicCamera', 'BoxGeometry', 'InstancedMesh'].filter(
          (name) => typeof window.THREE?.[name] !== 'function'
        )
      );
      if (revision !== '185') failures.push(`${file} 里 three 的版本是 r${revision}，期望 r185`);
      if (required.length) failures.push(`${file} 的 THREE 缺少：${required.join(', ')}`);

      /* 走一遍：竞技场列表 → 第一张卡片 → 开始游玩。3D 场景是在这一步才建的 */
      await page.evaluate(() => document.querySelector('[data-page="library"]')?.click());
      await new Promise((resolve) => setTimeout(resolve, 500));
      await page.evaluate(() => document.querySelector('[data-detail]')?.click());
      await new Promise((resolve) => setTimeout(resolve, 500));
      const played = await page.evaluate(() => {
        const button = document.getElementById('p-detail-play');
        if (!button) return false;
        button.click();
        return true;
      });
      if (!played) failures.push(`${file} 找不到「开始游玩」按钮`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    if (await looksBlank(page)) failures.push(`${file} 画面几乎全空，像是脚本没跑起来`);

    const text = await page.evaluate(() => (document.body.innerText || '').trim().length);
    if (text < 30) failures.push(`${file} 页面上几乎没有可见文字（${text} 字）`);

    missing.push(...(await page.evaluate(() => [...(window.__missingThree ?? [])])));
  } catch (error) {
    failures.push(`${file} 跑不起来：${error.message}`);
  }

  for (const message of errors) failures.push(`${file} ${message}`);

  rows.push({
    file,
    seconds: (Date.now() - started) / 1000,
    errors: errors.length,
    missing: missing.length,
    missingList: missing,
  });

  await page.close();
}

await browser.close();

console.log('\n  游戏              耗时    报错   未导出的成员');
for (const row of rows) {
  const flag = row.errors || row.missing.length ? '✗' : ' ';
  console.log(
    `  ${flag} ${row.file.padEnd(18)}${row.seconds.toFixed(1).padStart(5)}s` +
      `${String(row.errors).padStart(5)}` +
      `${String(row.missing).padStart(10)}   ${row.missingList.slice(0, 6).join(', ')}`
  );
}

if (failures.length) {
  console.error('\n✗ 游戏冒烟失败：');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    '\n  如果报的是「缺少 THREE.xxx」，把 xxx 补进 scripts/lib/three-vendor.mjs 的扫描结果即可：\n' +
      '  裁掉的导出是静态扫描推断出来的，运行时守卫负责把漏网的抓出来。'
  );
  process.exit(1);
}

console.log(`\n✓ ${rows.length} 个游戏都能正常启动`);
