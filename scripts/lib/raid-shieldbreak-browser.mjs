/** Reach wave four naturally, stomp its shield guard and observe recovery. */
import path from 'node:path';
import fs from 'node:fs';
import { survivalTactics } from './raid-survival-tactics.mjs';

export async function checkRaidShieldbreak(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage(), held = new Map();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let stage = '初始化', checkpoint = '初始化';
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = (description, predicate, timeout = 5000) => {
      checkpoint = stage + '：' + description;
      return page.waitForFunction(predicate, { timeout, polling: 'raf' });
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
    const keys = { left: 'a', right: 'd', down: 's', jump: 'w', dash: 'l', fire: 'j', grenade: 'k' };
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
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-shieldbreak-${label}-${suffix}.png`), fullPage: true });
    page.on('pageerror', error => problems.push(`Pixel Raid 踏击破盾 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        const evidence = window.__shieldbreakObservations = { inputs: [], broken: null };
        for (const type of ['keydown', 'pointerdown', 'pointerup', 'pointercancel', 'click']) {
          document.addEventListener(type, event => {
            const target = event.target.closest?.('[data-action], button');
            if (type === 'keydown' && ['a', 'd', 's', 'w', 'l', 'j', 'k'].includes(event.key) || target) {
              evidence.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id,
                primary: event.isPrimary, trusted: event.isTrusted });
            }
          }, true);
        }
        function observe() {
          const s = window.__raidState, guard = s?.enemies.find(e => e.type === 'shield' && e.shieldBreak > 0);
          if (s?.survivalWave === 4 && guard && !evidence.broken) {
            evidence.broken = { state: s, guard };
            // Keep image bytes out of the diagnostic object and failure logs.
            window.__shieldbreakCanvas = document.getElementById('field').toDataURL('image/png').split(',')[1];
          }
          requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait('等待游戏初始化', () => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写游戏入口');
      await activate('#mode-survival');await activate('#start');await phase('playing');
      const tapAction = async action => { await down(action);await up(action); };
      // Same player-like decisions as the existing survival suite, using real
      // touch contacts on mobile as well as real keyboard input on desktop.
      for (let wave = 1; wave <= 3; wave++) {
        stage = '真实清理第 ' + wave + ' 波';
        const decide = survivalTactics(), deadline = Date.now() + 45000;
        await down('fire');
        while (Date.now() < deadline) {
          const s = await read();if (s.phase !== 'playing') break;
          require(s.survivalWave === wave, '战斗期间意外换波', s);
          const input = decide(s);
          // Release the opposite movement first, preserving independent inputs.
          if (input.move !== 'a') await up('left');
          if (input.move !== 'd') await up('right');
          if (input.move) await down(input.move === 'a' ? 'left' : 'right');
          if (input.jump && s.ground) { await up('jump');await down('jump'); }
          else if (!input.jump) await up('jump');
          if (input.dash) await tapAction('dash');
          if (input.grenade) await tapAction('grenade');
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        await release();
        const cleared = await read();
        require(cleared.phase === 'waveClear' && cleared.survivalCleared === wave && cleared.hp > 0,
          '自然输入未完成前置波次', cleared);
        let choice = cleared.supplyOffers.indexOf('armor');
        if (choice < 0) choice = cleared.hp < 4 ? cleared.supplyOffers.indexOf('heal') : 0;
        await activate('#supply-' + Math.max(0, choice));await activate('#start');await phase('playing');
      }
      stage = '第4波真实走位到平台间隙';
      const entered = await read(), original = entered.enemies.find(e => e.type === 'shield');
      require(entered.survivalWave === 4 && entered.survivalCleared === 3 && original?.hp === 5 && original.shieldBreak === 0,
        '没有自然到达完整盾卫所在波次', entered);
      // Crouch-walk at 110px/s into the 490–545 platform gap. Read-only VM
      // replays cover 5/8/12-frame sampling and release delays across 8 seeds.
      await down('down');await down('right');
      await wait('蹲走到x495', () => window.__raidState.x >= 495);
      await up('right');await up('down');
      const positioned = await read();
      require(positioned.x >= 495 && positioned.x < 521 && positioned.ground,
        '未停在不被平台接住的间隙', positioned);
      stage = '跳跃踏中真实盾卫';
      // Ingress lasts 2.2s and the guard then walks about 135px at 44px/s:
      // this approach alone can take just over five seconds from wave start.
      await wait('等待盾卫进入跳踩距离', () => {
        const s = window.__raidState, guard = s.enemies.find(e => e.type === 'shield');
        return s.spawnTime === 0 && s.ground && guard?.hp === 5 &&
          Math.abs(guard.x + guard.w / 2 - s.x - 13.5) <= 47;
      }, 6500);
      await down('jump');
      await wait('等待活盾卫被踏击破防', () => window.__shieldbreakObservations.broken !== null);
      await release();await activate('#pause');await phase('pause');
      const observed = await page.evaluate(() => window.__shieldbreakObservations.broken);
      require(observed.guard.hp === 3 && observed.guard.shieldBreak > 0 && observed.guard.shieldBreak <= 1.2 &&
        observed.state.stomps === 1 && observed.state.vy < 0 && observed.state.survivalWave === 4,
        '没有证明原2伤踏击触发活盾破防并弹起', observed);
      const png = await page.evaluate(() => window.__shieldbreakCanvas);
      require(typeof png === 'string' && png.length > 0, '缺少破盾瞬间画布');
      fs.writeFileSync(path.join(process.cwd(), '.shots', `pixelraid-shieldbreak-${label}-active-canvas.png`), Buffer.from(png, 'base64'));
      const frozen = await read(), guardFrozen = frozen.enemies.find(e => e.type === 'shield');
      require(guardFrozen?.shieldBreak > 0 && guardFrozen.hp === 3, '暂停前破防已经消失', frozen);
      await shot('paused');
      stage = '暂停及取消重开冻结破防';
      await new Promise(resolve => setTimeout(resolve, 220));
      require((await read()).enemies.find(e => e.type === 'shield')?.shieldBreak === guardFrozen.shieldBreak, '暂停消耗破防时间');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require((await read()).enemies.find(e => e.type === 'shield')?.shieldBreak === guardFrozen.shieldBreak, '取消重开改变破防');
      stage = '移离目标并观察盾牌自然恢复';
      await activate('#start');await phase('playing');await down('left');
      await wait('反弹后后撤至x430避免再次踏击', () => window.__raidState.x <= 430);await up('left');
      await wait('等待同一盾卫自然恢复盾牌', () => window.__raidState.enemies.some(e => e.type === 'shield' && e.shieldBreak === 0));
      await release();await activate('#pause');await phase('pause');
      const restored = await read(), guardRestored = restored.enemies.find(e => e.type === 'shield');
      require(guardRestored?.shieldBreak === 0 && guardRestored.hp === 3 && restored.stomps === 1 && restored.hp > 0,
        '自然恢复被重复踏击、死亡或换波干扰', restored);
      await shot('restored');
      const inputs = await page.evaluate(() => window.__shieldbreakObservations.inputs);
      require(inputs.every(event => event.trusted) && inputs.some(event => mobile ?
        event.type === 'pointerdown' && event.action === 'jump' : event.type === 'keydown' && event.key === 'w'),
      '未使用真实输入完成跳踩', inputs);
      stage = '重开及大厅清理';
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      const restarted = await read();
      require(restarted.survivalWave === 1 && restarted.stomps === 0 && restarted.touchCount === 0 &&
        restarted.enemies.every(e => !e.shieldBreak), '重开残留旧波次破防', restarted);
      await activate('#pause');await phase('pause');await activate('#menu-home');await phase('confirmRestart');
      await activate('#start');await phase('title');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open &&
        !document.querySelector('#survival-guide').open && document.documentElement.scrollWidth <= innerWidth + 1), '大厅展开或溢出');
      await shot('lobby');
    } catch (error) {
      const evidence = await page.evaluate(() => ({ state: window.__raidState, observation: window.__shieldbreakObservations,
        active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action)
      })).catch(diagnosticError => ({ error: diagnosticError.message }));
      problems.push(`Pixel Raid 踏击破盾 ${label}：${checkpoint}：${error.message} · evidence=${JSON.stringify(evidence)}`);
      await shot('error').catch(() => {});
    } finally { await release();await context.close(); }
  }
}
