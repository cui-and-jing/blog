/**
 * 渲染指标门禁：量的是「页面画出来要多久」，不是「文件多大」。
 *
 *   npm run perf
 *   npm run perf -- --only /,/posts/hello-astro/
 *
 * 需要先 `npm run build` 并起 `npx astro preview --port 4321`（preflight 会自动起）。
 *
 * 口径刻意对齐 Lighthouse 移动端：Slow 4G（1.6Mbps / 150ms RTT）+ 4× CPU 降频。
 * 体积已经有 budget（磁盘）和 budget:wire（传输）两道，这里只盯时间：
 * 字节数照旧打印出来当参考，但**不设阈值**——同一件事量三遍只会互相打架。
 *
 * 阈值的定位是「防回退」而不是「抠极限」：留三成余量，
 * 涨上去说明有人往首屏塞了重活，而不是正常的几十毫秒浮动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';

/* ---------- 被测页面 ----------
   一种页型挑一条代表，不追求全覆盖：
   同一个布局模板下的页面，渲染成本差不到需要分开看的程度。 */
const ROUTES = [
  { path: '/', name: '首页', type: 'home' },
  { path: '/posts/hello-astro/', name: '文章页', type: 'post' },
  { path: '/notes/', name: '笔记列表', type: 'list' },
  { path: '/tags/Astro/', name: '标签聚合', type: 'list' },
  { path: '/games/', name: '游戏大厅', type: 'list' },
  { path: '/games/snake/', name: '游戏试玩', type: 'game' },
];

/* ---------- 预算 ----------
   两套线，别混为一谈：

   target 是「做到什么程度算好」，写在这里是为了让人看得见差距，不参与判定；
   budget 是「超过就一定有问题」，用来防回退。后者之所以留这么宽，
   是因为这套口径（限速 + 降频 + 无缓存）在本机的抖动就有 ±40%，
   卡到接近实测值只会制造假红，让人学会无视这条检查。

   现状与差距（2026-10，Chromium，Slow 4G + 4× CPU）：
     首页    LCP 1.3s / TBT 0.5s
     文章页  LCP 2.1s / TBT 1.2s   ← 缺口在这里
   文章页那一秒几乎全在「中文字体 + 初始化时的强制同步布局」叠加出来的重排上：
   单独拦掉字体、或单独去掉脚本，都能落到 200ms 以内，两者凑在一起才放大成 1s。 */
const TARGET = {
  lcp: 1500,
  cls: 0.02,
  tbt: 200,
};

const BUDGET = {
  lcp: 2400,
  cls: 0.06,
  tbt: 1200,
};

/* 视口取桌面宽度：博客的主要阅读场景，也比移动端少一层「窄屏重排」的噪声。
   移动端的差异由 a11y:keys 的三档视口负责，不在这里重复。 */
const VIEWPORT = { width: 1280, height: 900 };

const THROTTLE = {
  latency: 150,
  download: (1.6 * 1024 * 1024) / 8,
  upload: (750 * 1024) / 8,
  cpu: 4,
};

/* 页面加载完还要等一会儿：入场动效、字体替换、懒加载都可能在这之后才发生，
   LCP 也只有在布局稳定后才定得下来 */
const SETTLE = 2200;

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2);
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const only = onlyArg ? onlyArg.split(',').map((r) => r.trim()).filter(Boolean) : null;
const base = (argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://localhost:4321/blog').replace(/\/$/, '');

const routes = only
  ? ROUTES.filter((route) => only.some((want) => route.path === want || route.type === want))
  : ROUTES;

if (!routes.length) {
  console.error(`没有匹配的路由：${only.join(', ')}`);
  process.exit(2);
}

/* ---------- 探活 ---------- */

try {
  const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(String(res.status));
} catch {
  console.error(`预览没起：${base}\n先 npx astro preview --port 4321（或直接跑 npm run preflight）。`);
  process.exit(2);
}

/* ---------- 采集 ---------- */

const results = [];

for (const route of routes) {
  /* 每个路由换一个浏览器进程：字体解码结果在同一个浏览器里是跨页面复用的，
     连着测会让第二页之后全部偏快——那正好是「从首页点进文章」的乐观值，
     而不是「从搜索结果直接落地」的真实值。冷启动的成本由下面的 about:blank 空跑摊掉。 */
  const browser = await launchBrowser({ protocolTimeout: 90_000 });
  const page = await browser.newPage();
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });

  const session = await page.createCDPSession();
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: THROTTLE.latency,
    downloadThroughput: THROTTLE.download,
    uploadThroughput: THROTTLE.upload,
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE.cpu });

  /* CDP 事件把参数直接作为第一个实参传进来，不是 { params } */
  const types = new Map();
  const bytes = { total: 0, css: 0, js: 0, font: 0, img: 0 };
  const onResponse = (event) => {
    if (event?.requestId) types.set(event.requestId, event.type);
  };
  const onFinished = (event) => {
    const length = event?.encodedDataLength ?? 0;
    bytes.total += length;
    const type = types.get(event?.requestId);
    if (type === 'Stylesheet') bytes.css += length;
    else if (type === 'Script') bytes.js += length;
    else if (type === 'Font') bytes.font += length;
    else if (type === 'Image') bytes.img += length;
  };
  session.on('Network.responseReceived', onResponse);
  session.on('Network.loadingFinished', onFinished);

  /* 空跑一次把浏览器初始化（建渲染进程、载系统字体栈）摊掉，
     否则第一个被测页永远背着冷启动的那几百毫秒 */
  await page.goto('about:blank');
  const started = Date.now();
  await page.goto(base + route.path, { waitUntil: 'load', timeout: 60_000 });
  const loadMs = Date.now() - started;
  await new Promise((resolve) => setTimeout(resolve, SETTLE));

  const metric = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = { lcp: 0, lcpElement: '', cls: 0, tbt: 0, longTasks: [] };
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              out.lcp = entry.startTime;
              const el = entry.element;
              out.lcpElement = el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : entry.url || '';
            }
          }).observe({ type: 'largest-contentful-paint', buffered: true });

          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) out.cls += entry.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });

          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              out.longTasks.push(Math.round(entry.duration));
              out.tbt += Math.max(0, entry.duration - 50);
            }
          }).observe({ type: 'longtask', buffered: true });
        } catch {
          /* 不支持 longtask 的浏览器：指标留 0，下面的判定会放行 */
        }
        setTimeout(() => resolve(out), 250);
      }),
  );

  session.off('Network.responseReceived', onResponse);
  session.off('Network.loadingFinished', onFinished);
  await session.detach();

  await page.close();
  await browser.close();

  results.push({
    path: route.path,
    name: route.name,
    type: route.type,
    budget: { ...BUDGET, ...(route.budget ?? {}) },
    lcp: Math.round(metric.lcp),
    cls: Math.round(metric.cls * 1000) / 1000,
    tbt: Math.round(metric.tbt),
    longTasks: metric.longTasks.sort((a, b) => b - a),
    lcpElement: metric.lcpElement,
    loadMs,
    bytes: {
      total: Math.round(bytes.total / 1024),
      css: Math.round(bytes.css / 1024),
      js: Math.round(bytes.js / 1024),
      font: Math.round(bytes.font / 1024),
      img: Math.round(bytes.img / 1024),
    },
  });
}

/* ---------- 判定与输出 ---------- */

const KB = 1024;
const kb = (n) => (n / KB).toFixed(1);
let failed = 0;

console.log('\n  Slow 4G + 4× CPU（对齐 Lighthouse 移动端口径）\n');
console.log('  页面           LCP      CLS     TBT    最长任务              首屏传输');
console.log('  ─────────────────────────────────────────────────────────────────────');

for (const row of results) {
  const over = [
    row.lcp > row.budget.lcp ? `LCP ${row.lcp} > ${row.budget.lcp}` : null,
    row.cls > row.budget.cls ? `CLS ${row.cls} > ${row.budget.cls}` : null,
    row.tbt > row.budget.tbt ? `TBT ${row.tbt} > ${row.budget.tbt}` : null,
  ].filter(Boolean);
  if (over.length) failed += 1;

  /* 没超红线但离目标还远：标一个 ·，提醒「这条还没做好」，而不是混进 ✓ 里 */
  const far =
    !over.length && (row.lcp > TARGET.lcp || row.tbt > TARGET.tbt || row.cls > TARGET.cls);

  const worst = row.longTasks[0] ? `${row.longTasks.length} × ${row.longTasks[0]}ms` : '—';
  console.log(
    `  ${row.name.padEnd(12, ' ')} ${String(row.lcp).padStart(5)}ms ${row.cls.toFixed(3).padStart(7)} ${String(row.tbt).padStart(6)}ms  ${worst.padEnd(20, ' ')} ${String(row.bytes.total).padStart(4)}KB` +
      (over.length ? '  ✗' : far ? '  ·' : '  ✓'),
  );
  if (over.length) console.log(`      └─ ${over.join('，')}`);
}

console.log('\n  传输构成：');
for (const row of results) {
  console.log(
    `    ${row.name.padEnd(12, ' ')} css ${String(row.bytes.css).padStart(3)}KB   js ${String(row.bytes.js).padStart(2)}KB   font ${String(row.bytes.font).padStart(3)}KB   img ${String(row.bytes.img).padStart(2)}KB`,
  );
}

/* ---------- 留档 ---------- */

const outDir = path.join(process.cwd(), '.shots');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'perf.json');
const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null;
const history = [...(previous?.history ?? []), { at: new Date().toISOString(), results }].slice(-20);
fs.writeFileSync(
  outFile,
  JSON.stringify({ throttle: THROTTLE, viewport: VIEWPORT, target: TARGET, budget: BUDGET, results, history }, null, 2),
);

console.log(`\n  目标 LCP ${TARGET.lcp}ms / TBT ${TARGET.tbt}ms，红线 LCP ${BUDGET.lcp}ms / TBT ${BUDGET.tbt}ms`);
console.log(`  明细：.shots/perf.json（保留最近 20 次，可看趋势）`);

/* 红线是防回退的，不是拿来跑分的；脚本自己先报红，别等到线上才发现 */
console.log(`\n${failed ? 'FAIL' : 'OK'}  渲染指标${failed ? `有 ${failed} 个页面越过红线` : '都没有越过红线'}\n`);
if (failed) process.exit(1);
