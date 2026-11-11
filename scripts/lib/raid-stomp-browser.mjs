/** Aerial stomp: fresh saves, ordinary movement/jump, and read-only observation. */
import fs from 'node:fs';
import path from 'node:path';

export async function checkRaidStomp(sourcePage, problems) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, message, details) => {
    if (!ok) problems.push('Pixel Raid 空中踏击：' + message + (details ? ' ' + JSON.stringify(details) : ''));
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
    const prefix = path.join(process.cwd(), '.shots', 'pixelraid-stomp-' + label);
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
      const from = await page.evaluate(() => window.__raidStompTouches.length);
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
      const audit = await page.evaluate(index => ({ events: window.__raidStompTouches.slice(index),
        active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action).sort(),
        count: window.__raidState.touchCount }), from);
      const event = audit.events[0], expected = [...contacts.keys()].sort();
      require(audit.events.length === 1 && event.action === action && event.trusted &&
        event.type === (held ? 'pointerdown' : 'pointerup') &&
        (held || event.pointerId === previous.pointerId) && equal(audit.active, expected) &&
        audit.count === expected.length, '移动或跳跃没有使用可独立释放的真实触点', { action, held, audit, expected });
      if (held) contacts.get(action).pointerId = event.pointerId;
    };
    const release = async () => {
      for (const name of [...keys]) await key(name, false);
      for (const action of [...contacts.keys()]) await touch(action, false);
    };
    const control = (action, held) => mobile ? touch(action, held) : key(action === 'left' ? 'a' : 'w', held);
    const pause = async () => {
      if (mobile) await activate('#pause'); else await page.keyboard.press('p');
      await phase('pause'); return read();
    };
    page.on('pageerror', error => check(false, '页面异常：' + error.message, { checkpoint }));

    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      // A user-visible accessibility preference, not a game-clock fixture.
      // It also keeps the mint outline at the observed world coordinates.
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        window.__raidStompTouches = [];
        for (const type of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(type, event => {
          const target = event.target.closest?.('[data-action]');
          if (target) window.__raidStompTouches.push({ type, action: target.dataset.action,
            pointerId: event.pointerId, trusted: event.isTrusted });
        }, true);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' }); await page.bringToFront();
      await page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
      require(await page.evaluate(() => !('__raidQA' in window)), '发布版本暴露可写战斗测试入口');
      await activate('#mode-survival'); await activate('#start'); await phase('playing');
      const fresh = await read();
      require(fresh.mode === 'survival' && fresh.survivalWave === 1 && fresh.survivalCleared === 0 &&
        fresh.loadout === 'assault' && fresh.hp === 6 && fresh.grenades === 3 && fresh.shots === 0 &&
        fresh.stomps === 0 && fresh.stompBurst === null && fresh.spawnTime > 0 &&
        fresh.enemies.length === 3 && fresh.enemies.every(e => e.type === 'walker' && e.hp === 3 && e.stagger === 0),
      '界面没有开启真正全新的普通第一波', fresh);

      checkpoint = label + ' 真实移动到平台间隙';
      // Walk left during ingress. The left ledge ends at 365px and its landing
      // test has a 3px inset, so x >= 362 stays clear even if input release takes
      // a few frames. The central ledge is too high for this ordinary jump.
      await control('left', true);
      await observe(() => { const s = window.__raidState; return s.x <= 400 ? s : false; });
      await control('left', false);
      const positioned = await read();
      require(positioned.x >= 362 && positioned.x <= 405 && positioned.ground && positioned.stomps === 0,
        '真实移动没有停在可踏击的地面间隙', positioned);

      checkpoint = label + ' 真实跳跃踏击';
      const ready = await observe(() => {
        const s = window.__raidState, center = s.x + 13.5;
        const nearest = s.enemies.filter(e => e.type === 'walker' && e.hp === 3)
          .sort((a, b) => Math.abs(a.x + a.w / 2 - center) - Math.abs(b.x + b.w / 2 - center))[0];
        const gap = nearest ? Math.abs(nearest.x + nearest.w / 2 - center) : Infinity;
        return s.phase === 'playing' && s.spawnTime === 0 && s.ground && gap <= 47 && gap > 30 ? s : false;
      });
      // Observe consecutive rendered frames without intercepting the game's
      // RAF. Save the actual canvas on the first stomp frame, before its short
      // burst can disappear during screenshot or CDP round trips.
      await page.evaluate(() => {
        const start = window.__raidState;
        window.__raidStompObserved = null;
        let previous = start;
        const deadline = performance.now() + 5000;
        function observeFrame() {
          const current = window.__raidState;
          if (current.stomps > start.stomps) {
            const canvas = document.getElementById('field'), burst = current.stompBurst;
            let mintPixels = 0;
            if (burst) {
              const x = Math.floor(burst.x - current.cam - 29), y = Math.floor(burst.y - 28);
              const pixels = canvas.getContext('2d').getImageData(x, y, 58, 39).data;
              for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] === 185 && pixels[i + 1] === 255 && pixels[i + 2] === 226) mintPixels++;
              }
            }
            window.__raidStompObserved = { before: previous, after: current, mintPixels,
              png: canvas.toDataURL('image/png').split(',')[1] };
            return;
          }
          if (current.phase !== 'playing' || performance.now() > deadline) {
            window.__raidStompObserved = { error: '真实跳跃没有在 5 秒内踏中敌人', before: previous, after: current };
            return;
          }
          previous = current; requestAnimationFrame(observeFrame);
        }
        requestAnimationFrame(observeFrame);
      });
      await control('jump', true);
      const jumping = await observe(() => { const s = window.__raidState;
        return !s.ground && s.vy < 0 && s.stomps === 0 ? s : false;
      });
      await control('jump', false);
      check(jumping.y < ready.y && (mobile ? jumping.touchCount === 1 : jumping.touchCount === 0),
        '原生跳跃没有使玩家起跳', { ready, jumping });
      const impact = await observe(() => window.__raidStompObserved || false);
      require(!impact.error, impact.error ?? '踏击观察失败', { before: impact.before, after: impact.after });
      const { before, after } = impact;
      const damaged = after.enemies.map((e, i) => ({ e, previous: before.enemies[i] }))
        .filter(({ e, previous }) => previous && e.hp !== previous.hp);
      require(after.stomps === 1 && before.stomps === 0 && damaged.length === 1 &&
        damaged[0].previous.hp === 3 && damaged[0].e.hp === 1 && damaged[0].e.type === 'walker',
      '自然下落没有恰好对一名满血步兵造成 2 点踏击伤害', { before, after });
      const target = damaged[0].e;
      // One rendered frame can contain several fixed simulation steps. Verify
      // the -400 impulse plus only the gravity elapsed since the observed burst,
      // rather than demanding the very first simulation step arrive over CDP.
      const impactAge = after.stompBurst ? .28 - after.stompBurst.time : Infinity;
      check(before.vy > 0 && !before.ground && !after.ground && after.vy < 0 &&
        Math.abs(after.vy - (-400 + 1250 * impactAge)) < .001 &&
        after.y + after.playerHeight <= target.y && target.stagger > 0 &&
        Math.abs(target.stagger - (.3 - impactAge)) < .001 &&
        after.stompBurst?.time > 0 && after.stompBurst.time <= .28 &&
        after.stompBurst.y === target.y && after.combatText.includes('空中踏击'),
      '踏击没有从上方下降、向上弹起、短暂停敌或显示提示', { before, after });
      check(['hp', 'shots', 'grenades', 'score', 'stageDeaths', 'tacticalUses', 'tacticalCharge', 'reflections']
        .every(name => ready[name] === after[name]) && after.shots === 0 && after.score === 0 &&
        after.dashTime === 0 && after.dashCooldown === 0 && after.tacticalTime === 0 && after.touchCount === 0,
      '首次非致命踏击受伤、消耗资源、额外奖励或借用了其他动作', { ready, after });
      check(impact.mintPixels >= 35, '实际画布没有踏击的薄荷色轮廓', { mintPixels: impact.mintPixels, burst: after.stompBurst });
      fs.writeFileSync(prefix + '-field-impact.png', Buffer.from(impact.png, 'base64'));

      checkpoint = label + ' 暂停、重开和取消';
      const paused = await pause(); await wait(250);
      check(equal(await read(), paused), '暂停没有冻结踏击弹起和敌人状态');
      for (const selector of ['#restart', '#menu-home']) {
        await activate(selector); await phase('confirmRestart');
        const confirm = await read(); await wait(180);
        check(equal(await read(), confirm), '确认框推进踏击状态：' + selector);
        await activate('#cancel-restart'); await phase('pause');
        check(equal(await read(), paused), '取消重开或回首页改变了踏击状态：' + selector);
      }
      const detached = await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(window, '__raidState');
        const a = window.__raidState, b = window.__raidState;
        return typeof descriptor.get === 'function' && !descriptor.set && !descriptor.configurable &&
          a !== b && a.enemies !== b.enemies && a.enemies.every((e, i) => e !== b.enemies[i]) &&
          (!a.stompBurst || a.stompBurst !== b.stompBurst) && JSON.stringify(a) === JSON.stringify(b);
      });
      check(detached, '踏击调试快照不是独立只读观察结果');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' 页面横向溢出');
      await shot('paused-after-cancel');

      await activate('#restart'); await phase('confirmRestart'); await activate('#start'); await phase('playing');
      const restarted = await read();
      check(restarted.survivalWave === 1 && restarted.survivalCleared === 0 && restarted.stomps === 0 &&
        restarted.stompBurst === null && restarted.hp === 6 && restarted.shots === 0 && restarted.score === 0 &&
        restarted.grenades === 3 && restarted.spawnTime > 0 && restarted.touchCount === 0 &&
        restarted.enemies.length === 3 && restarted.enemies.every(e => e.hp === 3 && e.stagger === 0),
      '确认重开没有清除踏击计数、效果和敌人硬直', restarted);
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
