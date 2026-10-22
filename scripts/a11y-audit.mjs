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
import puppeteer from 'puppeteer-core';

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
      '/archive/',
      '/series/',
      '/series/从笔记到发布/',
      '/tags/',
      '/tags/Astro/',
      '/category/技术/',
      '/about/',
      '/games/',
      '/games/beanrush/',
      '/search/',
      '/styleguide/',
      '/404.html',
    ];

const axeSource = fs.readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8');

const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  /* CI（ubuntu-latest）与 Linux 桌面 */
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

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
});

const results = [];
let serious = 0;

for (const route of routes) {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const url = base + route;
    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      status = res?.status() ?? 0;
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      await new Promise((r) => setTimeout(r, 250));
      await page.addScriptTag({ content: axeSource });
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
      results.push({ route, theme, status, violations });
    } catch (err) {
      results.push({ route, theme, status, error: String(err).slice(0, 200), violations: [] });
    }
    await page.close();
  }
  console.log(`✓ ${route}`);
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
process.exit(serious > 0 ? 1 : 0);
