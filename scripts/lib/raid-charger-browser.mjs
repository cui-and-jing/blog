/** Real fourth-wave counterplay, using only controls and detached read-only snapshots. */
export async function checkRaidCharger(page, { read, check, shot, phase, wait }) {
  const viewport = page.viewport();
  const charger = state => state.enemies.find(enemy => enemy.type === 'charger');
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  // Return the snapshot observed by RAF, rather than reading again after a
  // protocol round trip and possibly missing a short rush/overlap window.
  const observe = async (predicate, ...args) => {
    const handle = await page.waitForFunction(predicate, { timeout: 5000, polling: 'raf' }, ...args);
    try { return await handle.jsonValue(); } finally { await handle.dispose(); }
  };
  let checkpoint = '第四波增援', client, touchActive = false, touchEmulation = false;
  try {
    let state = await read();
    check(state.phase === 'playing' && state.survivalWave === 4 && state.spawnTime > 0 &&
      state.enemies.length === 5 && state.enemies.filter(enemy => enemy.type === 'charger').length === 1 &&
      charger(state)?.hp === 4 && charger(state)?.chargerPhase === 'hunt',
    '冲锋兵没有以一名普通敌人的名额加入第四波', state);
    check((await page.$eval('#announcer', element => element.textContent)).includes('橙色冲锋兵'),
      '第四波增援没有播报冲锋兵的避让提示');

    // Stay on the FLOOR beneath the bridge. Beginning safely on the ledge
    // would not prove that the later jump actually escapes the warned attack.
    await page.keyboard.down('d');
    await observe(() => {
      const s = window.__raidState; return s.x >= 635 ? s : false;
    });
    await page.keyboard.up('d');
    state = await read();
    check(state.ground && Math.abs(state.y + state.playerHeight - 425) < 1 && state.x < 690,
      '冲锋兵避让测试没有通过真实移动站到栈桥下的实地', state);

    checkpoint = '地面标线与暂停';
    const warning = await observe(() => {
      const s = window.__raidState, e = s.enemies.find(enemy => enemy.type === 'charger');
      return e?.chargerPhase === 'windup' ? s : false;
    });
    const locked = charger(warning);
    const lane = { x: Math.min(locked.x, locked.chargerEnd),
      right: Math.max(locked.x, locked.chargerEnd) + locked.w, y: locked.y, bottom: locked.y + locked.h };
    check(warning.ground && warning.y < lane.bottom && warning.y + warning.playerHeight > lane.y &&
      warning.x < lane.right && warning.x + 27 > lane.x && locked.face === -1 &&
      Math.abs(locked.x - locked.chargerEnd - 216) < .01 && locked.chargerTime > 0 && locked.chargerTime <= .8,
    '起跳前玩家身体不在真实冲锋标线内，或标线方向、距离、蓄力错误', { warning, lane });
    check((await page.$eval('#announcer', element => element.textContent)).includes('冲锋兵蓄力'),
      '冲锋蓄力没有无障碍提示');
    await page.keyboard.press('p'); await phase('pause');
    const paused = await read();
    check(charger(paused)?.chargerPhase === 'windup', '未在真实蓄力期间暂停', paused);
    // Longer than a full windup: a wall-clock timer would incorrectly expire.
    await wait(900);
    check(equal(await read(), paused), '暂停推进冲锋计时、位置、资源或战场', { paused, state: await read() });
    for (const selector of ['#restart', '#menu-home']) {
      await page.click(selector); await phase('confirmRestart');
      const confirming = await read(); await wait(180);
      check(equal(await read(), confirming), '确认期间没有冻结冲锋兵：' + selector);
      await page.click('#cancel-restart'); await phase('pause');
      check(equal(await read(), paused), '取消确认改变冲锋标线或战场：' + selector);
    }
    // Read actual canvas pixels, not drawing hooks or source-string matches.
    // The bright dashed floor lane must exist beyond the orange enemy body.
    const pixels = await page.$eval('#field', (canvas, lane) => {
      const x = Math.ceil(lane.x), width = Math.floor(lane.right) - x;
      const rgba = canvas.getContext('2d').getImageData(x, 423, width, 1).data;
      let warningPixels = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i] === 255 && rgba[i + 1] === 224 && rgba[i + 2] === 160) warningPixels++;
      }
      return warningPixels;
    }, lane);
    check(pixels >= 40, '实际画布缺少可见的冲锋虚线预警', { pixels, lane });
    await page.keyboard.press('p'); await phase('playing');
    await shot('charger-warning-1280');
    await page.keyboard.press('p'); await phase('pause');
    state = await read();
    check(charger(state)?.chargerPhase === 'windup' && charger(state)?.chargerTime > 0,
      '桌面预警截图没有保留可操作的蓄力窗口', state);
    if (charger(state)?.chargerPhase !== 'windup') return;

    checkpoint = '320px 真实触屏起跳';
    // Keep isMobile/hasTouch unchanged: Puppeteer's mobile toggle reloads the
    // document and would silently replace this genuinely earned fourth wave.
    await page.setViewport({ ...viewport, width: 320, height: 844 });
    client = await page.createCDPSession();
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    touchEmulation = true;
    const beforeTouch = await read();
    check(equal(beforeTouch, state) && beforeTouch.survivalWave === 4,
      '窄屏或触屏设置重新加载、重置或推进了当前波次', { before: state, after: beforeTouch });
    await page.keyboard.press('p'); await phase('playing');
    await page.$eval('.controls', element => element.scrollIntoView({ block: 'end' }));
    const point = await page.$eval('[data-action="jump"]', element => {
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
    });
    check(point.width >= 42 && point.height >= 44 && point.x >= 0 && point.x < 320 && point.y >= 0 && point.y < 844 &&
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    '320px 跳跃触控不可操作或页面横向溢出', point);
    const lateWarning = await observe(() => {
      const s = window.__raidState, e = s.enemies.find(enemy => enemy.type === 'charger');
      return e?.chargerPhase === 'windup' && e.chargerTime <= .4 ? s : false;
    });
    check(lateWarning.ground && lateWarning.y + lateWarning.playerHeight > locked.y &&
      charger(lateWarning).x === locked.x && charger(lateWarning).face === locked.face &&
      charger(lateWarning).chargerEnd === locked.chargerEnd,
    '实际触屏起跳前已离开危险地面，或冲锋兵改变锁定标线', lateWarning);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ id: 1, x: point.x, y: point.y }] });
    touchActive = true;
    const airborne = await observe(() => {
      const s = window.__raidState; return !s.ground && s.y + s.playerHeight < 389 ? s : false;
    });
    check(airborne.touchCount === 1 && airborne.dropTime === 0 && airborne.dashTime === 0,
      '触屏跳跃没有真实起跳，或用了降层/冲刺替代跳跃', airborne);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    touchActive = false;
    check((await read()).touchCount === 0, '触屏取消没有释放跳跃触点');

    checkpoint = '冲锋穿过玩家与平台落地';
    const crossing = await observe(() => {
      const s = window.__raidState, e = s.enemies.find(enemy => enemy.type === 'charger');
      return e?.chargerPhase === 'rush' && e.x < s.x + 27 && e.x + e.w > s.x ? s : false;
    });
    const rushing = charger(crossing);
    check(crossing.y + crossing.playerHeight <= rushing.y && crossing.stageDeaths === warning.stageDeaths &&
      crossing.hp > 0 && rushing.face === locked.face && rushing.chargerEnd === locked.chargerEnd &&
      rushing.x < locked.x && rushing.x > locked.chargerEnd,
    '冲锋未真实经过玩家脚下，或突进追踪、越过标线、跳跃失败', { warning, crossing });
    const landed = await observe(() => {
      const s = window.__raidState;
      return s.ground && Math.abs(s.y + s.playerHeight - 335) < 1 ? s : false;
    });
    check(landed.x >= 545 && landed.x + 27 <= 700 && landed.stageDeaths === warning.stageDeaths && landed.hp > 0,
      '避开冲锋后没有通过真实碰撞落在安全栈桥上', landed);
    await shot('charger-touch-evasion-320');

    checkpoint = '锁定终点与回气窗口';
    const recovery = await observe(() => {
      const s = window.__raidState, e = s.enemies.find(enemy => enemy.type === 'charger');
      return e?.chargerPhase === 'recover' ? s : false;
    });
    const resting = charger(recovery);
    check(resting.x === locked.chargerEnd && resting.chargerEnd === locked.chargerEnd && resting.face === locked.face &&
      resting.chargerTime > 0 && resting.chargerTime <= 1.1,
    '冲锋没有在锁定终点进入回气窗口', recovery);
    await shot('charger-recovery-320');
    const later = await observe(start => {
      const s = window.__raidState; return s.survivalTime >= start + .2 ? s : false;
    }, recovery.survivalTime);
    check(charger(later)?.chargerPhase === 'recover' && charger(later).x === resting.x &&
      charger(later).face === resting.face && charger(later).chargerEnd === resting.chargerEnd &&
      charger(later).chargerTime < resting.chargerTime && later.shots === warning.shots &&
      later.grenades === warning.grenades && later.stageDeaths === warning.stageDeaths && later.hp > 0,
    '回气期间没有保持可反击的停顿，或避让测试消耗战斗资源', { recovery, later });
    // Let the original recovery controller finish this same run. The charger
    // is still alive, and no enemies, HP, RNG, pickups or progress were edited.
  } catch (error) {
    check(false, '冲锋兵浏览器检查 ' + checkpoint + '：' + error.message, await read().catch(() => null));
    await shot('charger-failure').catch(() => {});
  } finally {
    const errors = [];
    const cleanup = async action => { try { await action(); } catch (error) { errors.push(error.message); } };
    for (const key of ['a', 'd', 'w', 's', 'j']) await cleanup(() => page.keyboard.up(key));
    if (touchActive) await cleanup(() => client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }));
    // Resize while paused, then hand back a live desktop run for the unchanged
    // arena assertions and real recovery fight. Never retry or restart it.
    if ((await read().catch(() => null))?.phase === 'playing') {
      await cleanup(async () => { await page.keyboard.press('p'); await phase('pause'); });
    }
    if (touchEmulation) await cleanup(() => client.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.hasTouch ?? false }));
    if (client) await cleanup(() => client.detach());
    await cleanup(() => page.setViewport(viewport));
    if ((await read().catch(() => null))?.phase === 'pause') {
      await cleanup(async () => { await page.keyboard.press('p'); await phase('playing'); });
    }
    check(errors.length === 0, '冲锋兵测试输入或视口恢复失败', errors);
  }
}
