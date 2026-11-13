/** Independent temporary-firepower timers, reached through native inputs only. */
import path from 'node:path';

export async function checkRaidFirepower(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage(), held = new Map();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let checkpoint = '初始化';
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = predicate => page.waitForFunction(predicate, { timeout: 20000, polling: 'raf' });
    const phase = expected => page.waitForFunction(value => window.__raidState?.phase === value,
      { timeout: 5000, polling: 'raf' }, expected);
    const activate = async selector => {
      const control = await page.$(selector);await control.scrollIntoView();
      if (mobile) await control.tap();
      else { await control.focus();await page.keyboard.press('Enter'); }
    };
    const keys = { right: 'd', fire: 'j', jump: ' ' };
    const down = async action => {
      if (held.has(action)) return;
      if (mobile) {
        const point = await page.$eval(`[data-action="${action}"]`, element => {
          element.scrollIntoView({ block: 'end' });const r = element.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
        });
        require(point.w >= 42 && point.h >= 44 && point.x > 0 && point.x < 320 && point.y > 0 && point.y < 844,
          '触控目标不可达：' + action, point);
        held.set(action, await page.touchscreen.touchStart(point.x, point.y));
      } else { await page.keyboard.down(keys[action]);held.set(action, true); }
    };
    const up = async action => {
      if (!held.has(action)) return;
      if (mobile) await held.get(action).end();else await page.keyboard.up(keys[action]);
      held.delete(action);
    };
    const release = async () => {
      // Release each contact independently so a failed release cannot strand the others.
      for (const action of [...held.keys()]) await up(action).catch(() => {});
    };
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-firepower-${label}-${suffix}.png`), fullPage: true });
    const evidence = () => page.evaluate(() => ({ state: window.__raidState, text: document.querySelector('#weapon').textContent,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    const checkLabel = value => {
      const { state: s, text } = value;
      const match = text.match(/^(步枪|散弹 (\d+)s)(?: · 连射 (\d+)s)?$/);
      require(match, '武器文案结构错误', value);
      require((s.weaponTime > 0) === (match[1] !== '步枪') && (s.boostTime > 0) === Boolean(match[3]), '强化显示遗漏或过期残留', value);
      // HUD refreshes at 10 Hz. Allow its previous tick, not arbitrary drift.
      for (const [time, displayed] of [[s.weaponTime, match[2]], [s.boostTime, match[3]]]) if (time > 0) {
        require(Number(displayed) >= Math.ceil(time) && Number(displayed) <= Math.ceil(time + .12), '倒计时不对应真实效果', value);
      }
      require(!value.overflow, '武器状态横向溢出', value);
    };
    page.on('pageerror', error => problems.push(`Pixel Raid 火力 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        window.__firepowerInputs = [];
        for (const type of ['keydown', 'pointerdown']) document.addEventListener(type, event => {
          if (type === 'keydown' && ['d', 'j', ' '].includes(event.key) ||
              type === 'pointerdown' && event.target.closest?.('[data-action]')) {
            window.__firepowerInputs.push({ type, trusted: event.isTrusted });
          }
        }, true);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait(() => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写游戏入口');
      await activate('#difficulty-relaxed');await activate('#start');await phase('playing');
      checkpoint = '真实移动领取散弹并跨越两处深坑';
      await down('right');await down('fire');
      await wait(() => window.__raidState.weaponTime > 0);
      // Fixed, visible first-chapter geometry. Jump before each gap and once
      // more to reach the raised boost pickup (x2240, y332), using real
      // keyboard edges or simultaneous native touchscreen contacts. No state,
      // randomness, clock, health or enemy behavior is replaced by this test.
      for (const x of [780, 1640, 2180]) {
        await page.waitForFunction(target => window.__raidState.x >= target,
          { timeout: 12000, polling: 'raf' }, x);
        await down('jump');
        await wait(() => !window.__raidState.ground && window.__raidState.vy < 0);
        await up('jump');
      }
      checkpoint = '领取连射且保留散弹';
      await wait(() => window.__raidState.boostTime > 0);
      await release();await activate('#pause');await phase('pause');
      const dual = await evidence();
      require(dual.state.weaponTime > 0 && dual.state.boostTime > 10 && dual.state.checkpoint === 2170 && dual.state.lives === 4,
        '未通过真实路线同时获得两种强化', dual);
      checkLabel(dual);await shot('dual-paused');
      const inputs = await page.evaluate(() => window.__firepowerInputs);
      require(inputs.length >= 5 && inputs.every(input => input.trusted), '不是原生操作', inputs);
      checkpoint = '暂停和取消重开冻结两个倒计时';
      const frozen = await read();await new Promise(resolve => setTimeout(resolve, 250));
      require(JSON.stringify(await read()) === JSON.stringify(frozen), '暂停仍消耗强化');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require(JSON.stringify(await read()) === JSON.stringify(frozen), '取消重开改变强化或战斗状态');
      checkLabel(await evidence());
      await activate('#start');await phase('playing');await down('fire');
      checkpoint = '散弹先结束，连射继续单独计时';
      await wait(() => window.__raidState.weaponTime === 0 && window.__raidState.boostTime > 0 &&
        /^步枪 · 连射 \d+s$/.test(document.querySelector('#weapon').textContent));
      checkLabel(await evidence());await shot('rapid-only');
      checkpoint = '两种强化均到期回到步枪';
      await wait(() => window.__raidState.boostTime === 0 && document.querySelector('#weapon').textContent === '步枪');
      await release();await activate('#pause');await phase('pause');
      const expired = await evidence();checkLabel(expired);
      require(expired.state.weapon === 'rifle' && expired.state.weaponTime === 0 && expired.state.boostTime === 0,
        '强化到期未恢复步枪', expired);
      await shot('expired');
      checkpoint = '返回大厅不新增展开面板';
      await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
        document.querySelector('#result-details').hidden && document.querySelector('#weapon').textContent === '步枪' &&
        document.documentElement.scrollWidth <= innerWidth + 1), '大厅残留强化或展开面板');
      await shot('lobby');
    } catch (error) {
      problems.push(`Pixel Raid 火力 ${label}：${checkpoint}：${error.message}`);await shot('error').catch(() => {});
    } finally { await release();await context.close(); }
  }
}
