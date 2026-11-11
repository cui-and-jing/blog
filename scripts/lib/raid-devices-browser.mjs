/** Published explosive devices: read-only snapshots and real keyboard/touch input. */
import path from 'node:path';
import { survivalTactics } from './raid-survival-tactics.mjs';

export async function checkRaidDevices(sourcePage, problems) {
  // A disposable profile provides a genuine fresh save without touching storage,
  // game state, enemy placement, the random source or the production clock.
  const context = await sourcePage.browser().createBrowserContext();
  const page = await context.newPage();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let checkpoint = '初始化', client = null, touchActive = false;
  const check = (ok, message, details) => {
    if (!ok) problems.push('Pixel Raid 爆破装置：' + message + (details ? ' ' + JSON.stringify(details) : ''));
    return ok;
  };
  const read = () => page.evaluate(() => ({ ...window.__raidState }));
  const phase = value => page.waitForFunction(expected => window.__raidState?.phase === expected,
    { timeout: 5000 }, value);
  const shot = name => page.screenshot({
    path: path.join(process.cwd(), '.shots', 'pixelraid-devices-' + name + '.png'), fullPage: true,
  });
  const pristine = state => state.devices?.length === 2 && state.devices.every(d => d.hp === 2 && !d.spent);
  const frozen = state => ({
    phase: state.phase, x: state.x, y: state.y, hp: state.hp, score: state.score, shots: state.shots,
    grenades: state.grenades, clock: state.clock, survivalTime: state.survivalTime, spawnTime: state.spawnTime,
    devices: state.devices, enemies: state.enemies, hostiles: state.hostiles,
  });
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const release = async () => {
    for (const key of ['a', 'd', 'w', 's', 'j']) await page.keyboard.up(key);
    if (touchActive) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      touchActive = false;
    }
  };
  const tap = async selector => {
    await page.$eval(selector, el => el.scrollIntoView({ block: 'center' }));
    await (await page.$(selector)).tap();
  };
  const begin = async mobile => {
    await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
      deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
    if (mobile) { await tap('#mode-survival'); await tap('#start'); }
    else { await page.click('#mode-survival'); await page.click('#start'); }
    await phase('playing');
    const state = await read();
    check(state.mode === 'survival' && state.survivalWave === 1 && state.weapon === 'rifle' && pristine(state),
      '普通首波没有两枚完好的装置或基础步枪', state);
    check(equal(state.devices.map(d => [d.x + d.w / 2, d.y + d.h]), [[360, 425], [600, 425]]),
      '阶台装置没有落在实际地面', state.devices);
  };
  const touchStart = async action => {
    await page.$eval('.controls', el => el.scrollIntoView({ block: 'end' }));
    const point = await page.$eval('[data-action="' + action + '"]', el => {
      const r = el.getBoundingClientRect(); return { id: 1, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    check(point.x >= 0 && point.x < 320 && point.y >= 0 && point.y < 844,
      '触控按钮不在 320px 可触区域：' + action, point);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    touchActive = true;
  };
  const touchEnd = async () => {
    if (!touchActive) return;
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    touchActive = false;
  };
  const singleShot = async mobile => {
    // Observe the first real projectile before releasing. This avoids relying on
    // keypress duration versus RAF, while staying well below the 150ms cadence.
    const before = (await read()).shots;
    if (mobile) await touchStart('fire'); else await page.keyboard.down('j');
    try {
      await page.waitForFunction(count => window.__raidState.shots > count,
        { timeout: 1500, polling: 'raf' }, before);
    } finally {
      if (mobile) await touchEnd(); else await page.keyboard.up('j');
    }
    check((await read()).shots === before + 1, '单次输入意外发射多发子弹', { checkpoint, before, state: await read() });
  };
  const waitHit = hp => page.waitForFunction(value => {
    const target = window.__raidState.devices[1]; return target.hp === value && target.spent === (value === 0);
  }, { timeout: 1800, polling: 'raf' }, hp);
  const restart = async () => {
    if ((await read()).phase === 'playing') { await page.keyboard.press('p'); await phase('pause'); }
    await page.click('#restart'); await phase('confirmRestart');
    await page.click('#start'); await phase('playing');
    const state = await read();
    check(state.survivalWave === 1 && state.shots === 0 && state.hp === 6 && state.spawnTime > 0 && pristine(state),
      '确认重开未恢复新一波装置、体力或射击计数', state);
  };
  const fightFirstWave = async () => {
    const decide = survivalTactics(), deadline = Date.now() + 35000;
    let moving = '', firing = false, jumping = false;
    try {
      while (Date.now() < deadline) {
        const state = await read();
        if (state.phase !== 'playing' || state.survivalWave !== 1) break;
        const input = decide(state), fire = input.fire !== false;
        if (firing !== fire) { await page.keyboard[fire ? 'down' : 'up']('j'); firing = fire; }
        if (moving !== input.move) {
          if (moving) await page.keyboard.up(moving);
          if (input.move) await page.keyboard.down(input.move);
          moving = input.move;
        }
        if (input.jump && state.ground) {
          if (jumping) await page.keyboard.up('w');
          await page.keyboard.down('w'); jumping = true;
        } else if (!input.jump && jumping) { await page.keyboard.up('w'); jumping = false; }
        if (input.dash) await page.keyboard.press('l');
        if (input.grenade) await page.keyboard.press('k');
        await wait(80);
      }
    } finally { await release(); }
    const state = await read();
    return check(state.phase === 'waveClear' && state.survivalCleared === 1 && state.hp > 0,
      '真实键盘战斗未打通首波，无法验证第二波连锁', state);
  };

  page.on('pageerror', error => check(false, '页面异常：' + error.message, { checkpoint }));
  try {
    checkpoint = '桌面增援保护';
    await begin(false);
    // Approach the right device during the visible ingress countdown. Standing
    // inside its blast radius also makes the later no-self-damage check useful.
    await page.keyboard.down('d');
    await page.waitForFunction(() => window.__raidState.x >= 535, { timeout: 1500, polling: 'raf' });
    await page.keyboard.up('d');
    await page.keyboard.down('j'); await wait(260); await page.keyboard.up('j');
    await wait(150);
    let state = await read();
    check(state.spawnTime > 0 && state.shots >= 2 && pristine(state),
      '增援倒计时期间射击提前伤害或引爆装置', state);
    await shot('desktop-ingress');
    await page.waitForFunction(() => window.__raidState.spawnTime === 0, { timeout: 4000 });

    checkpoint = '桌面首发命中';
    await singleShot(false); await waitHit(1);
    state = await read();
    check(state.devices[0].hp === 2 && !state.devices[0].spent && state.devices[1].hp === 1 &&
      !state.devices[1].spent && state.combatText.includes('装置受损'),
    '基础步枪首发没有只损伤命中的装置', state);
    await page.keyboard.press('p'); await phase('pause');
    const paused = frozen(await read());
    await wait(220);
    check(equal(frozen(await read()), paused), '暂停未冻结已受损装置或战场', { paused, after: frozen(await read()) });
    for (const selector of ['#restart', '#menu-home']) {
      await page.click(selector); await phase('confirmRestart');
      const confirm = frozen(await read()); await wait(160);
      check(equal(frozen(await read()), confirm), '确认框未冻结受损装置：' + selector);
      await page.click('#cancel-restart'); await phase('pause');
      check(equal(frozen(await read()), paused), '取消操作重置或推进受损装置：' + selector,
        { paused, after: frozen(await read()) });
    }
    await shot('desktop-damaged-paused');
    await page.click('#start'); await phase('playing');
    // Let the existing rifle cooldown finish, rather than manipulating it.
    await wait(180);
    checkpoint = '桌面第二发引爆';
    const beforeBlast = await read();
    await singleShot(false); await waitHit(0);
    state = await read();
    check(state.hp === beforeBlast.hp && Math.abs(state.x + 13 - 600) < 145 &&
      state.devices[0].hp === 2 && !state.devices[0].spent,
    '爆炸伤及附近玩家或错误连锁到半径外装置', { beforeBlast, state });
    check(state.combatText.includes('战术爆破') &&
      (await page.$eval('#mission-objective', el => el.textContent)).includes('爆破装置 1 / 2'),
    '引爆后没有战斗提示或剩余装置计数');
    await shot('desktop-ignited');
    checkpoint = '桌面重开复原';
    await restart();

    checkpoint = '真实战斗进入第二波';
    try {
      if (await fightFirstWave()) {
        // Prefer a non-fire-rate module so the two-hit ledge assertion remains
        // comparable. The choice is an actual offered supply, never a seeded one.
        state = await read();
        const index = state.supplyOffers.findIndex(key => key !== 'rapid');
        await page.click('#supply-' + Math.max(0, index));
        await page.click('#start'); await phase('playing');
        state = await read();
        check(state.survivalWave === 2 && pristine(state) &&
          equal(state.devices.map(d => [d.x + d.w / 2, d.y + d.h]), [[410, 365], [540, 365]]),
        '第二波没有刷新双翼高台上的连锁装置', state);
        // Move right from the real spawn, jump onto the 365px platform and face
        // left. No enemy, device, position, weapon or timing fixture is used.
        await page.keyboard.down('d');
        await page.waitForFunction(() => window.__raidState.x >= 570, { timeout: 1500, polling: 'raf' });
        await page.keyboard.up('d'); await page.keyboard.press('w');
        await page.waitForFunction(() => {
          const s = window.__raidState; return s.ground && Math.abs(s.y + s.playerHeight - 365) < 1;
        }, { timeout: 2500 });
        const beforeTurn = (await read()).x;
        await page.keyboard.down('a');
        await page.waitForFunction(x => window.__raidState.x < x, { timeout: 1000, polling: 'raf' }, beforeTurn);
        await page.keyboard.up('a');
        await page.waitForFunction(() => window.__raidState.spawnTime === 0, { timeout: 4000 });
        checkpoint = '高台真实连锁';
        await singleShot(false); await waitHit(1);
        const first = await read();
        check(first.devices[0].hp === 2 && !first.devices[0].spent && first.weapon === 'rifle',
          '连锁前的首发提前损伤另一枚装置或不是基础步枪', first);
        await wait(180);
        await singleShot(false);
        await page.waitForFunction(() => window.__raidState.devices.every(d => d.spent && d.hp === 0),
          { timeout: 1800, polling: 'raf' });
        state = await read();
        check(state.shots === first.shots + 1 && state.hp === first.hp && state.combatText.includes('连锁爆破 ×2') &&
          (await page.$eval('#mission-objective', el => el.textContent)).includes('爆破装置 0 / 2'),
        '一发后没有完成高台连锁、伤及玩家或计数未同步', { first, state });
        await shot('desktop-ledge-chain');
      }
    } catch (error) {
      check(false, checkpoint + '：' + error.message, await read().catch(() => null));
      await shot('chain-failure').catch(() => {});
    } finally { await release(); }

    checkpoint = '320px 触屏首发与引爆';
    await begin(true);
    client = await page.createCDPSession();
    await touchStart('right');
    await page.waitForFunction(() => window.__raidState.x >= 535, { timeout: 1500, polling: 'raf' });
    await touchEnd();
    await page.waitForFunction(() => window.__raidState.spawnTime === 0, { timeout: 4000 });
    await singleShot(true); await waitHit(1);
    const mobileFirst = await read();
    check(mobileFirst.touchCount === 0 && mobileFirst.devices[0].hp === 2 && !mobileFirst.devices[0].spent,
      '触屏首发没有正确损伤装置或释放触点', mobileFirst);
    await shot('touch-320-damaged');
    await wait(180);
    await singleShot(true); await waitHit(0);
    state = await read();
    check(state.hp === mobileFirst.hp && state.touchCount === 0 && state.shots === mobileFirst.shots + 1,
      '触屏第二发未安全引爆或触点卡住', { mobileFirst, state });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      '320px 触屏页面横向溢出');
    await shot('touch-320-ignited');
  } catch (error) {
    check(false, checkpoint + '：' + error.message, await read().catch(() => null));
    await shot('failure').catch(() => {});
  } finally {
    await release().catch(() => {});
    if (client) await client.detach().catch(() => {});
    await context.close();
  }
}
