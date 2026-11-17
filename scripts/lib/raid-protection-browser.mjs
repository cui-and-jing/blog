/** Real enemy damage and visible protection, without state/clock/draw hooks. */
import fs from 'node:fs';
import path from 'node:path';

export function assertRaidProtectionEvidence(evidence) {
  const require = (ok, message, details) => {
    if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
  };
  const { hit, frames, expired } = evidence;
  require(hit?.hp === 4 && hit.lives === 3 && hit.duration === 1.45 && hit.time > 1.2 && hit.time <= 1.45 &&
    /^(敌方子弹|敌人接触) · 连击中断$/.test(hit.cause), '没有普通敌人造成的真实受击', hit);
  require(frames.length >= 12 && expired, '缺少完整保护期及自然结束证据');
  for (const [index, frame] of frames.entries()) {
    require(frame.hp === hit.hp && frame.lives === hit.lives && frame.time > 0 && frame.duration === 1.45 &&
      frame.helmet >= 16 && frame.body >= 16 && frame.corners >= 16 && frame.bar <= frame.expected * 3,
    '保护中角色消失、局部提示丢失或再次受伤', frame);
    const prior = frames[index - 1];
    if (prior) require(Math.abs(prior.time - frame.time - (frame.clock - prior.clock)) < .00001,
      '保护余量没有跟随真实游戏时钟自然减少', { prior, frame });
  }
  require([0, 1].every(phase => frames.filter(frame => frame.oldBlinkPhase === phase).length >= 3),
    '没有覆盖旧版隐身闪烁的两个相位');
  require(frames.some(frame => frame.x <= hit.x - 60) && frames.some(frame => frame.crouch && frame.height === 28),
    '保护期间未实际移动和下蹲');
  // Sparks can briefly cover a few bar pixels immediately after a hit. Judge
  // its exact width in unobscured frames, not by replacing the drawing API.
  const clear = frames.filter(frame => frame.bar === frame.expected * 3);
  require(clear.length >= 8 && clear.some(frame => frame.bar >= 54) && clear.some(frame => frame.bar <= 6) &&
    clear.every((frame, i) => !i || frame.bar <= clear[i - 1].bar), '真实余量条没有自然缩短', clear);
  require(expired.time === 0 && expired.hp === hit.hp && expired.lives === hit.lives &&
    expired.helmet >= 16 && expired.body >= 16 && expired.corners === 0 && expired.bar === 0,
  '保护结束后角色或局部提示状态不正确', expired);
  const last = frames.at(-1);
  require(last.time <= expired.clock - last.clock + .00001, '保护提前结束', { last, expired });
}

export async function checkRaidProtection(sourcePage, problems) {
  // Two independent fresh saves cover both input methods and motion settings.
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage(), held = new Map();
    const label = mobile ? 'touch-320-reduced' : 'keyboard-1280-default';
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
      if (mobile) await control.tap();else { await control.focus();await page.keyboard.press('Enter'); }
    };
    const keys = { right: 'd', left: 'a', down: 's' };
    const inputIndex = () => page.evaluate(() => window.__protectionObservations.inputs.length);
    const auditTouch = async (index, action, kind, pointerId = null) => {
      await page.waitForFunction(start => window.__protectionObservations.inputs.slice(start).some(input =>
        ['pointerdown', 'pointerup', 'pointercancel'].includes(input.type)), { timeout: 2000, polling: 'raf' }, index);
      const audit = await page.evaluate(start => ({
        events: window.__protectionObservations.inputs.slice(start).filter(input => ['pointerdown', 'pointerup', 'pointercancel'].includes(input.type)),
        count: window.__raidState.touchCount,
        active: [...document.querySelectorAll('[data-action].active')].map(element => element.dataset.action).sort()
      }), index);
      const event = audit.events[0], actions = [...held.keys()].sort();
      require(audit.events.length === 1 && event.trusted && event.action === action &&
        (kind === 'down' ? event.type === 'pointerdown' && Number.isInteger(event.pointerId) :
          ['pointerup', 'pointercancel'].includes(event.type) && event.pointerId === pointerId) &&
        audit.count === held.size && JSON.stringify(audit.active) === JSON.stringify(actions),
      '原生触控身份或剩余触点错误', { action, kind, actions, audit });
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
          '触控目标不可达', { action, point });
        const index = await inputIndex(), contact = { handle: await page.touchscreen.touchStart(point.x, point.y), pointerId: null };
        held.set(action, contact);contact.pointerId = await auditTouch(index, action, 'down');
      } else { await page.keyboard.down(keys[action]);held.set(action, true); }
    };
    const up = async action => {
      if (!held.has(action)) return;
      checkpoint = '释放 ' + action;
      if (mobile) {
        const index = await inputIndex(), contact = held.get(action);
        await contact.handle.end();held.delete(action);await auditTouch(index, action, 'up', contact.pointerId);
      } else { await page.keyboard.up(keys[action]);held.delete(action); }
    };
    const release = async () => { for (const action of [...held.keys()]) await up(action).catch(() => {}); };
    const file = suffix => path.join(process.cwd(), '.shots', `pixelraid-protection-${label}-${suffix}`);
    const shot = suffix => page.screenshot({ path: file(suffix + '.png'), fullPage: true });
    page.on('pageerror', error => problems.push(`Pixel Raid 受击保护 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: mobile ? 'reduce' : 'no-preference' }]);
      await page.evaluateOnNewDocument(() => {
        const evidence = window.__protectionObservations = { hit: null, frames: [], paused: null, expired: null, inputs: [] };
        const canvases = window.__protectionCanvases = {};
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'click']) document.addEventListener(type, event => {
          const target = event.target.closest?.('[data-action], button');
          if (type.startsWith('key') && ['d', 'a', 's'].includes(event.key) || target) {
            evidence.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id,
              pointerId: event.pointerId, trusted: event.isTrusted, phase: window.__raidState?.phase });
          }
        }, true);
        let previous;
        const capture = name => {
          if (!canvases[name]) canvases[name] = document.getElementById('field').toDataURL('image/png').split(',')[1];
        };
        const sample = state => {
          const canvas = document.getElementById('field'), ctx = canvas.getContext('2d');
          // Only this player's local box, with eight pixels of existing shake
          // tolerance. Exact helmet/torso colors occur nowhere in enemy sprites.
          const x = Math.floor(state.x - state.cam) - 16, y = Math.round(state.y) - 28;
          const width = 60, height = state.playerHeight + 29;
          const data = ctx.getImageData(x, y, width, height).data;
          let helmet = 0, body = 0, corners = 0, bar = 0;
          for (let i = 0; i < data.length; i += 4) {
            const row = Math.floor(i / 4 / width), r = data[i], g = data[i + 1], b = data[i + 2];
            if (row >= 28 && r === 229 && g === 184 && b === 94) helmet++;
            if (row >= 28 && r === 91 && g === 180 && b === 165) body++;
            if (r === 246 && g === 227 && b === 161) {
              if (row >= 1 && row <= 3) bar++;
              else if (row >= 25) corners++;
            }
          }
          return { clock: state.clock, x: state.x, y: state.y, height: state.playerHeight, crouch: state.crouch,
            hp: state.hp, lives: state.lives, time: state.protectionTime, duration: state.protectionDuration,
            oldBlinkPhase: Math.floor(state.clock * 13) % 2,
            expected: Math.max(1, Math.round(24 * Math.min(1, state.protectionTime / state.protectionDuration))),
            helmet, body, corners, bar };
        };
        function observe() {
          const state = window.__raidState;
          if (state?.phase === 'playing' && previous?.phase === 'playing' && state.hp < previous.hp && !evidence.hit) {
            evidence.hit = { ...sample(state), cause: state.combatText };capture('hit');
          }
          if (state?.phase === 'playing' && evidence.hit && !evidence.expired) {
            const frame = sample(state);
            if (frame.time > 0) {
              evidence.frames.push(frame);
              if (frame.oldBlinkPhase === 0) capture('formerly-hidden-phase');
              if (frame.crouch) capture('crouch');
              if (frame.time < .25) capture('nearly-expired');
            } else { evidence.expired = frame;capture('expired'); }
          }
          if (state?.phase === 'pause' && evidence.hit && !evidence.expired && !evidence.paused) {
            evidence.paused = sample(state);capture('paused-canvas');
          }
          previous = state;requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait('等待游戏初始化', () => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写测试入口');
      require(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches) === mobile,
        '动效设置没有覆盖默认与减少动态效果两种情况');
      const fresh = await read();
      require(fresh.phase === 'title' && fresh.difficulty === 'standard' && fresh.hp === 5 && fresh.lives === 3,
        '路线不是全新标准远征', fresh);
      await activate('#start');await phase('playing');await down('right');
      await wait('等待巡逻兵或普通敌弹真实受击', () => window.__protectionObservations.hit !== null);
      await up('right');await down('left');
      await wait('等待保护期间向左脱离接触', () => window.__raidState.x <= window.__protectionObservations.hit.x - 80);
      await up('left');await down('down');
      await wait('等待保护中的真实蹲姿', () => window.__protectionObservations.frames.filter(frame => frame.crouch && frame.time > 0).length >= 3);
      await up('down');await activate('#pause');await phase('pause');
      await wait('等待暂停后的实际保护画布', () => window.__protectionObservations.paused !== null);
      checkpoint = '暂停及取消重开冻结保护';
      const frozen = await read();
      const paused = await page.evaluate(() => window.__protectionObservations.paused);
      require(frozen.protectionTime > .1 && frozen.hp === 4 && frozen.touchCount === 0 && paused.time === frozen.protectionTime &&
        paused.bar > 0 && paused.corners >= 16 && paused.helmet >= 16 && paused.body >= 16,
      '暂停前保护已丢失、角色提示不可见或触点未释放', { frozen, paused });
      await shot('paused');await new Promise(resolve => setTimeout(resolve, 220));
      require((await read()).protectionTime === frozen.protectionTime, '暂停仍消耗保护余量');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require((await read()).protectionTime === frozen.protectionTime && (await read()).hp === frozen.hp,
        '取消重开改变保护余量或体力');
      await activate('#start');await phase('playing');
      await wait('等待保护自然结束', () => window.__protectionObservations.expired !== null);
      await activate('#pause');await phase('pause');
      const evidence = await page.evaluate(() => window.__protectionObservations);
      fs.writeFileSync(file('route.json'), JSON.stringify({ fresh, frozen, evidence }, null, 2));
      const canvases = await page.evaluate(() => window.__protectionCanvases);
      for (const [name, image] of Object.entries(canvases)) fs.writeFileSync(file(name + '.png'), Buffer.from(image, 'base64'));
      checkpoint = '验证保护全程实际像素';assertRaidProtectionEvidence(evidence);
      require(['hit', 'formerly-hidden-phase', 'crouch', 'nearly-expired', 'expired'].every(name => canvases[name]), '缺少实际保护画布');
      const expected = mobile ? ['down', 'left', 'right'] : ['a', 'd', 's'];
      const actions = kind => evidence.inputs.filter(input => mobile ?
        (kind === 'down' ? input.type === 'pointerdown' : ['pointerup', 'pointercancel'].includes(input.type)) && expected.includes(input.action) :
        input.type === (kind === 'down' ? 'keydown' : 'keyup') && expected.includes(input.key))
        .map(input => mobile ? input.action : input.key).sort();
      require(evidence.inputs.every(input => input.trusted) && JSON.stringify(actions('down')) === JSON.stringify(expected) &&
        JSON.stringify(actions('up')) === JSON.stringify(expected), '路线不是一次原生移动、撤离和下蹲', evidence.inputs);
      checkpoint = '确认重开恢复正常开局而非旧保护';
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      const retry = await read();
      require(retry.hp === 5 && retry.lives === 3 && retry.x === 64 && retry.protectionDuration === 1.2 &&
        retry.protectionTime > 0 && retry.protectionTime <= 1.2 && retry.touchCount === 0 && retry.shots === 0,
      '重开残留旧受击保护或操作', retry);
      await activate('#pause');await phase('pause');await activate('#menu-home');await phase('confirmRestart');
      await activate('#start');await phase('title');
      const clean = () => page.evaluate(() => !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
        document.querySelector('#result-details').hidden && document.querySelectorAll('[data-action].active').length === 0 &&
        document.documentElement.scrollWidth <= innerWidth + 1 && !/protection|invDuration/.test(JSON.stringify(window.__raidState.progress)));
      require(await clean(), '大厅残留保护、触控或展开内容');await shot('lobby');
      await page.reload({ waitUntil: 'domcontentloaded' });await phase('title');
      const reloaded = await read();
      require(reloaded.hp === 5 && reloaded.lives === 3 && reloaded.x === 64 && reloaded.protectionTime === 1.2 &&
        reloaded.protectionDuration === 1.2 && reloaded.touchCount === 0 && await clean(), '重新加载持久化了战斗保护余量', reloaded);
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({ state: window.__raidState, evidence: window.__protectionObservations,
        active: [...document.querySelectorAll('[data-action].active')].map(element => element.dataset.action)
      })).catch(diagnosticError => ({ error: diagnosticError.message }));
      fs.writeFileSync(file('error.json'), JSON.stringify({ checkpoint, error: error.message, diagnostic }, null, 2));
      const canvases = await page.evaluate(() => window.__protectionCanvases ?? {}).catch(() => ({}));
      for (const [name, image] of Object.entries(canvases)) fs.writeFileSync(file(name + '.png'), Buffer.from(image, 'base64'));
      problems.push(`Pixel Raid 受击保护 ${label}：${checkpoint}：${error.message.slice(0, 1200)}（完整证据见 ${path.basename(file('error.json'))}）`);
      await shot('error').catch(() => {});
    } finally { await release();await context.close(); }
  }
}
