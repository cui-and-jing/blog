/** Published Survival mode: ordinary DOM controls and genuine keyboard input only. */
import path from 'node:path';

export async function checkRaidSurvival(page, problems) {
  const read = () => page.evaluate(() => ({ ...window.__raidState }));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, message, state) => {
    if (!ok) problems.push('Pixel Raid 防线：' + message + (state ? ' ' + JSON.stringify(state) : ''));
  };
  const phase = name => page.waitForFunction(value => window.__raidState?.phase === value, { timeout: 4000 }, name);
  const shot = name => page.screenshot({ path: path.join(process.cwd(), '.shots', 'pixelraid-survival-' + name + '.png'), fullPage: true });
  await page.setViewport({ width: 1280, height: 960, isMobile: false, hasTouch: false });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__raidReady === true);
  await page.click('#difficulty-relaxed');
  const before = (await read()).progress;
  await page.focus('#mode-survival'); await page.keyboard.press('Space');
  check((await read()).titleView === 'survival' && (await read()).phase === 'title', '原生键盘选择模式意外开始游戏');
  check(await page.$eval('#survival-menu', element => !element.hidden) &&
    await page.$eval('#difficulty-options', element => element.hidden), '防线规则或固定难度入口显示错误');
  await shot('desktop-title');
  await page.focus('#start'); await page.keyboard.press('Enter'); await phase('playing');
  let state = await read();
  check(state.mode === 'survival' && state.hp === 6 && state.lives === 1 && state.grenades === 3 &&
    state.survivalWave === 1 && state.difficulty === 'standard' && state.worldWidth === 960, '起始资源或竞技场错误', state);
  await page.keyboard.press('p'); await phase('pause');
  const paused = await read(); await wait(180);
  state = await read();
  check(state.survivalTime === paused.survivalTime && state.spawnTime === paused.spawnTime, '暂停没有冻结增援或生存计时');
  await page.click('#restart'); await phase('confirmRestart');
  await page.click('#cancel-restart'); await phase('pause');
  check((await read()).survivalTime === paused.survivalTime, '取消重开改变波次时间');
  await page.click('#start'); await phase('playing');
  await shot('spawn-warning');

  // Clear the introductory wave without touching internal state. Face the
  // closest ground enemy, keep a small gap, and reflect bullets when threatened.
  const deadline = Date.now() + 25000;
  let moving = '';
  await page.keyboard.down('j');
  try {
    while (Date.now() < deadline) {
      state = await read();
      if (state.phase !== 'playing') break;
      const enemy = [...state.enemies].sort((a, b) => Math.abs(a.x - state.x) - Math.abs(b.x - state.x))[0];
      if (!enemy) { await wait(80); continue; }
      const direction = enemy.x + enemy.w / 2 > state.x + 13 ? 'd' : 'a';
      if (moving !== direction) {
        if (moving) await page.keyboard.up(moving);
        await page.keyboard.down(direction); moving = direction;
      }
      const nearby = state.hostiles.some(bullet => Math.abs(bullet.x - state.x - 13) < 95 &&
        bullet.y > state.y - 12 && bullet.y < state.y + state.playerHeight + 12);
      if (nearby && state.dashCooldown === 0) await page.keyboard.press('l');
      await wait(80);
    }
  } finally {
    for (const key of ['j', 'a', 'd']) await page.keyboard.up(key);
  }
  state = await read();
  check(state.phase === 'waveClear' && state.survivalCleared === 1 && state.progress.survival.wave === 1 &&
    state.progress.survival.best > 250, '真实射击没有完成首波或保存清场纪录', state);
  if (state.phase !== 'waveClear') return;
  check(await page.$eval('#start', element => element.disabled), '未选补给即可继续');
  check(state.supplyOffers.length === 3 && new Set(state.supplyOffers).size === 3, '补给选项重复');
  const intermission = state;
  await wait(200);
  check((await read()).survivalTime === intermission.survivalTime, '整备计入用时');
  await shot('desktop-supply');

  // Resize without toggling mobile emulation so the current run survives. The
  // real touch entry is exercised separately after the reload below.
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844, isMobile: false, hasTouch: false });
    for (let i = 0; i < 3; i++) {
      await page.$eval('#supply-' + i, element => element.scrollIntoView({ block: 'center' }));
      const box = await page.$eval('#supply-' + i, element => {
        const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width, h: r.height };
      });
      check(box.w >= 80 && box.h >= 44 && box.x >= 0 && box.right <= width + 1, '窄屏补给按钮尺寸或位置错误', box);
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '窄屏横向溢出');
    await shot('mobile-supply-' + width);
  }
  await page.focus('#supply-0'); await page.keyboard.press('Space');
  const selected = await read();
  await page.click('#restart'); await phase('confirmRestart');
  await page.click('#cancel-restart'); await phase('waveClear');
  state = await read();
  check(state.selectedSupply === selected.selectedSupply && JSON.stringify(state.supplyOffers) === JSON.stringify(selected.supplyOffers),
    '取消确认重抽补给或丢失选择');
  await page.click('#start'); await phase('playing');
  state = await read();
  check(state.survivalWave === 2 && state.upgrades[selected.selectedSupply] === 1 && state.shots === intermission.shots,
    '补给未生效或整备输入泄漏', state);
  await page.keyboard.press('p'); await phase('pause');
  const record = (await read()).progress.survival;
  await page.click('#menu-home'); await phase('confirmRestart'); await page.click('#start'); await phase('title');
  state = await read();
  check(state.difficulty === 'relaxed' && state.titleView === 'survival', '返回后没有恢复远征难度与玩法入口');
  for (const key of ['campaign', 'practice', 'challenges', 'unlocked', 'selectedDifficulty']) {
    check(JSON.stringify(state.progress[key]) === JSON.stringify(before[key]), '防线污染其他记录：' + key);
  }
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__raidReady === true);
  check(JSON.stringify((await read()).progress.survival) === JSON.stringify(record), '刷新丢失已清场纪录');
  for (const viewport of [{ width: 320, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => window.__raidReady === true);
    await page.click('#mode-survival');
    await page.$eval('#start', element => element.scrollIntoView({ block: 'center' }));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '触屏标题溢出');
    await shot('touch-title-' + viewport.width);
    await (await page.$('#start')).tap(); await phase('playing');
    check((await read()).mode === 'survival', '触屏入口未开始生存');
    await page.click('#pause'); await phase('pause');
    await page.click('#menu-home'); await phase('confirmRestart'); await page.click('#start'); await phase('title');
  }
}
