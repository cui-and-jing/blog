/** Native aerial dash routes. Observations never write game state or clocks. */
import fs from 'node:fs';
import path from 'node:path';

export async function checkRaidDiveDash(sourcePage, problems) {
  for (const mobile of [false, true]) for (const dive of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext(), page = await context.newPage();
    const label = `${mobile ? 'touch-320' : 'keyboard-1280'}-${dive ? 'dive' : 'level'}`;
    const prefix = path.join(process.cwd(), '.shots', `pixelraid-divedash-${label}`), held = new Map();
    let checkpoint = '初始化';
    const require = (ok, message, detail) => {
      if (!ok) throw new Error(message + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = predicate => page.waitForFunction(predicate, { timeout: 6000, polling: 'raf' });
    const phase = wanted => page.waitForFunction(value => window.__raidState.phase === value, { timeout: 6000, polling: 'raf' }, wanted);
    const activate = async selector => {
      require(held.size === 0, '点击菜单前必须释放所有原生接触');
      const element = await page.$(selector);await element.scrollIntoView();
      if (mobile) await element.tap();else await element.click();
    };
    const keys = { jump: 'w', down: 's', dash: 'l' };
    const pointerAudit = async (index, types) => {
      await page.waitForFunction(({ index, types }) => window.__diveDashProof.inputs.slice(index).some(event => types.includes(event.type)),
        { timeout: 2000, polling: 'raf' }, { index, types });
      return page.evaluate(({ index, types }) => ({
        events: window.__diveDashProof.inputs.slice(index).filter(event => types.includes(event.type)),
        state: window.__raidState,
        active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action).sort()
      }), { index, types });
    };
    const down = async action => {
      if (held.has(action)) return;
      if (mobile) {
        const point = await page.$eval(`[data-action="${action}"]`, element => {
          element.closest('.controls').scrollIntoView({ block: 'end', behavior: 'instant' });
          const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { x, y, w: r.width, h: r.height, hit: hit === element || element.contains(hit) };
        });
        require(point.hit && point.w >= 42 && point.h >= 44 && point.x > 0 && point.x < 320 && point.y > 0 && point.y < 844,
          '原生触控目标不可达', { action, point });
        const index = await page.evaluate(() => window.__diveDashProof.inputs.length);
        const handle = await page.touchscreen.touchStart(point.x, point.y);
        held.set(action, { handle });
        const audit = await pointerAudit(index, ['pointerdown']);
        const event = audit.events[0];held.set(action, { handle, pointerId: event?.pointerId });
        require(audit.events.length === 1 && event.action === action && event.trusted && audit.state.phase === 'playing' &&
          audit.state.touchCount === held.size && JSON.stringify(audit.active) === JSON.stringify([...held.keys()].sort()),
        '真实按下未命中预期动作或触点状态不一致', { action, point, audit });
      } else { await page.keyboard.down(keys[action]);held.set(action, true); }
    };
    const up = async action => {
      if (!held.has(action)) return;
      if (mobile) {
        const contact = held.get(action), index = await page.evaluate(() => window.__diveDashProof.inputs.length);
        await contact.handle.end();held.delete(action);
        const audit = await pointerAudit(index, ['pointerup', 'pointercancel']), event = audit.events[0];
        require(audit.events.length === 1 && event.action === action && event.pointerId === contact.pointerId && event.trusted &&
          audit.state.touchCount === held.size && JSON.stringify(audit.active) === JSON.stringify([...held.keys()].sort()),
        '原生触点未独立释放', { action, audit });
      } else { await page.keyboard.up(keys[action]);held.delete(action); }
    };
    const release = async () => { for (const action of [...held.keys()]) await up(action); };
    page.on('pageerror', error => problems.push(`Pixel Raid 空中俯冲 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        const proof = window.__diveDashProof = { inputs: [], frames: [], starts: [], landed: null };
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel']) {
          document.addEventListener(type, event => {
            const target = event.target.closest?.('[data-action],button'), s = window.__raidState;
            proof.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id,
              tag: event.target?.tagName, pointerId: event.pointerId, trusted: event.isTrusted, repeat: !!event.repeat,
              clock: s?.clock, phase: s?.phase, dash: s?.dashTime, dive: s?.dashDive });
          }, true);
        }
        let previous;
        function observe() {
          const s = window.__raidState;
          if (s?.phase === 'playing') {
            const frame = { clock: s.clock, x: s.x, y: s.y, feet: s.y + s.playerHeight, vy: s.vy, ground: s.ground,
              dash: s.dashTime, dive: s.dashDive, cooldown: s.dashCooldown, hp: s.hp, shots: s.shots, ammo: s.grenades };
            if (proof.frames.length < 1200) proof.frames.push(frame);
            if (s.dashTime > 0 && (!previous || previous.dash === 0)) {
              proof.starts.push({ before: previous, after: frame });
              if (!window.__diveDashCanvas) window.__diveDashCanvas = document.getElementById('field').toDataURL('image/png').split(',')[1];
            }
            if (proof.starts.length && s.ground && !proof.landed) proof.landed = frame;
            previous = frame;
          }
          requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait(() => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页暴露可写入口');
      await activate('#difficulty-relaxed');await activate('#start');await phase('playing');
      const fresh = await read();
      checkpoint = '真实跳跃后锁定空中冲刺';
      await down('jump');
      await wait(() => { const s = window.__raidState;return !s.ground && s.y + s.playerHeight < 355 && s.vy < 0; });
      await up('jump');
      if (dive) await down('down');
      await down('dash');
      await wait(() => window.__diveDashProof.starts.length === 1);
      // Release direction during the impulse; the recorded later frames must
      // retain the chosen dash type. Keep dash held beyond cooldown separately.
      if (dive) await up('down');
      await wait(() => window.__diveDashProof.landed !== null && window.__raidState.dashTime === 0);
      const route = await page.evaluate(() => window.__diveDashProof);
      const start = route.starts[0], active = route.frames.filter(frame => frame.dash > 0);
      require(start && !start.before.ground && start.after.dive === dive && start.after.cooldown > 2 &&
        active.length >= 2 && active.every(frame => frame.dive === dive), '空中冲刺未正确启动或锁定方向', route);
      const moving = active.filter(frame => !frame.ground);
      const firstMoving = moving[0], lastMoving = moving.at(-1), elapsed = (lastMoving?.clock ?? 0) - (firstMoving?.clock ?? 0);
      require(moving.length >= 2 && elapsed > 0 && moving.every(frame => frame.vy === (dive ? 650 : 0)) &&
        Math.abs(lastMoving.x - firstMoving.x - 650 * elapsed) < .00001 &&
        Math.abs(lastMoving.y - firstMoving.y - (dive ? 650 : 0) * elapsed) < .00001,
      '空中冲刺没有按650水平速度及所选向下速度产生真实位移', moving);
      require(route.landed.feet === 425 && route.landed.vy === 0 && route.landed.hp === fresh.hp &&
        route.landed.shots === 0 && route.landed.ammo === fresh.grenades, '落地未正常接住或产生额外消耗', route.landed);
      if (dive) {
        const released = route.inputs.find(event => event.phase === 'playing' &&
          (mobile ? event.type === 'pointerup' && event.action === 'down' : event.type === 'keyup' && event.key === 's'));
        require(released && released.dash > 0 && active.some(frame => frame.clock > released.clock && frame.dive),
          '未证明松开下键后仍保留本次俯冲', { released, active });
      }
      const png = await page.evaluate(() => window.__diveDashCanvas);
      require(typeof png === 'string' && png.length > 0, '缺少真实冲刺瞬间画布');
      fs.writeFileSync(prefix + '-active.png', Buffer.from(png, 'base64'));
      checkpoint = '长按不连冲与暂停恢复';
      await wait(() => window.__raidState.dashCooldown === 0);
      require((await read()).dashTime === 0 && (await read()).dashBuffer === 0 &&
        (await page.evaluate(() => window.__diveDashProof.starts.length)) === 1, '长按或松下键自动追加冲刺');
      await release();await activate('#pause');await phase('pause');
      const paused = await read();await new Promise(resolve => setTimeout(resolve, 120));
      require(JSON.stringify(await read()) === JSON.stringify(paused), '暂停推进游戏状态');
      await activate('#start');await phase('playing');
      await new Promise(resolve => setTimeout(resolve, 120));
      const resumed = await read();
      require(resumed.dashTime === 0 && !resumed.dashDive && resumed.dashBuffer === 0 && resumed.touchCount === 0 &&
        (await page.evaluate(() => window.__diveDashProof.starts.length)) === 1, '继续残留俯冲或旧触点');
      checkpoint = '重开清理与大厅';
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      const restarted = await read();
      require(!restarted.dashDive && restarted.dashTime === 0 && restarted.dashBuffer === 0 && restarted.touchCount === 0 && restarted.x === 64,
        '重开残留冲刺状态', restarted);
      fs.writeFileSync(prefix + '-route.json', JSON.stringify({ fresh, route: await page.evaluate(() => window.__diveDashProof), paused, resumed, restarted }, null, 2));
      await activate('#pause');await phase('pause');await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
        document.documentElement.scrollWidth <= innerWidth + 1), '大厅展开或页面横向溢出');
    } catch (error) {
      const evidence = await page.evaluate(() => ({ state: window.__raidState, proof: window.__diveDashProof })).catch(() => null);
      problems.push(`Pixel Raid 空中俯冲 ${label}：${checkpoint}：${error.message}`);
      fs.writeFileSync(prefix + '-diagnostic.json', JSON.stringify({ checkpoint, error: error.message, evidence }, null, 2));
      await page.screenshot({ path: prefix + '-error.png', fullPage: true }).catch(() => {});
    } finally { await release().catch(() => {});await context.close(); }
  }
}
