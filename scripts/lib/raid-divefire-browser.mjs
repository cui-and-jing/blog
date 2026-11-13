/** Aerial dive fire: fresh saves, ordinary movement/jump, and read-only observation. */
import fs from 'node:fs';
import path from 'node:path';

export async function checkRaidDivefire(sourcePage, problems) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, message, details) => {
    if (!ok) problems.push('Pixel Raid 空中俯射：' + message + (details ? ' ' + JSON.stringify(details) : ''));
    return ok;
  };
  const require = (ok, message, details) => {
    if (!check(ok, message, details)) throw new Error(message);
  };

  // Each input method gets its own genuinely empty profile. No storage seed,
  // game-state writes, synthetic combat events, RNG or clock overrides.
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    const prefix = path.join(process.cwd(), '.shots', 'pixelraid-divefire-' + label);
    const keys = new Set(), contacts = new Map();
    let checkpoint = label + ' 初始化';
    const read = () => page.evaluate(() => window.__raidState);
    const phase = expected => page.waitForFunction(value => window.__raidState?.phase === value,
      { timeout: 5000 }, expected);
    const observe = async (predicate, ...args) => {
      const handle = await page.waitForFunction(predicate, { timeout: 9000, polling: 'raf' }, ...args);
      try { return await handle.jsonValue(); } finally { await handle.dispose(); }
    };
    const shot = name => page.screenshot({ path: prefix + '-' + name + '.png', fullPage: true });
    const key = async (name, held) => {
      if (keys.has(name) === held) return;
      await page.keyboard[held ? 'down' : 'up'](name);
      if (held) keys.add(name); else keys.delete(name);
    };
    const activate = async selector => {
      const element = await page.$(selector);
      require(element, '找不到界面按钮：' + selector);
      if (mobile) { await element.scrollIntoView(); await element.tap(); }
      else await element.click();
    };
    const touch = async (action, held) => {
      if (contacts.has(action) === held) return;
      const from = await page.evaluate(() => window.__raidDivefireTouches.length);
      let previous;
      if (held) {
        const point = await page.$eval('[data-action="' + action + '"]', element => {
          element.closest('.controls').scrollIntoView({ block: 'end' });
          const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { x, y, w: r.width, h: r.height, width: innerWidth, height: innerHeight,
            hit: hit === element || element.contains(hit) };
        });
        require(point.hit && point.w >= 42 && point.h >= 44 && point.x >= 0 && point.x < point.width &&
          point.y >= 0 && point.y < point.height, '320px 触控按钮不可达：' + action, point);
        const handle = await page.touchscreen.touchStart(point.x, point.y);
        contacts.set(action, { handle, pointerId: null });
      } else {
        previous = contacts.get(action);
        await previous.handle.end(); contacts.delete(action);
      }
      const audit = await page.evaluate(index => ({ events: window.__raidDivefireTouches.slice(index),
        active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action).sort(),
        count: window.__raidState.touchCount }), from);
      const event = audit.events[0], expected = (await read()).phase === 'playing' ? [...contacts.keys()].sort() : [];
      require(audit.events.length === 1 && event.action === action && event.trusted &&
        event.type === (held ? 'pointerdown' : 'pointerup') &&
        (held || event.pointerId === previous.pointerId) && equal(audit.active, expected) &&
        audit.count === expected.length, '动作没有使用可独立释放的真实触点', { action, held, audit, expected });
      if (held) contacts.get(action).pointerId = event.pointerId;
    };
    const release = async () => {
      for (const name of [...keys]) await key(name, false);
      for (const action of [...contacts.keys()]) await touch(action, false);
    };
    const control = (action, held) => mobile ? touch(action, held) : key(({ left: 'a', right: 'd', jump: 'w', down: 's', fire: 'j' })[action], held);
    const pause = async () => {
      if (mobile) await activate('#pause'); else await page.keyboard.press('p');
      await phase('pause'); return read();
    };
    page.on('pageerror', error => check(false, '页面异常：' + error.message, { checkpoint }));

    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      // A user-visible accessibility preference, not a game-clock fixture.
      // Stable screen coordinates also make actual shot screenshots easy to review.
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        window.__raidDivefireTouches = [];
        for (const type of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(type, event => {
          const target = event.target.closest?.('[data-action]');
          if (target) window.__raidDivefireTouches.push({ type, action: target.dataset.action,
            pointerId: event.pointerId, trusted: event.isTrusted });
        }, true);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' }); await page.bringToFront();
      await page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
      require(await page.evaluate(() => !('__raidQA' in window)), '发布版本暴露可写战斗测试入口');
      await shot('clean-lobby');
      await activate('#mode-survival'); await activate('#start'); await phase('playing');
      const fresh = await read();
      require(fresh.survivalWave === 1 && fresh.hp === 6 && fresh.shots === 0 && fresh.stomps === 0,
        '没有从全新第一波开始', fresh);
      // Crouch-walk during ingress: at 110px/s, even eight simulation frames
      // of release latency fit the verified 388–405px corridor. A full-speed
      // release could overshoot into an unachievable enemy-gap wait.
      await control('down', true); await control('left', true);
      await observe(() => { const s = window.__raidState; return s.x <= 405 ? s : false; });
      await control('left', false); await control('down', false);
      const positioned = await read();
      require(positioned.x >= 388 && positioned.x <= 405 && positioned.ground && positioned.face === -1,
        '没有站在跳跃不会被平台接住的位置', positioned);
      checkpoint = label + ' 纯俯射命中';
      await observe(() => {
        const s = window.__raidState;
        const target = s.enemies.filter(e => e.type === 'walker' && e.x < s.x)
          .sort((a, b) => b.x - a.x)[0];
        const gap = target ? s.x + 13.5 - target.x - target.w / 2 : Infinity;
        return s.spawnTime === 0 && s.ground && gap <= 155 && gap >= 120 ? s : false;
      });
      // This observer only samples public snapshots and the rendered canvas.
      // It does not intercept the game clock, inputs, RNG or damage functions.
      await page.evaluate(() => {
        window.__raidDivefireObserved = null;
        const initial = window.__raidState, health = initial.enemies.reduce((n, e) => n + e.hp, 0);
        let downBullet = null;
        const deadline = performance.now() + 4000;
        function observeFrame() {
          const s = window.__raidState;
          const b = s.playerProjectiles.find(b => !b.reflected && b.vx === -480 && b.vy === 340);
          if (b && !downBullet) downBullet = { state: s,
            png: document.getElementById('field').toDataURL('image/png').split(',')[1] };
          if (s.enemies.reduce((n, e) => n + e.hp, 0) < health) {
            window.__raidDivefireObserved = { initial, after: s, downBullet }; return;
          }
          if (s.phase !== 'playing' || performance.now() > deadline) {
            window.__raidDivefireObserved = { error: '纯俯射未击中真实地面敌人', initial, after: s, downBullet }; return;
          }
          requestAnimationFrame(observeFrame);
        }
        requestAnimationFrame(observeFrame);
      });
      await control('jump', true);
      // Clear the nearby ground device before firing. An immediately fired
      // low muzzle could hit that device instead of proving direct down-fire.
      await observe(() => { const s = window.__raidState; return !s.ground && s.y <= 300 ? s : false; });
      await control('down', true);
      await control('fire', true);
      const aimed = await observe(() => { const s = window.__raidState;
        return s.fireAim === 1 && s.playerProjectiles.some(b => b.vx === -480 && b.vy === 340) ? s : false;
      });
      check(!aimed.ground && !aimed.crouch && aimed.playerHeight === 44 && aimed.grenades === 3 &&
        aimed.tacticalUses === 0 && aimed.dashTime === 0,
        '空中下射改变了身体、资源或借用了冲刺与技能', aimed);
      await control('jump', false);
      const impact = await observe(() => window.__raidDivefireObserved || false);
      await control('fire', false);
      require(!impact.error && impact.downBullet && impact.after.stomps === 0 &&
        impact.after.score === 0 && impact.after.enemies.length === 3 &&
        impact.after.enemies.some(e => e.hp < 3) && !impact.after.ground &&
        equal(impact.after.devices, impact.initial.devices),
        '真实空中俯射没有独立造成首次伤害', { error: impact.error, initial: impact.initial, after: impact.after, downBullet: impact.downBullet?.state });
      fs.writeFileSync(prefix + '-field-downshot.png', Buffer.from(impact.downBullet.png, 'base64'));
      await control('down', false);
      const released = await observe(() => { const s = window.__raidState; return s.fireAim === 0 ? s : false; });
      check(released.touchCount === 0 && released.stomps === 0, '松开没有恢复平射或清除触点', released);

      checkpoint = label + ' 地面蹲射与暂停清输入';
      await observe(() => window.__raidState.ground);
      await control('down', true); await control('fire', true);
      const crouched = await observe(() => { const s = window.__raidState;
        return s.crouch && s.fireAim === 0 && s.playerProjectiles.some(b => b.vx === -650 && b.vy === 0) ? s : false;
      });
      check(crouched.ground && crouched.playerHeight === 28, '地面下键不再保持原有蹲射', crouched);
      // A third finger is not a primary pointer, so tapping a plain pause
      // button while two action fingers remain down need not synthesize click.
      // Test the real background/blur interruption instead, without dispatching
      // a synthetic DOM event or disguising a mouse click as touchscreen input.
      let paused;
      if (mobile) {
        const from = await page.evaluate(() => window.__raidDivefireTouches.length);
        const heldContacts = [...contacts.entries()];
        const background = await context.newPage();
        try {
          checkpoint = label + ' 持触点切后台自动暂停';
          await background.bringToFront();
          // Background tabs may suspend RAF; observe with a timed poll instead.
          await page.waitForFunction(() => window.__raidState?.phase === 'pause',
            { timeout: 5000, polling: 100 });
          paused = await read();
          check(await page.evaluate(() => document.hidden || !document.hasFocus()),
            '没有真正切到后台就声称中断了触控');
          check(paused.touchCount === 0 && paused.fireAim === 0,
            '真实切后台没有清除仍按住的触点和瞄准', paused);
          await page.bringToFront();
          // End each real native contact exactly once. Chromium may already
          // have sent pointercancel during the background transition; otherwise
          // ending the still-captured contact must generate pointerup.
          for (const [action, contact] of heldContacts) {
            await contact.handle.end(); contacts.delete(action);
          }
          const ended = await page.evaluate(index => ({
            events: window.__raidDivefireTouches.slice(index),
            active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action),
            count: window.__raidState.touchCount,
          }), from);
          check(ended.active.length === 0 && ended.count === 0 && heldContacts.every(([action, contact]) => {
            const terminal = ended.events.filter(e => e.pointerId === contact.pointerId &&
              e.action === action && ['pointerup', 'pointercancel'].includes(e.type));
            return terminal.length === 1 && terminal[0].trusted;
          }), '后台中断后的原生触点未恰好结束一次或仍有粘键', ended);
        } finally {
          await background.close(); await page.bringToFront();
        }
      } else {
        paused = await pause(); await release();
      }
      check(paused.touchCount === 0 && paused.fireAim === 0, '暂停没有清理俯射和触控输入', paused);
      await wait(220);
      check(equal(await read(), paused), '暂停没有冻结弹道和敌人');
      await shot('paused-downshot');
      for (const selector of ['#restart', '#menu-home']) {
        await activate(selector); await phase('confirmRestart');
        const confirm = await read(); await wait(120);
        check(equal(await read(), confirm), '确认期间游戏仍在推进');
        await activate('#cancel-restart'); await phase('pause');
        check(equal(await read(), paused), '取消操作改变了暂停战斗');
      }
      await activate('#start'); await phase('playing');
      const resumedShots = (await read()).shots; await wait(190);
      check((await read()).shots === resumedShots && (await read()).touchCount === 0,
        '继续后仍残留自动开火或触点');
      checkpoint = label + ' 松开触点后原生暂停按钮与重开';
      await pause();
      await activate('#restart'); await phase('confirmRestart'); await activate('#start'); await phase('playing');
      const restarted = await read();
      check(restarted.shots === 0 && restarted.fireAim === 0 && restarted.touchCount === 0 &&
        restarted.playerProjectiles.length === 0 && restarted.hp === 6 && restarted.grenades === 3 &&
        restarted.stomps === 0 && restarted.enemies.every(e => e.hp === 3), '重开残留俯射或伤害状态', restarted);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '页面横向溢出');
      await shot('fresh-restart');
    } catch (error) {
      check(false, checkpoint + '：' + error.message, await read().catch(() => null));
      await shot('failure').catch(() => {});
    } finally {
      await release().catch(error => check(false, '无法释放真实输入：' + error.message));
      await context.close();
    }
  }
}
