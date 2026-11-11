import fs from 'node:fs';
import path from 'node:path';

/** The landing page must stay compact without hiding either game or its help. */
export async function checkGameHall(browser, base, check) {
  const page = await browser.newPage();
  fs.mkdirSync('.shots', { recursive: true });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  try {
    for (const width of [320, 390, 600, 800, 1280]) {
      await page.setViewport({ width, height: 900, isMobile: width < 600, hasTouch: width < 600 });
      await page.goto(base + '/games/', { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const state = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.game-card')];
        const bounds = cards.map(card => card.getBoundingClientRect());
        const actions = [...document.querySelectorAll('.game-actions a')];
        return {
          cards: cards.length,
          titles: cards.map(card => card.querySelector('h2').textContent),
          sameRow: bounds.length === 2 && Math.abs(bounds[0].top - bounds[1].top) < 1,
          sameSize: bounds.length === 2 && Math.abs(bounds[0].width - bounds[1].width) < 1 && Math.abs(bounds[0].height - bounds[1].height) < 1,
          bottom: bounds.map(b => b.bottom),
          cols: getComputedStyle(document.querySelector('.game-grid')).gridTemplateColumns.trim().split(/\s+/).length,
          overflow: document.documentElement.scrollWidth - innerWidth,
          guideClosed: !document.querySelector('.game-guide').open,
          targets: actions.map(a => ({ w: a.getBoundingClientRect().width, h: a.getBoundingClientRect().height, label: a.getAttribute('aria-label'), href: a.getAttribute('href'), target: a.target, rel: a.rel })),
        };
      });
      check(`${width}px 大厅双入口清晰、响应式且无溢出`,
        state.cards === 2 && state.cols === (width > 600 ? 2 : 1) && state.overflow <= 0 && state.guideClosed
          && (width <= 600 || (state.sameRow && state.sameSize)), JSON.stringify(state));
      check(`${width}px 四个入口有明确名称与至少44px触控高度`,
        state.targets.length === 4 && state.targets.every(t => t.w >= 44 && t.h >= 44 && t.label)
          && state.targets.filter(t => t.target === '_blank').every(t => t.rel.includes('noopener')));
      if (width === 1280) check('桌面首屏可见两个开始入口', state.bottom.every(b => b < 900), JSON.stringify(state.bottom));
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        await page.screenshot({ path: path.join('.shots', `lobby-${width}-${theme}.png`), fullPage: true });
      }
      await page.focus('.game-guide summary');
      await page.keyboard.press('Enter');
      const opened = await page.evaluate(() => ({
        open: document.querySelector('.game-guide').open,
        columns: [...document.querySelectorAll('.game-facts')].map(list => getComputedStyle(list).gridTemplateColumns.trim().split(/\s+/).length),
        overflow: document.documentElement.scrollWidth - innerWidth,
        focused: document.activeElement.matches('.game-guide summary'),
      }));
      check(`${width}px 键盘展开玩法说明并保留焦点`, opened.open && opened.focused && opened.overflow <= 0
        && opened.columns.length === 2 && opened.columns.every(n => n === (width <= 900 ? 2 : 4)), JSON.stringify(opened));
      await page.keyboard.press('Space');
      check(`${width}px 空格收起说明，不更改地址`, await page.evaluate(() => !document.querySelector('.game-guide').open) && page.url() === base + '/games/');
    }
    await page.setViewport({ width: 1280, height: 900 });
    for (const slug of ['beanrush', 'pixelraid']) {
      await page.goto(base + '/games/', { waitUntil: 'load' });
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click(`.game-play[href$="/${slug}/"]`)]);
      check(`${slug} 从大厅进入正确试玩页`, page.url() === `${base}/games/${slug}/`);
      await page.goBack({ waitUntil: 'load' });
      check(`${slug} 返回大厅不丢入口`, await page.$$eval('.game-play', els => els.length) === 2);
    }
    await page.setJavaScriptEnabled(false);
    await page.goto(base + '/games/', { waitUntil: 'load' });
    await page.click('.game-guide summary');
    check('不启用 JavaScript 仍可展开说明并进入游戏', await page.evaluate(() => document.querySelector('.game-guide').open && document.querySelectorAll('.game-play').length === 2));
  } finally { await page.close(); }
}
