/** Real damage, failure and retry. No mutable game hooks or clock shortcuts. */
import path from 'node:path';

export async function checkRaidRecap(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let checkpoint = '初始化';
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details ? ' ' + JSON.stringify(details) : ''));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const phase = expected => page.waitForFunction(value => window.__raidState?.phase === value,
      { timeout: 30000, polling: 'raf' }, expected);
    const activate = async selector => {
      const control = await page.$(selector);await control.scrollIntoView();
      if (mobile) await control.tap();
      else { await control.focus();await page.keyboard.press('Enter'); }
    };
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-recap-${label}-${suffix}.png`), fullPage: true });
    page.on('pageerror', error => problems.push(`Pixel Raid 复盘 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        window.__recapDamage = [];let hp = null;
        const observe = () => {
          const s = window.__raidState;
          if (s) {
            if (hp !== null && s.hp < hp) window.__recapDamage.push({ hp: s.hp, text: s.combatText, phase: s.phase });
            hp = s.hp;
          }
          requestAnimationFrame(observe);
        };requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await page.waitForFunction(() => window.__raidReady, { timeout: 10000 });
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写测试入口');
      await activate('#mode-survival');await activate('#loadout-counter');await activate('#start');await phase('playing');
      checkpoint = '真实敌人造成伤害和阵亡';
      // Standing on the first wave's ground invites real walkers and their
      // projectiles. Do not inject a killing hit, alter health or fast-forward.
      await phase('survivalOver');
      await page.waitForFunction(() => window.__recapDamage.some(hit => hit.hp === 0), { timeout: 3000 });
      const result = await page.evaluate(() => ({ state: window.__raidState, hits: window.__recapDamage,
        text: document.querySelector('#overlay-text').textContent,
        live: document.querySelector('#announcer').textContent, focused: document.activeElement.id,
        results: document.querySelector('#result-details').textContent }));
      const lethal = result.hits.at(-1), cause = lethal.text.split(' · ')[0];
      require(result.hits.length >= 5 && result.hits.every(hit => /^(敌方子弹|敌人接触) · 连击中断$/.test(hit.text)), '实际受击来源没有显示', result.hits);
      require(lethal.hp === 0 && result.text.includes('致命来源：' + cause + '。') && result.live.includes(result.text), '致命来源、可见复盘和读屏播报不一致', result);
      require(result.text.includes(cause === '敌方子弹' ? '冲刺接触敌弹可反弹' : '拉开距离再开火'), '复盘没有提供对应反制', result.text);
      require(result.focused === 'start' && result.state.score === 0 && result.state.survivalCleared === 0 && result.results.includes('本波未计入纪录'), '失败焦点或奖励规则被改变', result);
      require(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '失败菜单横向溢出');
      await shot('failure');
      checkpoint = '冻结失败结果及原生重试';
      const frozen = await read();await new Promise(resolve => setTimeout(resolve, 250));
      require(JSON.stringify(await read()) === JSON.stringify(frozen), '失败画面继续结算战斗');
      await activate('#start');await phase('playing');
      const retry = await read();
      require(retry.hp === 5 && retry.survivalWave === 1 && retry.combatText === '' && retry.loadout === 'counter' && retry.touchCount === 0, '重试残留复盘或改变装具', retry);
      checkpoint = '暂停与取消重开不显示旧复盘';
      await activate('#pause');await phase('pause');
      require(await page.$eval('#overlay-text', el => !el.textContent.includes('致命来源')), '暂停菜单残留旧复盘');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require(await page.$eval('#overlay-text', el => !el.textContent.includes('致命来源')), '取消重开恢复旧复盘');
      checkpoint = '返回大厅保持清爽';
      await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      require(await page.evaluate(() => !document.querySelector('#overlay-text').textContent.includes('致命来源') &&
        document.querySelector('#result-details').hidden && !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open), '大厅残留复盘或展开面板');
      await shot('lobby');
    } catch (error) {
      problems.push(`Pixel Raid 复盘 ${label}：${checkpoint}：${error.message}`);await shot('error').catch(() => {});
    } finally { await context.close(); }
  }
}
