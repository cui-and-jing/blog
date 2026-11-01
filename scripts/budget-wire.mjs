/**
 * 首屏传输预算：用真实浏览器量「线上到底传了多少字节」。
 *
 * 为什么不用文件体积代替：体积预算（scripts/budget.mjs）量的是磁盘上的文件，
 * 看不见 gzip、也看不见「这页实际请求了哪几个」——字体分片后同一份 CSS 在不同页面
 * 拉到的字体可能是 163KB 也可能是 189KB，只有实测才知道。
 *
 *   node scripts/budget-wire.mjs
 *   node scripts/budget-wire.mjs --base http://localhost:4321/blog
 *
 * 需要本地先 `npm run build` 并起 `npx astro preview`。
 * 只统计同源请求（评论、分享这类第三方 iframe 不算）；每个路由都用禁用缓存的
 * 全新页面，量的就是第一次访问的代价。
 */
import { launchBrowser } from './lib/browser.mjs';
import { WIRE_ROUTES, assertNavigationOk } from './lib/wire-routes.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = getArg('--base', 'http://localhost:4321/blog').replace(/\/$/, '');

const routes = WIRE_ROUTES;

/** 字体单独设一条线：它是首屏最大的一块，回退成「一整片汉字」时总量未必超，但代价回归了 */
const FONT_LIMIT = 200;

const kb = (n) => n / 1024;

const browser = await launchBrowser();

const rows = [];
const failures = [];

for (const route of routes) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });

  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const items = new Map();
  cdp.on('Network.responseReceived', (event) => {
    /* 第三方（评论 iframe、分享按钮）不属于我们能控的范围，剔掉 */
    if (!event.response.url.startsWith(base)) return;
    items.set(event.requestId, { url: event.response.url, type: event.type, size: 0 });
  });
  cdp.on('Network.loadingFinished', (event) => {
    const item = items.get(event.requestId);
    if (item) item.size = event.encodedDataLength;
  });

  try {
    const response = await page.goto(`${base}${route.path}`, { waitUntil: 'networkidle2', timeout: 60_000 });
    assertNavigationOk(response, route.path);
    await page.evaluate(() => document.fonts.ready);
    await new Promise((resolve) => setTimeout(resolve, 400));
  } catch (error) {
    failures.push(`${route.label} ${route.path} 打不开：${error.message}`);
    await page.close();
    continue;
  }

  const loaded = [...items.values()].filter((item) => item.size > 0);
  const total = loaded.reduce((sum, item) => sum + item.size, 0);
  const font = loaded.filter((item) => item.type === 'Font').reduce((sum, item) => sum + item.size, 0);
  const fonts = loaded.filter((item) => item.type === 'Font').map((item) => item.url.split('/').pop());

  rows.push({ ...route, total: kb(total), font: kb(font), count: loaded.length, fonts });

  if (kb(total) > route.limit) {
    failures.push(`${route.label} ${route.path} 传输 ${kb(total).toFixed(1)}KB，超过 ${route.limit}KB`);
  }
  if (kb(font) > FONT_LIMIT) {
    failures.push(`${route.label} ${route.path} 字体 ${kb(font).toFixed(1)}KB，超过 ${FONT_LIMIT}KB`);
  }

  await page.close();
}

await browser.close();

/** 终端里汉字占两格，按显示宽度补齐才好对齐 */
const pad = (text, width) => {
  const shown = [...text].reduce((sum, ch) => sum + (/[\u2e80-\uffff]/.test(ch) ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(0, width - shown));
};

console.log('\n  路由                合计      字体   请求   预算');
for (const row of rows) {
  const ok = row.total <= row.limit ? ' ' : '✗';
  console.log(
    `  ${ok} ${pad(row.label, 18)}${row.total.toFixed(1).padStart(7)}KB ${row.font.toFixed(1).padStart(7)}KB ${String(row.count).padStart(4)}   ${row.limit}KB`
  );
}

const heaviest = rows.reduce((max, row) => (row.total > (max?.total ?? 0) ? row : max), null);
if (heaviest?.fonts.length) console.log(`\n  最重的是「${heaviest.label}」：字体 ${heaviest.fonts.join(' + ')}`);

if (failures.length) {
  console.error('\n✗ 首屏传输超预算：');
  for (const item of failures) console.error(`  ${item}`);
  process.exit(1);
}

console.log(`\n✓ ${rows.length} 条路由都在预算内（字体上限 ${FONT_LIMIT}KB）`);
