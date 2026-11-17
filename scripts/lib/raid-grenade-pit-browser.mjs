/** A real arc falls through a pit, then passes the far bank below its top. */
import fs from 'node:fs';
import path from 'node:path';

// Pure assertions also let the VM replay the same control route before CI.
// These constants describe the shipped first campaign gap, not injected terrain.
export function assertGrenadePitRoute(evidence, initial) {
  const require = (ok, message, details) => {
    if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
  };
  const { launch, frames, end } = evidence;
  require(launch?.grenade && launch.grenade.aim === 'arc' && launch.grenade.vx === 330 &&
    launch.grenade.vy < 0 && launch.ground && launch.face === 1 &&
    launch.x >= 640 && launch.x <= 690 && launch.ammo === initial.grenades - 1,
  '没有从近岸通过原生输入发出普通抛投', launch);
  require(frames.length >= 6 && end, '缺少完整的深坑弹道及自然消失证据', { frames, end });
  const gravity = 1250 * .83, epsilon = .00001;
  let top = null, bankCross = null;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    require(frame.aim === 'arc' && frame.vx === 330 && frame.timer > 0 &&
      frame.ammo === initial.grenades - 1 && frame.hp > 0 && frame.lives === initial.lives &&
      frame.stageDeaths === initial.stageDeaths && frame.checkpoint === initial.checkpoint,
    '深坑手雷错误反弹、改变资源或被重生替代', frame);
    if (!i) continue;
    const before = frames[i - 1], steps = Math.round((before.timer - frame.timer) * 60), dt = steps / 60;
    // A rendered frame may contain multiple fixed physics steps. Check their
    // exact semi-implicit trajectory instead of assuming one RAF == one step.
    require(steps >= 1 && Math.abs(before.timer - frame.timer - dt) < epsilon &&
      Math.abs(frame.x - before.x - 330 * dt) < epsilon &&
      Math.abs(frame.vy - before.vy - gravity * dt) < epsilon &&
      Math.abs(frame.y - before.y - before.vy * dt - gravity * steps * (steps + 1) / 7200) < epsilon,
    '真实抛物线被地面吸附、反弹或改速', { before, frame });
    // Locate crossings on the already-verified ballistic segment, even when
    // a slow rendered frame spans several simulation steps. The real before/
    // after observations remain attached to the derived crossing evidence.
    let prior = before;
    for (let step = 1; step <= steps; step++) {
      const current = { x: before.x + 330 * step / 60,
        y: before.y + before.vy * step / 60 + gravity * step * (step + 1) / 7200 };
      if (!top && prior.y < 417 && current.y >= 417) {
        top = { before, after: frame, x: prior.x + (current.x - prior.x) * (417 - prior.y) / (current.y - prior.y) };
      }
      if (!bankCross && prior.x < 940 && current.x >= 940) {
        bankCross = { before, after: frame, y: prior.y + (current.y - prior.y) * (940 - prior.x) / (current.x - prior.x) };
      }
      prior = current;
    }
  }
  require(top?.x > 840 && top.x < 940 && bankCross?.y > 417 && bankCross.after.y > 417 &&
    bankCross.after.vy > 0 && bankCross.after.y > bankCross.before.y,
    '未证明手雷先落进深坑，再从地面以下穿过远岸', { top, bankCross });
  const last = frames.at(-1), elapsed = end.clock - last.clock, steps = Math.round(elapsed * 60);
  const predictedY = last.y + last.vy * steps / 60 + gravity * steps * (steps + 1) / 7200;
  require(end.phase === 'playing' && end.mode === 'campaign' && end.stage === 1 && end.remaining === 0 &&
    end.ammo === initial.grenades - 1 && end.hp > 0 && end.lives === initial.lives &&
    end.stageDeaths === initial.stageDeaths && end.checkpoint === initial.checkpoint && end.ground &&
    end.x === launch.x && (last.timer <= elapsed + epsilon || predictedY > 560),
  '手雷不是依照现有引信或出画面规则消失，或影响了玩家生命/检查点', { last, end, predictedY });
  return { top, bankCross };
}

export async function checkRaidGrenadePit(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage(), held = new Map();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let checkpoint = '初始化';
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = (description, predicate) => {
      checkpoint = description;
      return page.waitForFunction(predicate, { timeout: 6000, polling: 'raf' });
    };
    const phase = expected => {
      checkpoint = '等待界面 ' + expected;
      return page.waitForFunction(value => window.__raidState?.phase === value,
        { timeout: 5000, polling: 'raf' }, expected);
    };
    const activate = async selector => {
      checkpoint = '操作按钮 ' + selector;
      const control = await page.$(selector);await control.scrollIntoView();
      if (mobile) await control.tap();
      else { await control.focus();await page.keyboard.press('Enter'); }
    };
    const keys = { right: 'd', fire: 'j', grenade: 'k' };
    const inputIndex = () => page.evaluate(() => window.__grenadePitObservations.inputs.length);
    const auditTouch = async (index, action, kind, pointerId = null) => {
      checkpoint = '验证原生触控 ' + kind + ' ' + action;
      await page.waitForFunction(start => window.__grenadePitObservations.inputs.slice(start).some(input =>
        ['pointerdown', 'pointerup', 'pointercancel'].includes(input.type)), { timeout: 2000, polling: 'raf' }, index);
      const audit = await page.evaluate(start => ({
        events: window.__grenadePitObservations.inputs.slice(start).filter(input => ['pointerdown', 'pointerup', 'pointercancel'].includes(input.type)),
        touchCount: window.__raidState.touchCount,
        active: [...document.querySelectorAll('[data-action].active')].map(element => element.dataset.action).sort()
      }), index);
      const event = audit.events[0], actions = [...held.keys()].sort();
      require(audit.events.length === 1 && event.trusted && event.action === action &&
        (kind === 'down' ? event.type === 'pointerdown' && Number.isInteger(event.pointerId) :
          ['pointerup', 'pointercancel'].includes(event.type) && event.pointerId === pointerId) &&
        audit.touchCount === held.size && JSON.stringify(audit.active) === JSON.stringify(actions),
      '原生触控目标、接触身份或剩余按住状态不正确', { action, kind, actions, audit });
      return event.pointerId;
    };
    const down = async action => {
      checkpoint = '按住 ' + action;
      if (held.has(action)) return;
      if (mobile) {
        const point = await page.$eval(`[data-action="${action}"]`, element => {
          element.scrollIntoView({ block: 'end' });const r = element.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
        });
        require(point.w >= 42 && point.h >= 44 && point.x > 0 && point.x < 320 && point.y > 0 && point.y < 844,
          '触控目标不可达：' + action, point);
        const index = await inputIndex();
        const contact = { handle: await page.touchscreen.touchStart(point.x, point.y), pointerId: null };
        held.set(action, contact);
        contact.pointerId = await auditTouch(index, action, 'down');
      } else { await page.keyboard.down(keys[action]);held.set(action, true); }
    };
    const up = async action => {
      if (!held.has(action)) return;
      checkpoint = '释放 ' + action;
      if (mobile) {
        const index = await inputIndex(), contact = held.get(action);
        await contact.handle.end();held.delete(action);
        await auditTouch(index, action, 'up', contact.pointerId);
      } else { await page.keyboard.up(keys[action]);held.delete(action); }
    };
    const release = async () => {
      for (const action of [...held.keys()]) await up(action).catch(() => {});
    };
    const file = suffix => path.join(process.cwd(), '.shots', `pixelraid-grenade-pit-${label}-${suffix}`);
    const shot = suffix => page.screenshot({ path: file(suffix + '.png'), fullPage: true });
    page.on('pageerror', error => problems.push(`Pixel Raid 深坑手雷 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        // Detached observations only: no state fixtures, synthetic input, clock
        // or randomness hooks. Save the canvas in the actual crossing frame.
        const evidence = window.__grenadePitObservations = { launch: null, frames: [], end: null, inputs: [] };
        const canvases = window.__grenadePitCanvases = {};
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'click']) {
          document.addEventListener(type, event => {
            const target = event.target.closest?.('[data-action], button');
            if (type.startsWith('key') && ['d', 'j', 'k'].includes(event.key) || target) {
              evidence.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id,
                pointerId: event.pointerId, primary: event.isPrimary, trusted: event.isTrusted,
                phase: window.__raidState?.phase });
            }
          }, true);
        }
        let previous;
        const capture = name => {
          if (!canvases[name]) canvases[name] = document.getElementById('field').toDataURL('image/png').split(',')[1];
        };
        function observe() {
          const state = window.__raidState;
          if (state?.phase === 'playing' && previous?.phase === 'playing' && state.grenades < previous.grenades && !evidence.launch) {
            evidence.launch = { grenade: state.grenadeProjectiles.at(-1), x: state.x, y: state.y,
              ground: state.ground, face: state.face, ammo: state.grenades, clock: state.clock };
            capture('launch');
          }
          if (state?.phase === 'playing' && evidence.launch && !evidence.end) {
            const grenade = state.grenadeProjectiles[0], prior = evidence.frames.at(-1);
            if (grenade && state.clock !== prior?.clock) {
              const frame = { ...grenade, clock: state.clock, ammo: state.grenades, hp: state.hp,
                lives: state.lives, checkpoint: state.checkpoint, stageDeaths: state.stageDeaths };
              evidence.frames.push(frame);
              if (grenade.y > 417 && grenade.x > 840) capture('below-rim');
              if (prior && prior.x < 940 && grenade.x >= 940) capture('bank-crossing');
            } else if (!grenade && prior) {
              evidence.end = { clock: state.clock, phase: state.phase, mode: state.mode, stage: state.stage,
                ammo: state.grenades, hp: state.hp, lives: state.lives, x: state.x, ground: state.ground,
                checkpoint: state.checkpoint, stageDeaths: state.stageDeaths, remaining: state.grenadeProjectiles.length };
              capture('ended');
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
      const initial = await read();
      require(initial.mode === 'campaign' && initial.stage === 1 && initial.x === 64 && initial.grenades === 3,
        '路线不是全新远征', initial);
      // Clear the first walker with real fire while walking. Stop well before
      // the gap: the arc, not the player, falls through it. This gives native
      // input dispatch about 190 ms of tolerance instead of a one-frame throw.
      await down('fire');await down('right');
      await wait('等待走到近岸抛投位置', () => window.__raidState.x >= 640);
      await up('right');await up('fire');
      const bank = await read();
      require(bank.ground && bank.x >= 640 && bank.x <= 690 && bank.lives === initial.lives && bank.hp > 0,
        '原生走位未停在近岸安全窗口', bank);
      await down('grenade');
      await wait('等待普通抛投穿过深坑并自然消失', () => window.__grenadePitObservations.end !== null);
      await up('grenade');
      const evidence = await page.evaluate(() => window.__grenadePitObservations);
      // Write the trajectory before judging it so CI also retains failures.
      fs.writeFileSync(file('route.json'), JSON.stringify({ initial, bank, evidence }, null, 2));
      const canvases = await page.evaluate(() => window.__grenadePitCanvases);
      for (const [name, image] of Object.entries(canvases)) fs.writeFileSync(file(name + '.png'), Buffer.from(image, 'base64'));
      checkpoint = '验证真实深坑弹道';
      assertGrenadePitRoute(evidence, initial);
      require(['launch', 'below-rim', 'bank-crossing', 'ended'].every(name => typeof canvases[name] === 'string' && canvases[name].length > 0),
        '缺少实际深坑穿越画布', Object.keys(canvases));
      const presses = evidence.inputs.filter(input => mobile ? input.type === 'pointerdown' && ['fire', 'right', 'grenade'].includes(input.action) :
        input.type === 'keydown' && ['j', 'd', 'k'].includes(input.key));
      const actualPresses = presses.map(input => mobile ? input.action : input.key).sort();
      const expectedPresses = mobile ? ['fire', 'grenade', 'right'] : ['d', 'j', 'k'];
      const releases = evidence.inputs.filter(input => mobile ? ['pointerup', 'pointercancel'].includes(input.type) &&
        ['fire', 'right', 'grenade'].includes(input.action) : input.type === 'keyup' && ['j', 'd', 'k'].includes(input.key));
      require(JSON.stringify(actualPresses) === JSON.stringify(expectedPresses) &&
        JSON.stringify(releases.map(input => mobile ? input.action : input.key).sort()) === JSON.stringify(expectedPresses) &&
        evidence.inputs.every(input => input.trusted) &&
        (await read()).grenades === initial.grenades - 1, '路线不是一次原生移动/射击/投掷，或长按重复耗弹', evidence.inputs);
      await activate('#pause');await phase('pause');await shot('completed');
      await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      const lobby = await read();
      require(lobby.grenadeProjectiles.length === 0 && lobby.grenades === initial.grenades && lobby.touchCount === 0 &&
        await page.evaluate(() => !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
          document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelectorAll('[data-action].active').length === 0),
      '返回大厅后残留投掷、触控或展开内容', lobby);
      await shot('lobby');
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({ state: window.__raidState, observation: window.__grenadePitObservations,
        active: [...document.querySelectorAll('[data-action].active')].map(element => element.dataset.action),
        focused: document.activeElement?.id, scrollY, viewport: { width: innerWidth, height: innerHeight }
      })).catch(diagnosticError => ({ error: diagnosticError.message }));
      fs.writeFileSync(file('error.json'), JSON.stringify({ checkpoint, error: error.message, diagnostic }, null, 2));
      problems.push(`Pixel Raid 深坑手雷 ${label}：${checkpoint}：${error.message}（完整证据见 ${path.basename(file('error.json'))}）`);
      await shot('error').catch(() => {});
    } finally { await release();await context.close(); }
  }
}
