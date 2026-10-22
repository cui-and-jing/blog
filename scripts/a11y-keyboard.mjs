/**
 * 键盘 / 读屏可达性实测（不是静态扫描）。
 *
 *   node scripts/a11y-keyboard.mjs
 *
 * 覆盖：Tab 顺序与焦点环、代码复制播报、字号切换、主题按钮标签、
 * 搜索键盘操作、移动端目录抽屉、横向溢出。
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = (process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:4321/blog').replace(/\/$/, '');

const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const executablePath = process.env.CHROME_PATH ?? edgeCandidates.find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ---------- 1. 首页 Tab 顺序与焦点环 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => document.body.focus());
  const order = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
          outline: `${style.outlineStyle} ${style.outlineWidth}`,
          cls: el.className?.toString().slice(0, 30),
        };
      }),
    );
  }
  check('第一个 Tab 落在「跳到正文」', order[0]?.cls?.includes('skip-link'), order[0]?.text);
  const noOutline = order.filter((o) => o && !o.outline.includes('solid'));
  check('前 10 个焦点元素都有可见 outline', noOutline.length === 0, noOutline.map((o) => o?.text).join(' / '));
  check('焦点顺序进入主导航', order.some((o) => o?.text === '文章'), order.map((o) => o?.text).join(' → '));
  await page.close();
}

/* ---------- 2. 文章页：复制、字号、主题 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${base}/posts/hello-astro/`, { waitUntil: 'load' });
  await page.waitForSelector('.copy-btn');

  const copyState = await page.evaluate(() => {
    const btn = document.querySelector('.copy-btn');
    btn.focus();
    const s = getComputedStyle(btn);
    return { opacity: s.opacity, outline: `${s.outlineStyle} ${s.outlineWidth}`, focused: document.activeElement === btn };
  });
  check('复制按钮常显且可聚焦', copyState.opacity === '1' && copyState.focused, JSON.stringify(copyState));

  await page.evaluate(() => {
    const btn = document.querySelector('.copy-btn');
    btn.click();
  });
  await new Promise((r) => setTimeout(r, 250));
  const announced = await page.evaluate(() => document.getElementById('a11y-status')?.textContent ?? '');
  check('复制后读屏状态区有播报', /复制/.test(announced), announced);

  /* 字号先测：主题切换有圆形扩散过渡（View Transitions），过渡期间点击会被遮罩吃掉 */
  await page.click('[data-size="large"]');
  const large = await page.evaluate(() => {
    const prose = document.querySelector('.prose');
    return {
      reading: document.documentElement.dataset.reading,
      pressed: document.querySelector('[data-size="large"]')?.getAttribute('aria-pressed'),
      size: prose ? getComputedStyle(prose).fontSize : null,
    };
  });
  check('字号切换生效且有 aria-pressed', large.reading === 'large' && large.pressed === 'true', JSON.stringify(large));
  await page.click('[data-size="normal"]');

  const themeBefore = await page.$eval('#theme-toggle', (b) => b.getAttribute('aria-label'));
  await page.click('#theme-toggle');
  await new Promise((r) => setTimeout(r, 700));
  const themeAfter = await page.$eval('#theme-toggle', (b) => b.getAttribute('aria-label'));
  const themeValue = await page.evaluate(() => document.documentElement.dataset.theme);
  check('主题按钮标签随状态变化', themeBefore !== themeAfter, `${themeBefore} → ${themeAfter} (${themeValue})`);
  await page.click('#theme-toggle');
  await new Promise((r) => setTimeout(r, 900));

  await page.screenshot({ path: '.shots/kb-article-focus.png' });
  await page.close();
}

/* ---------- 3. 搜索页键盘操作 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${base}/search/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#search-input');
  await page.type('#search-input', 'astro', { delay: 30 });
  await new Promise((r) => setTimeout(r, 600));
  const state = await page.evaluate(() => ({
    count: document.getElementById('search-count')?.textContent ?? '',
    shown: [...document.querySelectorAll('.search-result')].filter((el) => !el.hidden).length,
    live: document.getElementById('search-count')?.getAttribute('aria-live'),
  }));
  check('搜索有结果且数量区可播报', state.shown > 0 && state.live === 'polite', JSON.stringify(state));

  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  const cleared = await page.$eval('#search-input', (el) => el.value);
  check('Esc 清空搜索框', cleared === '', `value="${cleared}"`);
  await page.close();
}

/* ---------- 4. 移动端目录抽屉 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/posts/hello-astro/`, { waitUntil: 'load' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('390px 无横向溢出', overflow <= 0, `${overflow}px`);

  const fab = await page.$('.toc-fab');
  if (fab) {
    await page.click('.toc-fab');
    await new Promise((r) => setTimeout(r, 400));
    const open = await page.evaluate(() => ({
      dialog: document.getElementById('toc-dialog')?.hasAttribute('open'),
      expanded: document.querySelector('.toc-fab')?.getAttribute('aria-expanded'),
    }));
    check('目录抽屉可打开且 aria-expanded 同步', Boolean(open.dialog) && open.expanded === 'true', JSON.stringify(open));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));
    const closed = await page.evaluate(() => ({
      dialog: document.getElementById('toc-dialog')?.hasAttribute('open'),
      expanded: document.querySelector('.toc-fab')?.getAttribute('aria-expanded'),
    }));
    check('Esc 关闭目录抽屉且状态复位', !closed.dialog && closed.expanded === 'false', JSON.stringify(closed));
  } else {
    check('移动端存在目录入口', false, '未找到 .toc-fab');
  }
  await page.close();
}

/* ---------- 5. 深色模式 390px 首页 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    localStorage.setItem('theme', 'dark');
  });
  await new Promise((r) => setTimeout(r, 300));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('深色 390px 无横向溢出', overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: '.shots/kb-mobile-dark.png', fullPage: false });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
