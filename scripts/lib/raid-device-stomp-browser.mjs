/** Stomp the actual first-wave device with native movement and detached evidence. */
import fs from 'node:fs';
import path from 'node:path';

export async function checkRaidDeviceStomp(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext(), page = await context.newPage();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    const prefix = path.join(process.cwd(), '.shots', `pixelraid-device-stomp-${label}`), held = new Map();
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
    const keys = { jump: 'w', down: 's', right: 'd' };
    const pointerAudit = async (index, types) => {
      await page.waitForFunction(({ index, types }) => window.__deviceStompProof.inputs.slice(index).some(event => types.includes(event.type)),
        { timeout: 2000, polling: 'raf' }, { index, types });
      return page.evaluate(({ index, types }) => ({
        events: window.__deviceStompProof.inputs.slice(index).filter(event => types.includes(event.type)),
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
        const index = await page.evaluate(() => window.__deviceStompProof.inputs.length);
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
        const contact = held.get(action), index = await page.evaluate(() => window.__deviceStompProof.inputs.length);
        await contact.handle.end();held.delete(action);
        const audit = await pointerAudit(index, ['pointerup', 'pointercancel']), event = audit.events[0];
        require(audit.events.length === 1 && event.action === action && event.pointerId === contact.pointerId && event.trusted &&
          audit.state.touchCount === held.size && JSON.stringify(audit.active) === JSON.stringify([...held.keys()].sort()),
        '原生触点未独立释放', { action, audit });
      } else { await page.keyboard.up(keys[action]);held.delete(action); }
    };
    const release = async () => { for (const action of [...held.keys()]) await up(action); };
    page.on('pageerror', error => problems.push(`Pixel Raid 踩爆装置 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        const proof = window.__deviceStompProof = { inputs: [], impact: null };
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel']) {
          document.addEventListener(type, event => {
            const target = event.target.closest?.('[data-action],button'), s = window.__raidState;
            proof.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id,
              tag: event.target?.tagName, pointerId: event.pointerId, trusted: event.isTrusted, repeat: !!event.repeat,
              clock: s?.clock, phase: s?.phase });
          }, true);
        }
        let previous;
        function observe() {
          const s = window.__raidState;
          if (s?.phase === 'playing' && previous?.phase === 'playing' && !proof.impact &&
              !previous.devices[1]?.spent && s.devices[1]?.spent) {
            proof.impact = { before: previous, after: s };
            // Capture the actual rendered collision frame, not a later CDP
            // screenshot after the brief burst has naturally expired.
            window.__deviceStompCanvas = document.getElementById('field').toDataURL('image/png').split(',')[1];
          }
          previous = s;requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait(() => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页暴露可写入口');
      await activate('#mode-survival');await activate('#start');await phase('playing');
      const fresh = await read();
      require(fresh.mode === 'survival' && fresh.survivalWave === 1 && fresh.arena.id === 'steps' &&
        fresh.devices.length === 2 && fresh.devices.every(device => !device.spent && device.hp === 2) &&
        fresh.devices[1].x === 588 && fresh.devices[1].y === 389 && fresh.spawnTime > 0,
      '未从原始第一波和完整装置开始', fresh);
      checkpoint = '增援期蹲走到装置下方的平台间隙';
      await down('down');await down('right');
      await wait(() => window.__raidState.x >= 585);
      await up('right');await up('down');
      const positioned = await read();
      require(positioned.x >= 585 && positioned.x < 610 && positioned.ground && positioned.spawnTime > 0 &&
        positioned.devices.every(device => !device.spent && device.hp === 2) && positioned.hp === fresh.hp,
      '蹲走未在增援期间安全停到装置正下方', positioned);
      checkpoint = '增援抵达后真实跳跃踩爆';
      await wait(() => window.__raidState.spawnTime === 0);
      const ready = await read();await down('jump');
      await wait(() => window.__deviceStompProof.impact !== null);
      const impact = await page.evaluate(() => window.__deviceStompProof.impact);
      const { before, after } = impact, device = before.devices[1], burst = after.stompBurst;
      // Prove this is an empty-device reward case, rather than silently ignoring
      // legitimate nearby enemy kills. At the first jump the right walker has
      // advanced only ~30px from x790 and remains outside the 145px blast.
      const outsideBlast = enemy => {
        const x = Math.max(enemy.x, Math.min(device.x + 12, enemy.x + enemy.w));
        const y = Math.max(enemy.y, Math.min(device.y + 18, enemy.y + enemy.h));
        return Math.hypot(device.x + 12 - x, device.y + 18 - y) > 145;
      };
      require(before.enemies.length === 3 && before.enemies.every(outsideBlast), '天然敌人已进入爆炸范围，无法证明装置本身不奖励', before);
      const age = burst ? .28 - burst.time : Infinity;
      require(before.spawnTime === 0 && before.vy > 0 && !before.ground && before.y + before.playerHeight <= device.y &&
        after.phase === 'playing' && after.survivalWave === 1 && after.devices[1].spent && after.devices[1].hp === 0 &&
        !after.devices[0].spent && after.devices[0].hp === 2 && after.deviceBursts.length === 1 &&
        after.deviceBursts[0].x === 600 && after.deviceBursts[0].y === 407 && after.deviceBursts[0].time > 0 &&
        burst?.device === true && burst.boosted === true && after.vy < 0 && !after.ground &&
        Math.abs(after.vy - (-560 + 1250 * age)) < .00001 && after.y + after.playerHeight <= device.y,
      '真实顶部接触没有引爆完整装置并产生高弹反冲', impact);
      require(after.hp === fresh.hp && after.score === 0 && after.stomps === 0 && after.shots === 0 &&
        after.grenades === fresh.grenades && after.tacticalUses === 0 && after.tacticalCharge === fresh.tacticalCharge &&
        after.dashTime === 0 && after.dashCooldown === 0 && after.enemies.length === 3 && after.enemies.every(enemy => enemy.hp === 3),
      '空装置给予额外资源、冒充敌人踏击或依赖其他攻击', after);
      await release();await activate('#pause');await phase('pause');
      const paused = await read();
      require(paused.devices[1].spent && paused.deviceBursts.length === 1 && paused.deviceBursts[0].time > 0,
        '暂停前装置爆炸证据已消失', paused);
      const image = await page.evaluate(() => window.__deviceStompCanvas);
      require(typeof image === 'string' && image.length > 0, '缺少低动效下的真实踩爆画布');
      fs.writeFileSync(prefix + '-impact.png', Buffer.from(image, 'base64'));
      await page.screenshot({ path: prefix + '-paused.png', fullPage: true });
      checkpoint = '暂停及取消重开冻结爆炸与弹起';
      await new Promise(resolve => setTimeout(resolve, 160));
      require(JSON.stringify(await read()) === JSON.stringify(paused), '暂停仍推进爆炸、弹起或敌人');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require(JSON.stringify(await read()) === JSON.stringify(paused), '取消重开改变爆炸场景');
      checkpoint = '确认重开恢复装置并清理输入';
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      const restarted = await read();
      require(restarted.survivalWave === 1 && restarted.devices.every(device => !device.spent && device.hp === 2) &&
        restarted.deviceBursts.length === 0 && restarted.stompBurst === null && restarted.stomps === 0 &&
        restarted.touchCount === 0 && restarted.shots === 0 && restarted.score === 0 && restarted.grenades === fresh.grenades,
      '重开未恢复装置或遗留攻击输入', restarted);
      const proof = await page.evaluate(() => window.__deviceStompProof);
      require(proof.inputs.every(event => event.trusted) && proof.inputs.some(event => mobile ?
        event.type === 'pointerdown' && event.action === 'jump' : event.type === 'keydown' && event.key === 'w'),
      '踩爆不是由真实原生跳跃完成', proof.inputs);
      fs.writeFileSync(prefix + '-route.json', JSON.stringify({ fresh, positioned, ready, proof, paused, restarted }, null, 2));
      await activate('#pause');await phase('pause');await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
        document.documentElement.scrollWidth <= innerWidth + 1), '大厅被展开或页面横向溢出');
    } catch (error) {
      const evidence = await page.evaluate(() => ({ state: window.__raidState, proof: window.__deviceStompProof })).catch(() => null);
      problems.push(`Pixel Raid 踩爆装置 ${label}：${checkpoint}：${error.message}`);
      fs.writeFileSync(prefix + '-diagnostic.json', JSON.stringify({ checkpoint, error: error.message, evidence }, null, 2));
      await page.screenshot({ path: prefix + '-error.png', fullPage: true }).catch(() => {});
    } finally { await release().catch(() => {});await context.close(); }
  }
}
