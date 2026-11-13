/** Reserved medical supplies with native input and real enemy damage only. */
import path from 'node:path';

export async function checkRaidPickups(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let checkpoint = '初始化', contact = null, moving = false;
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details ? ' ' + JSON.stringify(details) : ''));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = predicate => page.waitForFunction(predicate, { timeout: 15000, polling: 'raf' });
    const phase = expected => page.waitForFunction(value => window.__raidState?.phase === value,
      { timeout: 6000, polling: 'raf' }, expected);
    const activate = async selector => {
      const control = await page.$(selector);await control.scrollIntoView();
      if (mobile) await control.tap();
      else { await control.focus();await page.keyboard.press('Enter'); }
    };
    const release = async () => {
      if (contact) { await contact.end();contact = null; }
      if (moving) { await page.keyboard.up('a');moving = false; }
    };
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-pickups-${label}-${suffix}.png`), fullPage: true });
    page.on('pageerror', error => problems.push(`Pixel Raid 补给 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        // Observe detached public snapshots. No mutation of game state, time,
        // health, enemy behavior or pickup positions is used by this test.
        window.__pickupFrames = [];window.__pickupInputs = [];
        for (const type of ['keydown', 'pointerdown']) document.addEventListener(type, event => {
          if (type === 'keydown' && event.key === 'a' ||
            type === 'pointerdown' && event.target.closest?.('[data-action="left"]')) {
            window.__pickupInputs.push({ type, trusted: event.isTrusted });
          }
        }, true);
        const observe = () => {
          const s = window.__raidState, p = s?.mode === 'survival' && s.pickups.find(item => item.kind === 'heal');
          if (p && window.__pickupFrames.length < 2400) window.__pickupFrames.push({
            phase: s.phase, clock: s.clock, x: s.x, hp: s.hp, maxHp: s.maxHp,
            score: s.score, done: p.done, spawn: s.spawnTime, text: s.combatText,
            live: document.querySelector('#announcer')?.textContent,
          });
          requestAnimationFrame(observe);
        };requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait(() => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写测试入口');
      await activate('#mode-survival');await activate('#start');await phase('playing');
      checkpoint = '预警中满血接触医疗包';
      if (mobile) {
        const point = await page.$eval('[data-action="left"]', element => {
          element.scrollIntoView({ block: 'end' });const r = element.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
        });
        require(point.w >= 42 && point.h >= 44 && point.x < 320 && point.y < 844, '左移触控目标不可达', point);
        contact = await page.touchscreen.touchStart(point.x, point.y);
      } else { await page.keyboard.down('a');moving = true; }
      await wait(() => window.__raidState.x <= 58);await release();
      const reserved = await read();
      require(reserved.hp === reserved.maxHp && reserved.score === 0 && !reserved.pickups.find(p => p.kind === 'heal').done,
        '满血医疗被消耗或提前计分', reserved);
      require(reserved.x >= 25 && reserved.x <= 65, '未停在医疗包附近', reserved.x);
      const reservation = await page.evaluate(() => ({
        frame: window.__pickupFrames.find(s => s.phase === 'playing' && s.spawn > 0 && s.text.includes('医疗包留待')),
        inputs: window.__pickupInputs,
      }));
      require(reservation.frame && reservation.frame.hp === reservation.frame.maxHp && reservation.frame.score === 0 && !reservation.frame.done,
        '未观察到预警期的满血留存提示', reservation);
      require(reservation.inputs.length > 0 && reservation.inputs.every(input => input.trusted), '移动不是原生输入', reservation.inputs);
      await shot('reserved');

      checkpoint = '暂停、取消重开保持未消费补给';
      await activate('#pause');await phase('pause');
      const frozen = await read();await new Promise(resolve => setTimeout(resolve, 200));
      require(JSON.stringify(await read()) === JSON.stringify(frozen), '暂停时补给或计时继续变化');
      require(!frozen.pickups.find(p => p.kind === 'heal').done && frozen.score === 0, '预警结束前误领补给');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      const cancelled = await read();
      require(cancelled.clock === frozen.clock && cancelled.hp === frozen.hp && cancelled.score === 0 &&
        JSON.stringify(cancelled.pickups) === JSON.stringify(frozen.pickups), '取消重开改变补给状态', cancelled);
      await activate('#start');await phase('playing');

      checkpoint = '真实敌人伤害触发一次医疗拾取';
      // Stay on the ground next to the preserved medical pack. Real walkers
      // approach from the right. Damage and healing can happen in one update,
      // so a visible health decrease is not required to prove consumption.
      await wait(() => window.__pickupFrames.some(s => s.phase === 'playing' && s.done));
      await activate('#pause');await phase('pause');
      const evidence = await page.evaluate(() => ({ state: window.__raidState,
        frames: window.__pickupFrames.filter(s => s.phase === 'playing') }));
      const index = evidence.frames.findIndex(s => s.done), first = evidence.frames[index], before = evidence.frames[index - 1];
      require(before && !before.done && before.score === 0 && first.score === 75 && first.spawn === 0,
        '医疗没有从保留状态转为恰好一次 +75 分', { before, first });
      require(/^(敌方子弹|敌人接触) · 连击中断$/.test(first.text) && first.live === '恢复体力。',
        '拾取未伴随真实受伤，或留存提示盖掉受击来源', first);
      require(first.hp > 0 && first.hp <= first.maxHp && evidence.state.hp <= evidence.state.maxHp &&
        evidence.state.score === 75 && evidence.state.survivalCleared === 0 &&
        evidence.state.pickups.find(p => p.kind === 'heal').done, '医疗上限、单次得分或波次结算错误', evidence.state);
      await shot('collected');
      checkpoint = '重复站位不重复领奖';
      await activate('#start');await phase('playing');
      await page.evaluate(() => new Promise(resolve => {
        let remaining = 12;const tick = () => --remaining > 0 ? requestAnimationFrame(tick) : resolve();
        requestAnimationFrame(tick);
      }));
      await activate('#pause');await phase('pause');
      require((await read()).score === 75 && (await read()).pickups.find(p => p.kind === 'heal').done, '消耗后重复领取医疗或分数');

      checkpoint = '重试重建补给而不保留旧提示';
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      const retry = await read();
      require(retry.score === 0 && retry.hp === retry.maxHp && retry.survivalWave === 1 && retry.combatText === '' &&
        retry.pickups.every(p => !p.done) && retry.touchCount === 0, '重试未重置补给或遗留操作提示', retry);
      await activate('#pause');await phase('pause');await activate('#menu-home');await phase('confirmRestart');
      await activate('#start');await phase('title');
      require((await read()).combatText === '' && await page.evaluate(() =>
        !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
        document.querySelector('#result-details').hidden && document.documentElement.scrollWidth <= innerWidth + 1),
      '返回大厅残留补给提示、展开面板或横向溢出');
      await shot('lobby');
    } catch (error) {
      problems.push(`Pixel Raid 补给 ${label}：${checkpoint}：${error.message}`);await shot('error').catch(() => {});
    } finally { await release().catch(() => {});await context.close(); }
  }
}
