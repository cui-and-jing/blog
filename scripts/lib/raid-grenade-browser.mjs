/** Directional grenade routes, using only native input and detached observations. */
import path from 'node:path';
import fs from 'node:fs';

export async function checkRaidGrenades(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage(), held = new Map();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let stage = '初始化', checkpoint = '初始化';
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = (description, predicate) => {
      checkpoint = stage + '：' + description;
      return page.waitForFunction(predicate, { timeout: 5000, polling: 'raf' });
    };
    const phase = expected => {
      checkpoint = stage + '：等待界面 ' + expected;
      return page.waitForFunction(value => window.__raidState?.phase === value,
        { timeout: 5000, polling: 'raf' }, expected);
    };
    const activate = async selector => {
      checkpoint = stage + '：操作按钮 ' + selector;
      const control = await page.$(selector);await control.scrollIntoView();
      if (mobile) await control.tap();
      else { await control.focus();await page.keyboard.press('Enter'); }
    };
    const keys = { down: 's', jump: ' ', grenade: 'k' };
    const down = async action => {
      if (held.has(action)) return;
      checkpoint = stage + '：按住 ' + action;
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
      checkpoint = stage + '：释放 ' + action;
      if (mobile) await held.get(action).end();else await page.keyboard.up(keys[action]);
      held.delete(action);
    };
    const release = async () => {
      for (const action of [...held.keys()]) await up(action).catch(() => {});
    };
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-grenade-${label}-${suffix}.png`), fullPage: true });
    const launches = () => page.evaluate(() => window.__grenadeObservations.launches);
    const waitLaunch = count => {
      checkpoint = stage + '：等待第 ' + count + ' 次投掷证据';
      return page.waitForFunction(n => window.__grenadeObservations.launches.length >= n,
        { timeout: 5000, polling: 'raf' }, count);
    };
    page.on('pageerror', error => problems.push(`Pixel Raid 俯掷 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        // Read-only observation avoids trying to catch the short launch frame
        // with a later CDP round trip. No game state, input, RNG or clock changes.
        const evidence = window.__grenadeObservations = { launches: [], inputs: [], fuseFrames: [] };
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'click']) document.addEventListener(type, event => {
          const target = event.target.closest?.('[data-action], button');
          if (type.startsWith('key') && ['s', ' ', 'k'].includes(event.key) || target) {
            evidence.inputs.push({ type, key: event.key, action: target?.dataset.action,
              id: target?.id, pointerId: event.pointerId, primary: event.isPrimary,
              trusted: event.isTrusted, phase: window.__raidState?.phase });
          }
        }, true);
        let previous;
        function observe() {
          const state = window.__raidState;
          if (state?.phase === 'playing' && previous?.phase === 'playing' && state.grenades < previous.grenades) {
            evidence.launches.push({ grenade: state.grenadeProjectiles.at(-1), ammo: state.grenades,
              ground: state.ground, face: state.face });
          }
          if (state?.phase === 'playing' && evidence.launches.length === 1 && state.grenadeProjectiles.length === 1) {
            const grenade = state.grenadeProjectiles[0], canvas = document.getElementById('field');
            const x = Math.round(grenade.x - 13) + Math.round(-state.cam), y = Math.round(grenade.y - 18);
            if (x >= 0 && x + 26 <= canvas.width && y >= 0 && y + 4 <= canvas.height) {
              const data = canvas.getContext('2d').getImageData(x, y, 26, 4).data;
              let normal = 0, late = 0;
              for (let i = 0; i < data.length; i += 4) {
                if (data[i] === 255 && data[i + 1] === 226 && data[i + 2] === 154) normal++;
                if (data[i] === 255 && data[i + 1] === 244 && data[i + 2] === 204) late++;
              }
              const expected = Math.max(1, Math.round(26 * Math.min(1, grenade.timer / 1.1)));
              evidence.fuseFrames.push({ timer: grenade.timer, expected, normal, late });
              if (grenade.timer <= .3 && !window.__grenadeFuseLateCanvas)
                window.__grenadeFuseLateCanvas = canvas.toDataURL('image/png').split(',')[1];
            }
          }
          previous = state;requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait('等待游戏初始化', () => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写游戏入口');
      await activate('#difficulty-relaxed');await activate('#start');await phase('playing');
      const initialAmmo = (await read()).grenades;
      stage = '原生跳跃与俯掷';
      await down('down');await down('jump');
      await wait('等待原生跳跃进入上升阶段', () => !window.__raidState.ground && window.__raidState.vy < 0);
      await down('grenade');await waitLaunch(1);
      // Finish the gameplay contacts before tapping a click-only menu button.
      // The first CI failure screenshot showed a spent grenade, held jump
      // and live play with no pause overlay after tapping with three fingers.
      // A new finger while others remain down is non-primary and may not
      // generate the compatibility click that #pause listens for. Keep the
      // live-grenade assertion below: releasing must not outlast the fuse.
      await release();await activate('#pause');await phase('pause');
      const dive = (await launches())[0];
      require(dive.grenade?.aim === 'down' && dive.grenade.vx === dive.face * 120 && dive.grenade.vy > 0 &&
        dive.ammo === initialAmmo - 1 && !dive.ground, '空中下键未产生向下手雷', dive);
      const frozen = await read();
      require(frozen.grenadeProjectiles.length === 1 && frozen.grenadeProjectiles[0].timer > 0,
        '暂停前手雷已丢失', frozen);
      await shot('dive-paused');
      stage = '暂停及取消重开冻结手雷引信';
      await new Promise(resolve => setTimeout(resolve, 250));
      require(JSON.stringify((await read()).grenadeProjectiles) === JSON.stringify(frozen.grenadeProjectiles), '暂停仍推进手雷');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require(JSON.stringify((await read()).grenadeProjectiles) === JSON.stringify(frozen.grenadeProjectiles) &&
        (await read()).grenades === initialAmmo - 1, '取消重开改变引信或弹药');
      await activate('#start');await phase('playing');
      await wait('等待落地及手雷自然引爆', () => window.__raidState.ground && window.__raidState.grenadeProjectiles.length === 0);
      const fuse = await page.evaluate(() => window.__grenadeObservations.fuseFrames);
      const early = fuse.filter(frame => frame.timer > .3), late = fuse.filter(frame => frame.timer <= .3);
      require(early.length > 0 && late.length > 0 && early[0].expected > late.at(-1).expected &&
        fuse.every(frame => frame.timer > 0 && (frame.timer <= .3 ?
          frame.late === frame.expected * 4 && frame.normal === 0 : frame.normal === frame.expected * 4 && frame.late === 0)),
      '实际画布引信条没有按真实计时缩短、在末段变亮或保持可见', fuse);
      const fuseImage = await page.evaluate(() => window.__grenadeFuseLateCanvas);
      require(typeof fuseImage === 'string' && fuseImage.length > 0, '缺少真实引信末段截图');
      fs.writeFileSync(path.join(process.cwd(), '.shots', `pixelraid-grenade-${label}-fuse-late.png`), Buffer.from(fuseImage, 'base64'));
      stage = '地面下蹲保持普通抛投且长按不连掷';
      await down('down');await down('grenade');await waitLaunch(2);
      const ground = (await launches())[1];
      require(ground.grenade?.aim === 'arc' && ground.grenade.vx === ground.face * 330 && ground.grenade.vy < 0 &&
        ground.ammo === initialAmmo - 2 && ground.ground, '地面下键错误改成俯掷', ground);
      await new Promise(resolve => setTimeout(resolve, 1300));
      require((await read()).grenades === initialAmmo - 2 && (await launches()).length === 2, '长按手雷重复消耗弹药');
      await up('grenade');await up('down');
      stage = '空中松开下键恢复普通抛投';
      await down('down');await down('jump');
      await wait('等待原生跳跃进入上升阶段', () => !window.__raidState.ground && window.__raidState.vy < 0);
      await up('down');await down('grenade');await waitLaunch(3);
      await release();await activate('#pause');await phase('pause');
      const arc = (await launches())[2];
      require(arc.grenade?.aim === 'arc' && arc.grenade.vx === arc.face * 330 && arc.grenade.vy < 0 &&
        arc.ammo === initialAmmo - 3 && !arc.ground, '松开下键后空中仍然俯掷', arc);
      await shot('arc-paused');
      const inputs = await page.evaluate(() => window.__grenadeObservations.inputs);
      const gameplayPresses = inputs.filter(input => input.type === 'keydown' && ['s', ' ', 'k'].includes(input.key) ||
        input.type === 'pointerdown' && ['down', 'jump', 'grenade'].includes(input.action));
      require(gameplayPresses.length >= 8 && inputs.every(input => input.trusted), '投掷路线不是原生输入', inputs);
      stage = '确认重开清除手雷及按键残留';
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
      const evidence = await page.evaluate(() => ({ state: window.__raidState,
        observation: window.__grenadeObservations, active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action),
        focused: document.activeElement?.id, scrollY, viewport: { width: innerWidth, height: innerHeight }
      })).catch(diagnosticError => ({ error: diagnosticError.message }));
      problems.push(`Pixel Raid 俯掷 ${label}：${checkpoint}：${error.message} · evidence=${JSON.stringify(evidence)}`);
      await shot('error').catch(() => {});
    } finally { await release();await context.close(); }
  }
}
