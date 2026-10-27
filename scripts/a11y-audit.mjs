/**
 * 全站无障碍审计：用 axe-core 跑浅色 / 深色两套主题。
 *
 *   node scripts/a11y-audit.mjs                 # 默认 http://localhost:4321/blog
 *   node scripts/a11y-audit.mjs --base http://localhost:4321/blog --only /,/posts/hello-astro/
 *
 * 需要本地先 `npm run build && npx astro preview`（或用线上地址）。
 * 退出码：有 critical / serious 违规时为 1，方便接进 CI。
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = getArg('--base', 'http://localhost:4321/blog').replace(/\/$/, '');
const only = getArg('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const routes = only.length
  ? only
  : [
      '/',
      '/posts/',
      '/posts/hello-astro/',
      '/posts/paper-notes/',
      '/posts/writing-workflow/',
      '/notes/',
      '/notes/2026-10-22-1015/',
      '/archive/',
      '/series/',
      '/series/从笔记到发布/',
      '/tags/',
      '/tags/Astro/',
      /* 这条以前是 404：笔记的标签没进标签页就没生成页面 */
      '/tags/CSS/',
      '/category/技术/',
      '/authors/',
      '/license/',
      '/about/',
      '/games/',
      '/games/beanrush/',
      /* 原创横版游戏：外壳与单文件本体分别检查 */
      '/games/pixelraid/',
      '/search/',
      '/subscribe/',
      '/styleguide/',
      '/404.html',
    ];

const axeSource = fs.readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8');

const browser = await launchBrowser({
  /* 单条 CDP 命令的超时。默认 180s 太长：一个页面的渲染进程卡死会让每条路由
     干等 3 分钟，60s 足够任何正常页面加载 + axe 全量跑完 */
  protocolTimeout: 60_000,
});

const results = [];
let serious = 0;

/** 扫一条路由的一个主题；扫不成直接抛，由外层决定重不重试 */
async function auditPage(browserInstance, route, theme) {
  const page = await browserInstance.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    /* 试玩页的 iframe 里是游戏本体，axe 又明确跳过 iframe——没必要等游戏把网络跑完。
       beanrush 的内联 three.js 在 CI 上让 networkidle2 一直等不到（Quality #48：
       两套主题各超时 30s，加一次重试把整轮拖到 5 分钟）。壳页只要 DOM 就位；
       字体与 booted 两道等待照旧，够它把样式和交互外壳补完 */
    const isPlay = /^\/games\/.+\/$/.test(route);
    const res = await page.goto(base + route, {
      waitUntil: isPlay ? 'domcontentloaded' : 'networkidle2',
      timeout: 30000,
    });
    const status = res?.status() ?? 0;
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    /* 等字体真的就位再扫。CI 的机器比本机慢一截，250ms 时中文字体可能还在换，
       axe 量到的是换字中间的排版，报出来的问题在本机永远复现不了。 */
    await page.evaluate(() => document.fonts.ready.then(() => true));
    /* 再等交互外壳补完（表格滚动容器、代码复制按钮、入场动效）。
       不等的话会扫到「半成品」页面——CI 上 rAF 的调度比本机保守，
       多等一个明确信号，比多等几百毫秒可靠。超时就算了，不能卡死在这里。 */
    await page
      .waitForFunction(() => document.documentElement.dataset.booted === 'on', { timeout: 2500 })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 120));
    /* 冻结过渡：主题切换会触发 0.18s 的颜色过渡，axe 跑到一半就量到中间色。
       2048 的「重开」按钮曾因此报出一条假的不合格对比度（2.5:1，真实值 5.3:1） */
    await page.addStyleTag({
      content: '*,*::before,*::after{transition:none!important;animation:none!important}',
    });
    await page.addScriptTag({ content: axeSource });
    const report = await page.evaluate(async (skipFrames) => {
      /* 试玩页里的 iframe 是游戏本体，这里不进去——游戏自己的界面由
         gamePages 的直连页单独扫，避免同一游戏被扫两遍 */
      const context = skipFrames ? { exclude: [['iframe']] } : document;
      return await window.axe.run(context, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
        resultTypes: ['violations'],
      });
    }, /^\/games\/.+\/$/.test(route));
    const violations = report.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 6).map((n) => ({
        target: n.target.join(' '),
        summary: (n.failureSummary ?? '').split('\n').slice(0, 2).join(' ').slice(0, 220),
      })),
      count: v.nodes.length,
    }));
    return { status, violations };
  } finally {
    /* 渲染进程崩掉时 close() 自己也会抛，吞掉即可——反正这个标签页已经不在了 */
    await page.close().catch(() => {});
  }
}

async function scanRoutes(routeList, browserInstance) {
  for (const route of routeList) {
    for (const theme of ['light', 'dark']) {
      let entry = null;
      /* 一条路由重来一次。失败一次没扫成（networkidle2 等不到、渲染进程被回收）
         在 CI 上偶发，重试能自愈；真有 aria 问题的话重试也是同样的结论 */
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const { status, violations } = await auditPage(browserInstance, route, theme);
          for (const v of violations) {
            if (v.impact === 'critical' || v.impact === 'serious') serious += 1;
          }
          entry = { route, theme, status, violations };
          break;
        } catch (err) {
          if (attempt < 2) {
            const why = String(err?.message ?? err).slice(0, 80);
            console.log(`  ↻ ${route} [${theme}] 没扫成（${why}），重试一次`);
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          entry = { route, theme, status: 0, error: String(err).slice(0, 200), violations: [] };
        }
      }
      results.push(entry);
    }
    console.log(`✓ ${route}`);
  }
}

/* 游戏直连页（*.html）单独用一个新开的浏览器扫。
   在跑过几十个站内路由的同一个浏览器实例里访问它们，页面的 JS 执行会卡死
   （Runtime.callFunctionOn 超时；单独开浏览器、或只访问这几页时都复现不了），
   疑似与同源渲染进程复用 + 站内页积累的状态有关。新浏览器 8 次扫描只要十几秒 */
const gamePages = ['/games/pixelraid.html'];

await scanRoutes(routes, browser);

if (!only.length) {
  const gameBrowser = await launchBrowser({ protocolTimeout: 60_000 });
  await scanRoutes(gamePages, gameBrowser);
  await gameBrowser.close();
}

/* 设置面板和快捷键面板默认是关着的，路由循环扫不到。
   它们承载主题、字体、字号三类偏好，出问题面最大，单独打开各扫一遍；
   底部操作条与导航抽屉只在窄屏出现，所以这两项用 390px 视口 */
for (const panel of [
  { key: 'settings', label: '设置面板', width: 1280, open: (page) => page.click('#settings-toggle') },
  { key: 'shortcuts', label: '快捷键面板', width: 1280, open: (page) => page.keyboard.type('?') },
  { key: 'bar', label: '移动端操作条', width: 390, open: () => {} },
  { key: 'drawer', label: '移动端导航抽屉', width: 390, open: (page) => page.click('#menu-toggle') },
]) {
  const page = await browser.newPage();
  await page.setViewport({ width: panel.width ?? 1280, height: panel.width === 390 ? 844 : 900, deviceScaleFactor: 1 });
  try {
    await page.goto(`${base}/posts/hello-astro/`, { waitUntil: 'networkidle2', timeout: 30000 });
    /* 面板靠点击打开，得先确认脚本已经接管，否则点了个空 */
    await page
      .waitForFunction(() => document.documentElement.dataset.booted === 'on', { timeout: 2500 })
      .catch(() => {});
    await page.addScriptTag({ content: axeSource });
    await panel.open(page);
    await new Promise((r) => setTimeout(r, 450));
    const report = await page.evaluate(async () => {
      return await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
        resultTypes: ['violations'],
      });
    });
    const violations = report.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 6).map((n) => ({
        target: n.target.join(' '),
        summary: (n.failureSummary ?? '').split('\n').slice(0, 2).join(' ').slice(0, 220),
      })),
      count: v.nodes.length,
    }));
    for (const v of violations) {
      if (v.impact === 'critical' || v.impact === 'serious') serious += 1;
    }
    results.push({ route: `(${panel.label})`, theme: 'light', status: 200, violations });
    console.log(`✓ ${panel.label}`);
  } catch (err) {
    results.push({ route: `(${panel.label})`, theme: 'light', status: 0, error: String(err).slice(0, 200), violations: [] });
    console.log(`ERR ${panel.label}`);
  }
  await page.close().catch(() => {});
}

await browser.close();

fs.mkdirSync('.shots', { recursive: true });
fs.writeFileSync('.shots/a11y.json', JSON.stringify(results, null, 2));

console.log('\n===== 汇总 =====');
for (const r of results) {
  const bad = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  const minor = r.violations.length - bad.length;
  const mark = r.error ? 'ERR' : bad.length ? 'FAIL' : 'ok';
  console.log(
    `${mark.padEnd(4)} ${String(r.status).padEnd(4)} ${r.theme.padEnd(5)} ${r.route}` +
      (bad.length ? `  serious=${bad.length}` : '') +
      (minor ? `  minor=${minor}` : '') +
      (r.error ? `  ${r.error}` : ''),
  );
  for (const v of bad) {
    console.log(`      · [${v.impact}] ${v.id} ×${v.count} — ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`        ${n.target}\n        ${n.summary}`);
  }
  for (const v of r.violations.filter((x) => x.impact !== 'critical' && x.impact !== 'serious')) {
    console.log(`      · [${v.impact ?? 'n/a'}] ${v.id} ×${v.count}`);
  }
}

console.log(`\n严重/重要违规总数：${serious}`);
/* 打不开或扫不了的页面按失败算：门禁不能放过「没测到」的页面 */
const errors = results.filter((r) => r.error);
if (errors.length) console.log(`无法完成扫描的路由：${errors.length} 条`);
process.exit(serious > 0 || errors.length > 0 ? 1 : 0);
