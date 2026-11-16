/** Reflect a real boss projectile, then prove the temporary shooting window. */
import path from 'node:path';
import fs from 'node:fs';

export async function checkRaidBreach(sourcePage, problems) {
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
    const keys = { right: 'd', dash: 'l', fire: 'j' };
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
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-breach-${label}-${suffix}.png`), fullPage: true });
    page.on('pageerror', error => problems.push(`Pixel Raid 首领破甲 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        // Observe public snapshots only. Do not replace inputs, RNG or clocks.
        const evidence = window.__breachObservations = { inputs: [], hits: [], triggered: null };
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'click']) {
          document.addEventListener(type, event => {
            const target = event.target.closest?.('[data-action], button');
            if (type.startsWith('key') && ['d', 'l', 'j'].includes(event.key) || target) {
              evidence.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id,
                primary: event.isPrimary, trusted: event.isTrusted });
            }
          }, true);
        }
        let previous;
        function observe() {
          const s = window.__raidState;
          if (s?.phase === 'playing' && previous?.phase === 'playing') {
            if (s.bossBreachTime > 0 && !evidence.triggered) {
              evidence.triggered = s;
              // Pixels are sampled separately from diagnostic evidence so a
              // failure never dumps a base64 image into the CI log.
              window.__breachActiveCanvas = document.getElementById('field').toDataURL('image/png').split(',')[1];
            }
            if (s.bossHp < previous.bossHp) evidence.hits.push({ damage: previous.bossHp - s.bossHp,
              beforeBreach: previous.bossBreachTime, afterBreach: s.bossBreachTime, shots: s.shots,
              reflections: s.reflections, time: s.challengeTime });
          }
          previous = s;requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait('等待游戏初始化', () => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页存在可写测试入口');
      await activate('#mode-challenges');await activate('#challenge-bosses');await phase('playing');
      const fresh = await read();
      require(fresh.challengeId === 'bosses' && fresh.bossBreachTime === 0 && fresh.shots === 0,
        '没有从全新首领连战开始', fresh);
      stage = '真实走位及冲刺反弹';
      // This controls-only first-boss route was checked in the VM with 0–12
      // simulation frames of delay at both movement release and dash input.
      await down('right');await wait('移动到首发反弹位置', () => window.__raidState.x >= 430);await up('right');
      const positioned = await read();
      require(positioned.x >= 430 && positioned.x < 500 && positioned.face === 1,
        '移动超出首发反弹路线', positioned);
      await wait('等待真实首领子弹接近', () => {
        const s = window.__raidState;
        return s.dashCooldown === 0 && s.hostiles.some(b => b.x > s.x && b.x < s.x + 130 &&
          b.y > s.y - 15 && b.y < s.y + s.playerHeight + 15);
      });
      await down('dash');await up('dash');
      await wait('等待反弹弹实际命中首领', () => window.__breachObservations.triggered !== null);
      // Complete gameplay contacts before the click-only pause button receives
      // a new primary touchscreen contact. No synthetic click or game pause.
      await release();await activate('#pause');await phase('pause');
      const triggered = await page.evaluate(() => window.__breachObservations.triggered);
      require(triggered.reflections === 1 && triggered.shots === 0 && triggered.bossHp === fresh.bossHp - 2 &&
        triggered.bossBreachTime > 0 && triggered.bossBreachTime <= 1.5 &&
        triggered.combatText.includes('首领破甲'), '未证明真实反弹触发破甲', triggered);
      const frozen = await read();
      require(frozen.bossBreachTime > .5 && frozen.hp === fresh.hp, '未及时保留破甲窗口或反弹受伤', frozen);
      const activeCanvas = await page.evaluate(() => window.__breachActiveCanvas);
      require(typeof activeCanvas === 'string' && activeCanvas.length > 0, '缺少破甲生效时的画布截图');
      fs.writeFileSync(path.join(process.cwd(), '.shots', `pixelraid-breach-${label}-active-canvas.png`), Buffer.from(activeCanvas, 'base64'));
      await shot('breach-paused');
      stage = '暂停及取消重开冻结破甲';
      await new Promise(resolve => setTimeout(resolve, 220));
      require((await read()).bossBreachTime === frozen.bossBreachTime, '暂停消耗破甲时间');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require((await read()).bossBreachTime === frozen.bossBreachTime && (await read()).bossHp === frozen.bossHp,
        '取消重开改变破甲或首领体力');
      stage = '破甲增伤及自然到期';
      await activate('#start');await phase('playing');await down('fire');
      await wait('等待普通射击在窗口内造成2点伤害', () => window.__breachObservations.hits.some(hit =>
        hit.shots > 0 && hit.beforeBreach > .05 && hit.afterBreach > 0 && hit.damage === 2));
      await wait('等待破甲自然归零', () => window.__raidState.bossBreachTime === 0);
      await wait('等待窗口结束后射击恢复1点伤害', () => window.__breachObservations.hits.some(hit =>
        hit.shots > 0 && hit.beforeBreach === 0 && hit.afterBreach === 0 && hit.damage === 1));
      await release();await activate('#pause');await phase('pause');
      const expired = await read();
      require(expired.bossBreachTime === 0 && expired.reflections === 1 && expired.bossHp > 0 && expired.shots > 0,
        '到期证据受额外反弹或结算干扰', expired);
      await shot('expired');
      const inputs = await page.evaluate(() => window.__breachObservations.inputs);
      const presses = inputs.filter(input => input.type === 'keydown' && ['d', 'l', 'j'].includes(input.key) ||
        input.type === 'pointerdown' && ['right', 'dash', 'fire'].includes(input.action));
      require(presses.length === 3 && inputs.every(input => input.trusted), '路线不是一次真实走位/冲刺/射击', inputs);
      stage = '确认重开及大厅清理';
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      const restarted = await read();
      require(restarted.bossBreachTime === 0 && restarted.reflections === 0 && restarted.shots === 0 &&
        restarted.bossHp === fresh.bossHp && restarted.touchCount === 0, '重开残留破甲或旧操作', restarted);
      await activate('#pause');await phase('pause');await activate('#menu-home');await phase('confirmRestart');
      await activate('#start');await phase('title');
      require(await page.evaluate(() => window.__raidState.bossBreachTime === 0 &&
        !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
        document.documentElement.scrollWidth <= innerWidth + 1), '大厅残留破甲、展开面板或溢出');
      await shot('lobby');
    } catch (error) {
      const evidence = await page.evaluate(() => ({ state: window.__raidState, observation: window.__breachObservations,
        active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action)
      })).catch(diagnosticError => ({ error: diagnosticError.message }));
      problems.push(`Pixel Raid 首领破甲 ${label}：${checkpoint}：${error.message} · evidence=${JSON.stringify(evidence)}`);
      await shot('error').catch(() => {});
    } finally { await release();await context.close(); }
  }
}
