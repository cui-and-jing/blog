/**
 * 键盘 / 读屏可达性实测（不是静态扫描）。
 *
 *   node scripts/a11y-keyboard.mjs
 *
 * 覆盖：Tab 顺序与焦点环、代码复制播报、字号切换、主题按钮标签、
 * 搜索键盘操作、移动端目录抽屉、横向溢出。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';

const base = (process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:4321/blog').replace(/\/$/, '');

const browser = await launchBrowser();

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

/* ---------- 1.5. 首页阅读入口与系列路线 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  const home = await page.evaluate(() => {
    const primary = document.querySelector('.hero-action--primary');
    const secondary = document.querySelector('.hero-action--secondary');
    const section = document.querySelector('.home-series');
    const cards = [...document.querySelectorAll('.home-series-card')];
    return {
      primary: primary?.getAttribute('href') ?? '',
      secondary: secondary?.getAttribute('href') ?? '',
      labelled: Boolean(section && section.getAttribute('aria-labelledby') === 'home-series-heading'
        && document.getElementById('home-series-heading')),
      seriesCount: cards.length,
      linksGood: cards.every((card) => {
        const seriesLink = card.querySelector('.home-series-head h3 a');
        const steps = [...card.querySelectorAll('.home-series-steps a')];
        const start = card.querySelector('.home-series-start');
        return Boolean(seriesLink?.getAttribute('href')?.includes('/series/')
          && steps.length > 0
          && steps.every((link) => link.getAttribute('href')?.includes('/posts/'))
          && start?.getAttribute('href') === steps[0].getAttribute('href'));
      }),
    };
  });
  check('首页有明确的文章与笔记入口',
    /\/posts\/$/.test(home.primary) && /\/notes\/$/.test(home.secondary), JSON.stringify(home));
  check('首页系列路线有标题、正确顺序与起始链接',
    home.labelled && home.seriesCount > 0 && home.linksGood,
    `${home.seriesCount} 组系列，链接正常: ${home.linksGood}`);

  await page.evaluate(() => document.querySelector('.hero-action--primary')?.focus());
  const focused = await page.evaluate(() => {
    const link = document.querySelector('.hero-action--primary');
    const style = link ? getComputedStyle(link) : null;
    const rect = link?.getBoundingClientRect();
    return {
      active: document.activeElement === link,
      outline: style?.outlineStyle ?? '',
      height: rect?.height ?? 0,
    };
  });
  check('首页阅读入口可键盘聚焦且有焦点环',
    focused.active && focused.outline === 'solid' && focused.height >= 44,
    JSON.stringify(focused));
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
  await page.click('[data-setting="size"][data-value="large"]');
  const large = await page.evaluate(() => {
    const prose = document.querySelector('.prose');
    return {
      reading: document.documentElement.dataset.reading,
      pressed: document.querySelector('[data-setting="size"][data-value="large"]')?.getAttribute('aria-pressed'),
      size: prose ? getComputedStyle(prose).fontSize : null,
    };
  });
  check('字号切换生效且有 aria-pressed', large.reading === 'large' && large.pressed === 'true', JSON.stringify(large));
  await page.click('[data-setting="size"][data-value="normal"]');

  /* 外观设置收在面板里：打开 → 切深色 → 切回浅色 → Esc 关闭，顺带验焦点归还 */
  await page.click('#settings-toggle');
  await new Promise((r) => setTimeout(r, 450));
  const panelOpen = await page.evaluate(() => ({
    open: document.getElementById('settings-panel')?.hasAttribute('open'),
    expanded: document.getElementById('settings-toggle')?.getAttribute('aria-expanded'),
    inside: Boolean(document.getElementById('settings-panel')?.contains(document.activeElement)),
  }));
  check(
    '设置面板能打开、焦点进入、aria-expanded 同步',
    panelOpen.open && panelOpen.expanded === 'true' && panelOpen.inside,
    JSON.stringify(panelOpen)
  );

  await page.evaluate(() => document.querySelector('[data-setting="theme"][data-value="dark"]')?.click());
  await new Promise((r) => setTimeout(r, 900));
  const themed = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    choice: document.documentElement.dataset.themeChoice,
    pressed: document.querySelector('[data-setting="theme"][data-value="dark"]')?.getAttribute('aria-pressed'),
  }));
  check(
    '面板里切深色生效且三档状态正确',
    themed.theme === 'dark' && themed.choice === 'dark' && themed.pressed === 'true',
    JSON.stringify(themed)
  );

  await page.evaluate(() => document.querySelector('[data-setting="theme"][data-value="light"]')?.click());
  await new Promise((r) => setTimeout(r, 900));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  const back = await page.evaluate(() => ({
    open: document.getElementById('settings-panel')?.hasAttribute('open'),
    expanded: document.getElementById('settings-toggle')?.getAttribute('aria-expanded'),
    focus: document.activeElement?.id,
  }));
  check(
    'Esc 关闭面板并把焦点还给设置按钮',
    !back.open && back.expanded === 'false' && back.focus === 'settings-toggle',
    JSON.stringify(back)
  );

  /* 快捷键表：全靠键盘打开，也要能 Esc 关掉 */
  await page.keyboard.type('?');
  await new Promise((r) => setTimeout(r, 450));
  const shortcuts = await page.evaluate(() => ({
    open: document.getElementById('shortcuts-panel')?.hasAttribute('open'),
    rows: document.querySelectorAll('#shortcuts-panel tbody tr').length,
  }));
  check('按 ? 打开快捷键表', shortcuts.open && shortcuts.rows >= 6, JSON.stringify(shortcuts));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 350));

  await page.screenshot({ path: '.shots/kb-article-focus.png' });
  await page.close();
}

/* ---------- 2.5. 阅读位置精度、进度条、手机目录与章节链接 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 720, deviceScaleFactor: 1 });
  await page.goto(base + '/posts/hello-astro/', { waitUntil: 'load' });
  await page.waitForSelector('.article-card .prose h2');

  const initial = await page.evaluate(() => {
    const prose = document.querySelector('.article-card .prose');
    const box = prose.getBoundingClientRect();
    const top = window.scrollY + box.top;
    const sightline = Math.min(140, window.innerHeight * .22);
    window.scrollTo({ top: top + box.height * .48 - sightline, behavior: 'instant' });
    return { height: box.height, top };
  });
  await new Promise((r) => setTimeout(r, 1100));
  const key = 'reading:pos:' + new URL(base + '/posts/hello-astro/').pathname;
  const saved = await page.evaluate((storageKey) => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null'); } catch { return null; }
  }, key);
  check('正文滚动位置以 v2 正文比例保存，而非整页高度',
    initial.height > 500 && saved?.v === 2 && Math.abs(saved.p - .48) < .07, JSON.stringify({ initial, saved }));

  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const footer = document.createElement('div');
    footer.style.height = '1800px';
    document.body.append(footer);
  });
  const banner = await page.evaluate(() => ({
    visible: !document.getElementById('resume-bar')?.hidden,
    pct: document.getElementById('resume-percent')?.textContent ?? '',
  }));
  check('刷新后显示继续阅读位置', banner.visible && banner.pct.includes('%'), JSON.stringify(banner));

  await page.click('#resume-go');
  await new Promise((r) => setTimeout(r, 1100));
  const resumed = await page.evaluate(() => {
    const rect = document.querySelector('.article-card .prose').getBoundingClientRect();
    const top = rect.top + window.scrollY;
    return (window.scrollY + Math.min(140, window.innerHeight * .22) - top) / rect.height;
  });
  check('文末新增内容改变整页高度仍可恢复相同正文位置',
    Math.abs(resumed - saved.p) < .08, 'saved=' + saved.p + ' resumed=' + resumed);

  /* 手机目录由侧栏克隆，当前章节应同步给两套链接与读屏。 */
  await page.evaluate(() => {
    const heading = document.querySelector('.prose h2');
    const y = heading.getBoundingClientRect().top + scrollY - 160;
    window.scrollTo({ top: y, behavior: 'instant' });
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.click('#bar-toc');
  const toc = await page.evaluate(() => {
    const desktop = document.querySelector('.sidebar .toc a[aria-current="location"]');
    const mobile = document.querySelector('#toc-dialog .toc a[aria-current="location"]');
    return { open: document.getElementById('toc-dialog')?.open,
      same: Boolean(desktop && mobile && desktop.hash === mobile.hash),
      active: Boolean(mobile?.classList.contains('active')) };
  });
  check('手机目录与桌面目录同步当前章节状态',
    toc.open && toc.same && toc.active, JSON.stringify(toc));
  await page.keyboard.press('Escape');

  const anchor = await page.evaluate(() => {
    const first = document.querySelector('.prose h2 .heading-anchor');
    const before = location.hash;
    first?.click();
    return { exists: Boolean(first), before, after: location.hash };
  });
  check('复制章节链接不改变当前锚点或意外跳转',
    anchor.exists && anchor.before === anchor.after, JSON.stringify(anchor));

  await page.evaluate(() => {
    const rect = document.querySelector('.article-card .prose').getBoundingClientRect();
    const top = window.scrollY + rect.top;
    window.scrollTo({ top: top + rect.height - Math.min(140, innerHeight * .22) + 10, behavior: 'instant' });
  });
  await new Promise((r) => setTimeout(r, 1000));
  const finished = await page.evaluate((storageKey) => ({
    progress: document.querySelector('#read-progress span')?.style.transform ?? '',
    cleared: localStorage.getItem(storageKey) === null,
  }), key);
  check('读完正文时进度条达到终点，并清除继续阅读记录',
    finished.progress === 'scaleX(1)' && finished.cleared, JSON.stringify(finished));

  /* 点击不再提示后即使切页，pagehide 也不能重新写回记录。 */
  await page.evaluate((storageKey) => localStorage.setItem(storageKey, JSON.stringify({ v: 2, p: .4 })), key);
  await page.reload({ waitUntil: 'load' });
  await page.click('#resume-close');
  await page.goto(base + '/posts/', { waitUntil: 'load' });
  const dismissed = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  check('主动关闭继续阅读后切页不会重新生成记录', dismissed === null, String(dismissed));
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

/* ---------- 3.2. 搜索分类、URL 历史、键盘播报和索引失败降级 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base + '/search/?q=笔记', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.getElementById('search-type-filters')?.hidden === false, { timeout: 8000 });

  const initial = await page.evaluate(() => ({
    type: document.querySelector('[data-search-type="all"]')?.getAttribute('aria-pressed'),
    types: [...document.querySelectorAll('.search-result')].map((el) => el.getAttribute('data-search-result-type')),
    count: document.getElementById('search-count')?.textContent ?? '',
  }));
  check('有查询词时默认查询文章和笔记',
    initial.type === 'true' && initial.types.includes('note') && initial.types.includes('post'),
    JSON.stringify(initial));

  await page.click('[data-search-type="note"]');
  const notes = await page.evaluate(() => ({
    selected: document.querySelector('[data-search-type="note"]')?.getAttribute('aria-pressed'),
    type: new URL(location.href).searchParams.get('type'),
    results: [...document.querySelectorAll('.search-result')].map((el) => el.getAttribute('data-search-result-type')),
    total: document.getElementById('search-count')?.textContent ?? '',
  }));
  check('笔记筛选更新 URL 且只显示笔记',
    notes.selected === 'true' && notes.type === 'note' &&
    notes.results.length > 0 && notes.results.every((type) => type === 'note'), JSON.stringify(notes));

  await page.click('[data-search-type="all"]');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() =>
    new URL(location.href).searchParams.get('type') === 'note' &&
    document.querySelector('[data-search-type="note"]')?.getAttribute('aria-pressed') === 'true',
    { timeout: 5000 });
  const restored = await page.evaluate(() => ({
    query: document.getElementById('search-input')?.value,
    kinds: [...document.querySelectorAll('.search-result')].map((el) => el.getAttribute('data-search-result-type')),
  }));
  check('浏览器后退恢复搜索类型与关键词',
    restored.query === '笔记' && restored.kinds.length > 0 && restored.kinds.every((type) => type === 'note'),
    JSON.stringify(restored));

  await page.click('#search-input');
  await page.keyboard.press('ArrowDown');
  const announced = await page.evaluate(() => ({
    text: document.getElementById('search-nav-status')?.textContent ?? '',
    active: document.querySelectorAll('.search-result.is-active').length,
    inputFocused: document.activeElement?.id === 'search-input',
  }));
  check('键盘选择结果有读屏播报并保留输入焦点',
    announced.active === 1 && announced.inputFocused && announced.text.includes('第 1 条'),
    JSON.stringify(announced));

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => document.getElementById('search-type-filters')?.hidden === false, { timeout: 8000 });
  const mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    buttons: [...document.querySelectorAll('#search-type-filters button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }),
  }));
  check('390px 手机搜索分类按钮可触控且无横向溢出',
    mobile.overflow <= 0 && mobile.buttons.length === 3 &&
      mobile.buttons.every((b) => b.w >= 44 && b.h >= 44), JSON.stringify(mobile));
  await page.close();

  /* 网络索引暂时打不开时：原生预渲染列表仍可搜，不能错误显示 0 篇。 */
  const offline = await browser.newPage();
  await offline.setViewport({ width: 1280, height: 900 });
  await offline.setRequestInterception(true);
  offline.on('request', (request) => {
    if (request.url().endsWith('/search-index.json')) {
      request.respond({ status: 503, contentType: 'application/json', body: '{}' }).catch(() => {});
    } else {
      request.continue().catch(() => {});
    }
  });
  await offline.goto(base + '/search/?q=Astro&type=note', { waitUntil: 'load' });
  await offline.waitForSelector('#search-index-warning:not([hidden])', { timeout: 8000 });
  const degraded = await offline.evaluate(() => ({
    shown: [...document.querySelectorAll('.search-result')].map((el) => el.getAttribute('data-search-result-type')),
    warning: document.getElementById('search-index-warning')?.textContent ?? '',
    type: new URL(location.href).searchParams.get('type'),
    pressed: document.querySelector('[data-search-type="post"]')?.getAttribute('aria-pressed'),
    disabled: [...document.querySelectorAll('#search-type-filters button')]
      .filter((b) => b.dataset.searchType !== 'post').every((b) => b.disabled),
  }));
  check('全文索引失败时可用文章兜底且提示笔记不可用',
    degraded.shown.length > 0 && degraded.shown.every((type) => type === 'post') &&
      degraded.warning.includes('笔记不可用') && degraded.type === null &&
      degraded.pressed === 'true' && degraded.disabled, JSON.stringify(degraded));
  await offline.$eval('#search-input', (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const clearedFallback = await offline.evaluate(() => ({
    count: document.querySelectorAll('.search-result').length,
    visible: !document.getElementById('search-empty')?.hidden,
  }));
  check('索引失败并清空查询仍列出原始文章',
    clearedFallback.count > 0 && !clearedFallback.visible, JSON.stringify(clearedFallback));
  await offline.close();
}

/* ---------- 3.5. 阅读收藏：跨页、组合筛选与旧链接找回 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${base}/posts/`, { waitUntil: 'load' });
  await page.waitForSelector('#bookmark-filter:not([hidden])').catch(() => {});
  const first = await page.evaluate(() => {
    const card = document.querySelector('#post-grid .card');
    const button = card?.querySelector('button[data-bookmark-id]');
    return {
      id: card?.getAttribute('data-post-id') ?? '',
      category: card?.getAttribute('data-category') ?? '',
      author: card?.getAttribute('data-author') ?? '',
      button: Boolean(button),
    };
  });
  check('文章列表每张卡有独立收藏入口', first.button && first.id.length > 0, JSON.stringify(first));

  await page.click('#post-grid .card:first-child button[data-bookmark-id]');
  const saved = await page.evaluate((id) => {
    const button = document.querySelector('#post-grid .card:first-child button[data-bookmark-id]');
    const raw = JSON.parse(localStorage.getItem('cui-jing:saved-posts:v1') ?? '[]');
    return {
      selected: button?.getAttribute('aria-pressed'),
      text: button?.textContent?.trim(),
      stored: Array.isArray(raw) && raw.includes(id),
      count: document.getElementById('bookmark-count')?.textContent,
    };
  }, first.id);
  check('收藏持久化并同步按钮与计数',
    saved.selected === 'true' && saved.text === '已收藏' && saved.stored && saved.count === '1', JSON.stringify(saved));

  await page.click('#bookmark-filter');
  const only = await page.evaluate(() => ({
    saved: new URL(location.href).searchParams.get('saved'),
    count: [...document.querySelectorAll('#post-grid .card')].filter((el) => !el.hidden).length,
    active: document.getElementById('bookmark-filter')?.getAttribute('aria-current'),
  }));
  check('只看收藏只展示已收藏文章', only.saved === '1' && only.count === 1 && only.active === 'true', JSON.stringify(only));

  await page.evaluate(({ category, author }) => {
    document.querySelector(`[data-post-filter="category"] a[data-filter-value="${category}"]`)?.click();
    document.querySelector(`[data-post-filter="author"] a[data-filter-value="${author}"]`)?.click();
  }, first);
  const combined = await page.evaluate(() => ({
    url: new URL(location.href).searchParams.toString(),
    shown: [...document.querySelectorAll('#post-grid .card')].filter((el) => !el.hidden).length,
  }));
  check('收藏与分类、作者筛选可组合且保留 URL',
    combined.shown === 1 && /saved=1/.test(combined.url)
      && /category=/.test(combined.url) && /author=/.test(combined.url),
    JSON.stringify(combined));

  await page.goto(`${base}/posts/${first.id}/`, { waitUntil: 'load' });
  const article = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button[data-bookmark-id]')];
    return {
      count: buttons.length,
      selected: buttons.map((btn) => btn.getAttribute('aria-pressed')),
    };
  });
  check('文章页两个收藏入口同步已有状态',
    article.count === 2 && article.selected.every((value) => value === 'true'), JSON.stringify(article));

  await page.click('.article-tools button[data-bookmark-id]');
  const removed = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('button[data-bookmark-id]')].map((btn) => btn.getAttribute('aria-pressed')),
    stored: JSON.parse(localStorage.getItem('cui-jing:saved-posts:v1') ?? '[]'),
  }));
  check('文章页取消收藏同步顶部与文末按钮',
    removed.buttons.length === 2 && removed.buttons.every((value) => value === 'false')
      && Array.isArray(removed.stored) && removed.stored.length === 0, JSON.stringify(removed));
  await page.goto(`${base}/posts/?saved=1`, { waitUntil: 'load' });
  const emptySaved = await page.evaluate(() => ({
    shown: [...document.querySelectorAll('#post-grid .card')].filter((el) => !el.hidden).length,
    empty: !document.getElementById('post-filter-empty')?.hidden,
    text: document.getElementById('post-filter-empty-text')?.textContent ?? '',
  }));
  check('取消最后一篇收藏后展示空状态',
    emptySaved.shown === 0 && emptySaved.empty && emptySaved.text.includes('收藏'), JSON.stringify(emptySaved));

  /* GitHub Pages 将不存在的 /games/<slug>/ 返回 404.html。
     在预览服务上使用 404 文档模拟同源旧 URL，避免依赖其 404 fallback 实现。 */
  await page.goto(`${base}/404.html`, { waitUntil: 'load' });
  await page.evaluate((old) => {
    history.replaceState(null, '', old);
    window.dispatchEvent(new Event('popstate'));
  }, `${base}/games/snake/`);
  const legacy = await page.evaluate(() => ({
    shown: !document.getElementById('retired-game-guide')?.hidden,
    link: document.querySelector('#retired-game-guide a')?.getAttribute('href') ?? '',
    heading: document.getElementById('notfound-title')?.textContent ?? '',
  }));
  check('旧游戏地址在 404 页提供当前游戏中心入口',
    legacy.shown && /\/games\/$/.test(legacy.link) && legacy.heading.includes('游戏'), JSON.stringify(legacy));
  await page.evaluate((next) => {
    history.replaceState(null, '', next);
    window.dispatchEvent(new Event('popstate'));
  }, `${base}/not-a-page/`);
  const normal = await page.evaluate(() => document.getElementById('retired-game-guide')?.hidden);
  check('普通 404 不显示旧游戏专用引导', normal === true, String(normal));
  await page.close();
}

/* ---------- 4. 移动端目录抽屉与底部操作条 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/posts/hello-astro/`, { waitUntil: 'load' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('390px 无横向溢出', overflow <= 0, `${overflow}px`);

  const fab = await page.$('#bar-toc');
  if (fab) {
    await page.click('#bar-toc');
    await new Promise((r) => setTimeout(r, 400));
    const open = await page.evaluate(() => ({
      dialog: document.getElementById('toc-dialog')?.hasAttribute('open'),
      expanded: document.getElementById('bar-toc')?.getAttribute('aria-expanded'),
    }));
    check('目录抽屉可打开且 aria-expanded 同步', Boolean(open.dialog) && open.expanded === 'true', JSON.stringify(open));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));
    const closed = await page.evaluate(() => ({
      dialog: document.getElementById('toc-dialog')?.hasAttribute('open'),
      expanded: document.getElementById('bar-toc')?.getAttribute('aria-expanded'),
    }));
    check('Esc 关闭目录抽屉且状态复位', !closed.dialog && closed.expanded === 'false', JSON.stringify(closed));
  } else {
    check('移动端存在目录入口', false, '未找到 #bar-toc');
  }
  await page.close();
}

/* ---------- 5. 触控目标与导航抽屉 ---------- */
{
  /* 44×44 是拇指能稳稳点中的下限。顶栏曾经靠缩字号把 7 项导航塞进一行，
     每个只有 32×31；这一组断言就是防止再退回去 */
  for (const width of [390, 360, 320]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`${base}/`, { waitUntil: 'load' });

    const result = await page.evaluate(() => {
      const visible = (el) => {
        if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const targets = [...document.querySelectorAll('.site-header a, .site-header button, .mobile-bar a, .mobile-bar button')]
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            label: (el.textContent || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 6),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        });
      const actions = [...document.querySelectorAll('.hero-actions a')].map((el) => {
        const rect = el.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      });
      return {
        targets,
        actions,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        linksHidden: getComputedStyle(document.querySelector('.nav-links')).display === 'none',
      };
    });

    const tiny = result.targets.filter((t) => t.width < 44 || t.height < 44);
    check(
      `${width}px 顶栏与操作条的控件都 ≥44×44`,
      tiny.length === 0,
      tiny.length ? JSON.stringify(tiny) : `${result.targets.length} 个控件`
    );
    check(`${width}px 横向不溢出`, result.overflow <= 0, `${result.overflow}px`);
    const smallActions = result.actions.filter((el) => el.width < 44 || el.height < 44);
    check(`${width}px 首页阅读入口易于触控`,
      result.actions.length === 2 && smallActions.length === 0,
      JSON.stringify(result.actions));
    check(`${width}px 导航链接收进抽屉`, result.linksHidden, `nav-links display=none: ${result.linksHidden}`);

    if (width === 390) {
      /* 抽屉：打开、焦点进入、Esc 关闭并归还焦点 */
      await page.click('#menu-toggle');
      await new Promise((r) => setTimeout(r, 400));
      const drawer = await page.evaluate(() => {
        const dialog = document.getElementById('nav-drawer');
        return {
          open: Boolean(dialog?.open),
          expanded: document.getElementById('menu-toggle')?.getAttribute('aria-expanded'),
          inside: Boolean(dialog?.contains(document.activeElement)),
          rows: dialog?.querySelectorAll('.drawer-nav a').length ?? 0,
        };
      });
      check(
        '导航抽屉能打开、焦点进入、aria-expanded 同步',
        drawer.open && drawer.expanded === 'true' && drawer.inside && drawer.rows === 7,
        JSON.stringify(drawer)
      );

      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 400));
      const after = await page.evaluate(() => ({
        open: Boolean(document.getElementById('nav-drawer')?.open),
        expanded: document.getElementById('menu-toggle')?.getAttribute('aria-expanded'),
        focus: document.activeElement?.id,
      }));
      check(
        'Esc 关闭抽屉并把焦点还给菜单按钮',
        !after.open && after.expanded === 'false' && after.focus === 'menu-toggle',
        JSON.stringify(after)
      );
    }

    await page.close();
  }
}

/* ---------- 6. 深色模式 390px 首页 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    localStorage.setItem('settings', JSON.stringify({ theme: 'dark' }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('深色 390px 无横向溢出', overflow <= 0, `${overflow}px`);
  /* 截图只是留证，放系统临时目录，不往仓库里丢文件 */
  await page.screenshot({ path: path.join(os.tmpdir(), 'cui-jing-kb-mobile-dark.png'), fullPage: false });
  await page.close();
}

/* ---------- 7. 笔记页：复制链接能用键盘完成 ---------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  try {
    await browser
      .defaultBrowserContext()
      .overridePermissions(new URL(base).origin, ['clipboard-read', 'clipboard-write']);
  } catch {
    /* 无头环境下个别版本不支持该权限，下面读剪贴板会退回空串 */
  }

  await page.goto(`${base}/notes/`, { waitUntil: 'load' });
  await page.waitForSelector('.note-copy');
  /* 无头窗口默认不在前台，clipboard API 会以「文档未聚焦」拒绝写入 */
  await page.bringToFront();

  await page.evaluate(() => document.querySelector('.note-copy')?.focus());
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));

  const state = await page.evaluate(() => {
    const btn = document.querySelector('.note-copy');
    const style = btn ? getComputedStyle(btn) : null;
    return {
      focused: document.activeElement === btn,
      outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : '',
      label: btn?.querySelector('span')?.textContent ?? '',
      status: document.getElementById('a11y-status')?.textContent ?? '',
    };
  });
  check('笔记复制按钮可聚焦、有焦点环', state.focused && state.outline.includes('solid'), JSON.stringify(state));
  check('回车后按钮改文案并有读屏播报', state.label === '已复制' && state.status.length > 0, JSON.stringify(state));

  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  /* 时间流里复制的是这条笔记的独立页地址，不再是站内锚点 */
  check('剪贴板里是笔记独立页地址', /\/notes\/\d{4}-\d{2}-\d{2}-\d{4}\/$/.test(copied), copied);

  /* 独立页上同一个按钮要复制它自己，而不是跳到别处 */
  await page.goto(`${base}/notes/2026-10-22-1015/`, { waitUntil: 'load' });
  await page.waitForSelector('.note-copy');
  await page.evaluate(() => document.querySelector('.note-copy')?.focus());
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  const own = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('独立页复制的是自己', /\/notes\/2026-10-22-1015\/$/.test(own), own);
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
