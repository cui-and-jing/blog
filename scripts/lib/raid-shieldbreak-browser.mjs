/** Reach wave four naturally, stomp its shield guard and observe recovery. */
import path from 'node:path';
import fs from 'node:fs';
import { survivalTactics } from './raid-survival-tactics.mjs';
import { combatPhase, auditCombatTouch, dispatchCombatTouch, waitForCombatPointer } from './raid-combat-boundary.mjs';

export async function checkRaidShieldbreak(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage(), held = new Map(), decisions = [];
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let stage = '初始化', checkpoint = '初始化', combatWave = null, lastTouch = null;
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
      if (combatPhase(await read(), combatWave) === 'settled') return false;
      if (held.has(action)) return true;
      checkpoint = stage + '：按住 ' + action;
      if (mobile) {
        lastTouch = { action, measured: null, beforeDispatch: null, firstObservation: null, observation: null };
        return dispatchCombatTouch({ action, wave: combatWave,
          measure: async () => lastTouch.measured = await page.$eval(`[data-action="${action}"]`, element => {
            // Keep both rows in the same viewport while other fingers are held.
            element.closest('.controls').scrollIntoView({ block: 'end', behavior: 'instant' });
            const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { x, y, w: r.width, h: r.height, rect: r.toJSON(), hit: hit === element || element.contains(hit),
              hitTarget: { tag: hit?.tagName, id: hit?.id, action: hit?.closest?.('[data-action]')?.dataset.action },
              scrollY, viewport: { width: innerWidth, height: innerHeight }, state: window.__raidState };
          }),
          beforeDispatch: async () => lastTouch.beforeDispatch = await page.evaluate(() => ({ index: window.__shieldbreakObservations.inputs.length, state: window.__raidState })),
          dispatch: point => page.touchscreen.touchStart(point.x, point.y),
          observe: from => waitForCombatPointer(async () => {
            const audit = await page.evaluate(({ index, action, point }) => {
              const element = document.querySelector(`[data-action="${action}"]`), rect = element?.getBoundingClientRect();
              const hit = document.elementFromPoint(point.x, point.y);
              return {
                events: window.__shieldbreakObservations.inputs.slice(index).filter(event => event.type === 'pointerdown'),
                active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action).sort(),
                state: window.__raidState,
                geometry: { rect: rect?.toJSON(), atMeasuredPoint: { tag: hit?.tagName, id: hit?.id,
                  action: hit?.closest?.('[data-action]')?.dataset.action, matches: hit === element || !!element?.contains(hit) },
                  scrollY, viewport: { width: innerWidth, height: innerHeight } }
              };
            }, { index: from, action, point: { x: lastTouch.measured.x, y: lastTouch.measured.y } });
            lastTouch.firstObservation ??= audit;lastTouch.observation = audit;
            return audit;
          }),
          // Track the actual target too: a boundary contact can land on a supply
          // card, whose native pointerup must still be audited and released.
          track: (handle, event) => held.set(action, { handle, pointerId: event?.pointerId, action: event?.action, id: event?.id }),
          heldActions: () => [...held.keys()]
        });
      } else {
        await page.keyboard.down(keys[action]);held.set(action, true);
        return combatPhase(await read(), combatWave) === 'playing';
      }
    };
    const up = async action => {
      if (!held.has(action)) return combatPhase(await read(), combatWave) === 'playing';
      checkpoint = stage + '：释放 ' + action;
      if (mobile) {
        const contact = held.get(action), index = await page.evaluate(() => window.__shieldbreakObservations.inputs.length);
        await contact.handle.end();held.delete(action);
        const audit = await waitForCombatPointer(() => page.evaluate(from => ({
          events: window.__shieldbreakObservations.inputs.slice(from).filter(event => event.type === 'pointerup' || event.type === 'pointercancel'),
          active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action).sort(), state: window.__raidState
        }), index));
        return auditCombatTouch({ kind: 'up', action, contact, audit, heldActions: [...held.keys()], wave: combatWave }).phase === 'playing';
      } else {
        await page.keyboard.up(keys[action]);held.delete(action);
        return combatPhase(await read(), combatWave) === 'playing';
      }
    };
    const release = async () => {
      let firstError;
      for (const action of [...held.keys()]) {
        try { await up(action); } catch (error) { firstError ??= error; }
      }
      if (firstError) throw firstError;
    };
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-shieldbreak-${label}-${suffix}.png`), fullPage: true });
    page.on('pageerror', error => problems.push(`Pixel Raid 踏击破盾 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        const evidence = window.__shieldbreakObservations = { inputs: [], broken: null, missionLayouts: {} };
        for (const type of ['keydown', 'pointerdown', 'pointerup', 'pointercancel', 'click']) {
          document.addEventListener(type, event => {
            const target = event.target.closest?.('[data-action], button');
            // Record even a hit on canvas/body/background. Omitting non-buttons
            // made a real missed target indistinguishable from delayed delivery.
            if (type.startsWith('pointer') || type === 'keydown' && ['a', 'd', 's', 'w', 'l', 'j', 'k'].includes(event.key) || target) {
              evidence.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id ?? event.target?.id,
                targetTag: event.target?.tagName, targetId: event.target?.id, x: event.clientX, y: event.clientY,
                pointerId: event.pointerId, primary: event.isPrimary, trusted: event.isTrusted,
                // Capture before target handlers and later RAF ticks. A wrong
                // hit while playing must not be excused by a later settlement.
                state: window.__raidState && (({ phase, mode, survivalWave, survivalCleared, hp, touchCount }) =>
                  ({ phase, mode, survivalWave, survivalCleared, hp, touchCount }))(window.__raidState) });
            }
          }, true);
        }
        function observe() {
          const s = window.__raidState, guard = s?.enemies.find(e => e.type === 'shield' && e.shieldBreak > 0);
          if (s?.phase === 'playing' && s.survivalWave <= 3) {
            const mission = document.getElementById('mission-hud'), objective = document.getElementById('mission-objective');
            const warning = objective.textContent.includes('后抵达'), key = s.survivalWave + (warning ? '-warning' : '-live');
            if (!evidence.missionLayouts[key] && (warning || s.spawnTime === 0)) {
              const rect = mission.getBoundingClientRect();
              evidence.missionLayouts[key] = { height: rect.height, width: rect.width, text: objective.textContent,
                clock: s.clock, warning, overflow: objective.scrollHeight > objective.clientHeight + 1 };
            }
          }
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
      const tapAction = async action => {
        const playing = await down(action);
        const releasedPlaying = await up(action);
        return playing && releasedPlaying;
      };
      // Same player-like decisions as the existing survival suite, using real
      // touch contacts on mobile as well as real keyboard input on desktop.
      for (let wave = 1; wave <= 3; wave++) {
        stage = '真实清理第 ' + wave + ' 波';combatWave = wave;
        const decide = survivalTactics(), deadline = Date.now() + 45000;
        let bossRetreat = false;
        await down('fire');
        while (Date.now() < deadline) {
          const s = await read();if (combatPhase(s, combatWave) === 'settled') break;
          require(s.survivalWave === wave, '战斗期间意外换波', s);
          const input = decide(s);
          if (s.bossWave) {
            // Touch dispatch spans real frames. Never treat the controller's
            // predicted facing as proof that a direction actually took effect.
            if (s.x > 570) bossRetreat = true;
            if (s.x <= 500) bossRetreat = false;
            input.move = bossRetreat ? 'a' : s.x < 500 || s.face < 0 ? 'd' : '';
            input.dash = input.dash && !bossRetreat && s.face === 1;
            input.grenade = input.grenade && !bossRetreat && s.face === 1;
          }
          decisions.push({ wave, time: s.survivalTime, x: s.x, face: s.face, touchCount: s.touchCount, held: [...held.keys()], input });
          if (decisions.length > 30) decisions.shift();
          // Release the opposite movement first, preserving independent inputs.
          if (input.move !== 'a' && !await up('left')) break;
          if (input.move !== 'd' && !await up('right')) break;
          if (input.move && !await down(input.move === 'a' ? 'left' : 'right')) break;
          if (input.jump && s.ground) { if (!await up('jump') || !await down('jump')) break; }
          else if (!input.jump && !await up('jump')) break;
          if (input.dash && !await tapAction('dash')) break;
          if (input.grenade && !await tapAction('grenade')) break;
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        await release();
        const cleared = await read();
        require(cleared.phase === 'waveClear' && cleared.survivalCleared === wave && cleared.hp > 0,
          '自然输入未完成前置波次', cleared);
        require(combatPhase(cleared, wave) === 'settled' && held.size === 0, '补给选择前仍有未释放的战斗接触');
        // A stale native touch may have selected a card during settlement. Do
        // not trust that selection: choose explicitly only after all contacts end.
        let choice = cleared.supplyOffers.indexOf('armor');
        if (choice < 0) choice = cleared.hp < 4 ? cleared.supplyOffers.indexOf('heal') : 0;
        await activate('#supply-' + Math.max(0, choice));await activate('#start');await phase('playing');
      }
      if (mobile) {
        const layouts = await page.evaluate(() => window.__shieldbreakObservations.missionLayouts);
        for (const wave of [1, 2, 3]) {
          const warning = layouts[wave + '-warning'], live = layouts[wave + '-live'];
          require(warning && live && warning.warning && !live.warning && !warning.overflow && !live.overflow &&
            Math.abs(warning.height - live.height) < 1, '任务预警切换实战时改变高度并推移触屏按键', { wave, warning, live });
        }
        fs.writeFileSync(path.join(process.cwd(), '.shots', `pixelraid-shieldbreak-${label}-mission-layout.json`), JSON.stringify(layouts, null, 2));
      }
      combatWave = null;
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
      const diagnostic = { label, stage, checkpoint, error: { message: error.message, stack: error.stack },
        ...evidence, decisions, lastTouch, held: [...held.keys()] };
      // Keep the complete evidence outside log truncation, including measured
      // and observed hit geometry. This is diagnostic only, not a retry gate.
      fs.writeFileSync(path.join(process.cwd(), '.shots', `pixelraid-shieldbreak-${label}-diagnostic.json`), JSON.stringify(diagnostic, null, 2));
      problems.push(`Pixel Raid 踏击破盾 ${label}：${checkpoint}：${error.message} · evidence=${JSON.stringify(diagnostic)}`);
      await shot('error').catch(() => {});
    } finally { await release().catch(() => {});await context.close(); }
  }
}
