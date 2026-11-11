/** Lobby hierarchy and progressive disclosure, using the published DOM and real input. */
import path from 'node:path';
import fs from 'node:fs';

export async function checkRaidLobby(page, problems) {
  const originalViewport = page.viewport();
  const axeSource = fs.readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8');
  const check = (ok, message, details) => {
    if (!ok) problems.push('Pixel Raid 指挥部：' + message + (details ? ' ' + JSON.stringify(details) : ''));
  };
  const ready = () => page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
  const phase = name => page.waitForFunction(value => window.__raidState?.phase === value, { timeout: 4000 }, name);
  const read = () => page.evaluate(() => ({ ...window.__raidState }));
  const visible = selector => page.$eval(selector, element => element.checkVisibility());
  const activate = async (selector, key = 'Enter') => {
    await page.focus(selector);
    await page.keyboard.press(key);
  };
  const detailsClosed = () => page.evaluate(() =>
    ['stage-menu', 'campaign-guide', 'survival-guide', 'challenge-guide', 'controls-guide']
      .every(id => !document.getElementById(id).open));
  const home = async () => {
    if ((await read()).phase === 'playing') { await page.keyboard.press('p'); await phase('pause'); }
    await page.click('#menu-home'); await phase('confirmRestart');
    await activate('#start'); await phase('title');
  };

  try {
    for (const viewport of [
      { width: 1280, height: 900, isMobile: false, hasTouch: false },
      { width: 390, height: 844, isMobile: true, hasTouch: true },
      { width: 320, height: 740, isMobile: true, hasTouch: true },
      { width: 844, height: 390, isMobile: true, hasTouch: true },
    ]) {
      await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
      await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
      check(await detailsClosed(), '初次打开未收起补充说明');
      check(!await visible('.hud') && !await visible('.controls') && !await visible('#pause') &&
        !await visible('#restart'), '标题页仍显示战斗控件');

      for (const mode of ['campaign', 'survival', 'challenges']) {
        await activate('#mode-' + mode, 'Space');
        const state = await read();
        check(state.phase === 'title' && state.titleView === mode, '选择玩法提前开始游戏', state);
        await page.evaluate(() => window.scrollTo(0, 0));
        const layout = await page.evaluate(() => {
          const box = selector => {
            const element = document.querySelector(selector), rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom,
              visible: element.checkVisibility() };
          };
          const overlay = document.querySelector('#overlay');
          return {
            width: document.documentElement.scrollWidth, viewport: innerWidth,
            nestedScroll: overlay.scrollHeight > overlay.clientHeight + 1,
            start: box('#start'),
            modes: ['campaign', 'challenges', 'survival'].map(value => box('#mode-' + value)),
            loadouts: ['assault', 'counter', 'demolition'].map(value => box('#loadout-' + value)),
          };
        });
        check(layout.width <= layout.viewport + 1 && !layout.nestedScroll,
          '大厅有横向溢出或嵌套滚动', { viewport, mode, layout });
        check(layout.modes.every(button => button.width >= 44 && button.height >= 44),
          '玩法选择触控区域太小', { viewport, layout });
        if (mode !== 'challenges') {
          check(layout.start.visible && layout.start.width >= 140 && layout.start.height >= 44,
            '主要开始按钮不可用', { viewport, mode, layout });
          if (viewport.width <= 600 && viewport.height >= 700) {
            check(layout.start.bottom <= viewport.height && layout.start.y >= 0,
              '手机首屏看不到完整开始按钮', { viewport, mode, layout });
          }
        } else check(!layout.start.visible, '作战挑战出现无对应任务的开始按钮');
        if (mode === 'survival') check(layout.loadouts.every(button => button.visible && button.height >= 44),
          '装具选择不可见或触控区域太小', { viewport, layout });
        await page.screenshot({
          path: path.join(process.cwd(), '.shots', `pixelraid-lobby-${viewport.width}-${mode}.png`), fullPage: true,
        });
        if (viewport.width === 1280 || viewport.width === 320) {
          // Exercise disclosure with native activation, then audit the expanded DOM too.
          for (const selector of ['#stage-menu', '#campaign-guide', '#survival-guide', '#challenge-guide', '#controls-guide']) {
            if (await visible(selector)) await activate(selector + ' summary');
          }
          if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ content: axeSource });
          const violations = await page.evaluate(async () => (await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          })).violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => ({
            id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target),
          })));
          check(violations.length === 0, '展开说明后有严重无障碍违规', { viewport, mode, violations });
          await page.screenshot({
            path: path.join(process.cwd(), '.shots', `pixelraid-lobby-${viewport.width}-${mode}-expanded.png`), fullPage: true,
          });
          for (const selector of ['#stage-menu', '#campaign-guide', '#survival-guide', '#challenge-guide', '#controls-guide']) {
            if (await visible(selector) && await page.$eval(selector, element => element.open)) await activate(selector + ' summary');
          }
        }
      }

      await activate('#mode-survival');
      for (const kit of ['counter', 'demolition', 'assault']) {
        await activate('#loadout-' + kit, 'Space');
        const state = await read();
        check(state.phase === 'title' && state.selectedLoadout === kit,
          '装具选择未生效或提前开始', state);
      }
      const beforeHelp = await read();
      await activate('#survival-guide summary', 'Space');
      check(await page.$eval('#survival-guide', element => element.open) &&
        JSON.stringify(await read()) === JSON.stringify(beforeHelp), '规则展开改变了游戏状态');
      await activate('#controls-guide summary');
      check(await page.$eval('#controls-guide', element => element.open) &&
        (await read()).phase === 'title', '操作说明的 Enter 被当成开始游戏');
      await activate('#mode-campaign');
      check(await detailsClosed() && !await visible('#survival-guide'), '切换模式保留旧的展开内容');
      await activate('#mode-survival');

      await activate('#start'); await phase('playing');
      check(await detailsClosed() && await visible('.hud') && await visible('#pause') && await visible('#restart'),
        '进入战斗后没有恢复 HUD 或关闭大厅说明');
      if (viewport.hasTouch) {
        const controls = await page.$$eval('.controls [data-action]', buttons => buttons.map(button => {
          const rect = button.getBoundingClientRect();
          return { visible: button.checkVisibility(), width: rect.width, height: rect.height,
            label: button.getAttribute('aria-label') };
        }));
        check(controls.length > 0 && controls.every(button => button.visible && button.width >= 36 &&
          button.height >= 44 && button.label), '开局后触屏控件不可用', { viewport, controls });
      }
      await page.keyboard.press('p'); await phase('pause');
      check(await page.$eval('#start', element => document.activeElement === element), '暂停没有聚焦继续按钮');
      await activate('#controls-guide summary');
      check((await read()).phase === 'pause', '暂停中的说明被当成继续游戏');
      await activate('#controls-guide summary', 'Space');
      check(!await page.$eval('#controls-guide', element => element.open), '空格不能收起操作说明');
      await page.click('#restart'); await phase('confirmRestart');
      await page.click('#cancel-restart'); await phase('pause');
      check(await detailsClosed() && await page.$eval('#start', element => document.activeElement === element),
        '取消重开后焦点或说明状态不正确');
      await page.click('#menu-home'); await phase('confirmRestart');
      await page.click('#cancel-restart'); await phase('pause');
      await home();
      check(await detailsClosed() && !await visible('.hud') && !await visible('.controls') &&
        await page.$eval('#start', element => document.activeElement === element),
        '返回指挥部没有恢复精简界面或焦点');

      await activate('#mode-campaign');
      await activate('#stage-menu summary', 'Space');
      check(await page.$eval('#stage-menu', element => element.open) && (await read()).phase === 'title',
        '练习展开提前开始远征');
      await activate('#stage-1'); await phase('playing');
      check((await read()).mode === 'practice' && await detailsClosed(), '折叠后的练习入口无法开局');
      await home();
    }
  } finally {
    if (originalViewport) await page.setViewport(originalViewport);
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  }
}
