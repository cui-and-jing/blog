/** Arena assertions and actual input checks. State is inspected, never changed. */
export const arenaLayouts = {
  steps: { name: '中央阶台', platforms: [[210,325,155],[405,285,150],[640,325,155]], spread: 1 },
  flanks: { name: '双翼高台', platforms: [[135,325,175],[350,365,105],[510,365,105],[650,325,175]], spread: 3 },
  bridge: { name: '错层栈桥', platforms: [[135,335,165],[340,295,150],[545,335,155],[745,305,145]], spread: 1 },
};

export async function checkArena(page, id, { read, check, shot, phase }) {
  const state = await read(), expected = arenaLayouts[id];
  const [x, y, w] = expected.platforms[expected.spread];
  check(state.arena?.id === id && state.arena.name === expected.name && state.arena.hint &&
    JSON.stringify(state.platforms) === JSON.stringify(expected.platforms), '地形名称或实际平台几何错误：' + id, state);
  check(state.pickups.some(p => p.kind === 'spread' && p.x === x + w / 2 && p.y === y - 25),
    '高台武器没有随地形移动：' + id, state);
  check((await page.$eval('#mission-objective', el => el.textContent)).includes(expected.name), '任务提示缺少当前地形：' + id);
  // Freeze gameplay while framing each viewport, without replacing the live run.
  await page.keyboard.press('p'); await phase('pause');
  const viewport = page.viewport();
  for (const width of [1280, 320]) {
    await page.setViewport({ ...viewport, width, height: width === 320 ? 844 : 960 });
    await page.click('#start'); await phase('playing');
    await shot('arena-' + id + '-' + width);
    await page.keyboard.press('p'); await phase('pause');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '地形窄屏横向溢出：' + id);
  }
  await page.setViewport(viewport);
  await page.click('#start'); await phase('playing');
}

export async function checkPlatformDescent(page, { read, check, shot, phase, wait }) {
  for (const touch of [false, true]) {
    await page.setViewport({ width: touch ? 320 : 1280, height: touch ? 844 : 960, isMobile: touch, hasTouch: touch });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__raidReady === true);
    await page.click('#mode-survival'); await page.click('#start'); await phase('playing');
    // Walk from the centre to the left ledge, then jump onto its real collision
    // surface. No teleport, enemy removal, seeded randomness or wave skipping.
    let client;
    try {
      await page.keyboard.down('a');
      await page.waitForFunction(() => window.__raidState.x < 280, { timeout: 2500 });
      await page.keyboard.up('a');
      await page.keyboard.press('w');
      await page.waitForFunction(() => {
        const s = window.__raidState; return s.ground && Math.abs(s.y + s.playerHeight - 325) < 1;
      }, { timeout: 2500 });
      const ledge = await read();
      check(ledge.x > 210 && ledge.x < 340, '未通过真实移动登上测试平台', ledge);
      if (touch) {
        await page.$eval('.controls', el => el.scrollIntoView({ block: 'end' }));
        client = await page.createCDPSession();
      }
      const chord = async () => {
        if (!touch) { await page.keyboard.down('s'); await page.keyboard.down('w'); return; }
        await page.$eval('.controls', el => el.scrollIntoView({ block: 'end' }));
        const points = await page.$$eval('[data-action="down"], [data-action="jump"]', els => els.map((el, id) => {
          const r = el.getBoundingClientRect(); return { id, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }));
        check(points.length === 2 && points.every(p => p.x >= 0 && p.x < 320 && p.y >= 0 && p.y < 844), '触屏降层控件不在可触区域', points);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
      };
      const release = async () => {
        if (touch) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else { await page.keyboard.up('w'); await page.keyboard.up('s'); }
      };
      await chord();
      await page.waitForFunction(() => window.__raidState.dropTime > 0, { timeout: 1200, polling: 'raf' });
      await page.keyboard.press('p'); await phase('pause');
      const paused = await read();
      // The positive drop was observed above. Protocol latency may let it finish
      // before Pause arrives, so do not require a second 200ms-window hit.
      check(paused.y + paused.playerHeight > 325 && paused.y + paused.playerHeight <= 425,
        '下蹲加跳跃未从平台向下穿越：' + (touch ? 'touch' : 'keyboard'), paused);
      await release(); await wait(280);
      const frozen = await read();
      check(frozen.y === paused.y && frozen.dropTime === paused.dropTime && frozen.survivalTime === paused.survivalTime,
        '暂停没有冻结降层位置、计时或波次时间', { paused, frozen });
      await shot('drop-paused-' + (touch ? 'touch-320' : 'keyboard-1280'));
      await page.click('#start'); await phase('playing');
      await page.waitForFunction(() => {
        const s = window.__raidState; return s.ground && Math.abs(s.y + s.playerHeight - 425) < 1 && s.dropTime === 0;
      }, { timeout: 2000 });
      const floor = await read();
      check(floor.x > 210 && floor.x < 340 && floor.stageDeaths === 0, '降层未落回原平台下方实地', floor);
      await chord();
      await page.waitForFunction(() => !window.__raidState.ground, { timeout: 1200, polling: 'raf' });
      let rose = false, belowFloor = false, floorDrop = false;
      // Observe the complete normal jump: Down+Jump on solid ground must never
      // mark a platform drop or put the character beneath the floor.
      for (let i = 0; i < 24; i++) {
        const s = await read();
        rose ||= s.y + s.playerHeight < 415;
        belowFloor ||= s.y + s.playerHeight > 425.1;
        floorDrop ||= s.dropTime > 0;
        if (i === 0) await release();
        await wait(45);
      }
      check(rose && !belowFloor && !floorDrop && (await read()).stageDeaths === 0,
        '实地的下蹲加跳跃不是正常起跳或穿透地板：' + (touch ? 'touch' : 'keyboard'));
    } finally {
      for (const key of ['a', 's', 'w']) await page.keyboard.up(key);
      if (client) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await client.detach();
      }
    }
  }
}
