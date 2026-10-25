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
      return {
        targets,
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
