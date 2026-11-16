/** Directional grenade routes, using only native input and detached observations. */
import path from 'node:path';

export async function checkRaidGrenades(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage(), held = new Map();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let checkpoint = '初始化';
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = predicate => page.waitForFunction(predicate, { timeout: 5000, polling: 'raf' });
    const phase = expected => page.waitForFunction(value => window.__raidState?.phase === value,
      { timeout: 5000, polling: 'raf' }, expected);
    const activate = async selector => {
      const control = await page.$(selector);await control.scrollIntoView();
      if (mobile) await control.tap();
      else { await control.focus();await page.keyboard.press('Enter'); }
    };
    const keys = { down: 's', jump: ' ', grenade: 'k' };
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
      for (const action of [...held.keys()]) await up(action).catch(() => {});
    };
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-grenade-${label}-${suffix}.png`), fullPage: true });
    const launches = () => page.evaluate(() => window.__grenadeObservations.launches);
    const waitLaunch = count => page.waitForFunction(n => window.__grenadeObservations.launches.length >= n,
      { timeout: 5000, polling: 'raf' }, count);
    page.on('pageerror', error => problems.push(`Pixel Raid 俯掷 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        // Read-only observation avoids trying to catch the short launch frame
        // with a later CDP round trip. No game state, input, RNG or clock changes.
        const evidence = window.__grenadeObservations = { launches: [], inputs: [] };
        for (const type of ['keydown', 'pointerdown']) document.addEventListener(type, event => {
          if (type === 'keydown' && ['s', ' ', 'k'].includes(event.key) ||
              type === 'pointerdown' && event.target.closest?.('[data-action]')) {
            evidence.inputs.push({ type, trusted: event.isTrusted });
          }
        }, true);
        let previous;
        function observe() {
          const state = window.__raidState;
          if (state?.phase === 'playing' && previous?.phase === 'playing' && state.grenades < previous.grenades) {
            evidence.launches.push({ grenade: state.grenadeProjectiles.at(-1), ammo: state.grenades,
              ground: state.ground, face: state.face });
          }
          previous = state;requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait(() => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写游戏入口');
      await activate('#difficulty-relaxed');await activate('#start');await phase('playing');
      const initialAmmo = (await read()).grenades;
      checkpoint = '原生跳跃与俯掷';
      await down('down');await down('jump');
      await wait(() => !window.__raidState.ground && window.__raidState.vy < 0);
      await down('grenade');await waitLaunch(1);
      // Pause before releasing contacts or taking screenshots so the live fuse
      // cannot expire while the browser captures the evidence.
      await activate('#pause');await phase('pause');await release();
      const dive = (await launches())[0];
      require(dive.grenade?.aim === 'down' && dive.grenade.vx === dive.face * 120 && dive.grenade.vy > 0 &&
        dive.ammo === initialAmmo - 1 && !dive.ground, '空中下键未产生向下手雷', dive);
      const frozen = await read();
      require(frozen.grenadeProjectiles.length === 1 && frozen.grenadeProjectiles[0].timer > 0,
        '暂停前手雷已丢失', frozen);
      await shot('dive-paused');
      checkpoint = '暂停及取消重开冻结手雷引信';
      await new Promise(resolve => setTimeout(resolve, 250));
      require(JSON.stringify((await read()).grenadeProjectiles) === JSON.stringify(frozen.grenadeProjectiles), '暂停仍推进手雷');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require(JSON.stringify((await read()).grenadeProjectiles) === JSON.stringify(frozen.grenadeProjectiles) &&
        (await read()).grenades === initialAmmo - 1, '取消重开改变引信或弹药');
      await activate('#start');await phase('playing');
      await wait(() => window.__raidState.ground && window.__raidState.grenadeProjectiles.length === 0);
      checkpoint = '地面下蹲保持普通抛投且长按不连掷';
      await down('down');await down('grenade');await waitLaunch(2);
      const ground = (await launches())[1];
      require(ground.grenade?.aim === 'arc' && ground.grenade.vx === ground.face * 330 && ground.grenade.vy < 0 &&
        ground.ammo === initialAmmo - 2 && ground.ground, '地面下键错误改成俯掷', ground);
      await new Promise(resolve => setTimeout(resolve, 1300));
      require((await read()).grenades === initialAmmo - 2 && (await launches()).length === 2, '长按手雷重复消耗弹药');
      await up('grenade');await up('down');
      checkpoint = '空中松开下键恢复普通抛投';
      await down('down');await down('jump');
      await wait(() => !window.__raidState.ground && window.__raidState.vy < 0);
      await up('down');await down('grenade');await waitLaunch(3);
      await activate('#pause');await phase('pause');await release();
      const arc = (await launches())[2];
      require(arc.grenade?.aim === 'arc' && arc.grenade.vx === arc.face * 330 && arc.grenade.vy < 0 &&
        arc.ammo === initialAmmo - 3 && !arc.ground, '松开下键后空中仍然俯掷', arc);
      await shot('arc-paused');
      const inputs = await page.evaluate(() => window.__grenadeObservations.inputs);
      require(inputs.length >= 8 && inputs.every(input => input.trusted), '投掷路线不是原生输入', inputs);
      checkpoint = '确认重开清除手雷及按键残留';
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      await new Promise(resolve => setTimeout(resolve, 180));
      const restarted = await read();
      require(restarted.grenadeProjectiles.length === 0 && restarted.grenades === initialAmmo && restarted.touchCount === 0,
        '重开残留手雷或消耗新局弹药', restarted);
      await activate('#pause');await phase('pause');
      await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open &&
        !document.querySelector('#survival-guide').open && document.documentElement.scrollWidth <= innerWidth + 1), '大厅展开或横向溢出');
      await shot('lobby');
    } catch (error) {
      problems.push(`Pixel Raid 俯掷 ${label}：${checkpoint}：${error.message}`);await shot('error').catch(() => {});
    } finally { await release();await context.close(); }
  }
}
