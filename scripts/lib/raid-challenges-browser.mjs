/** Real DOM/input checks for the published, minified challenge implementation. */
import path from 'node:path';

export async function checkRaidChallenges(page, problems) {
  const read = () => page.evaluate(() => ({ ...window.__raidState }));
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, message, state) => { if (!ok) problems.push('Pixel Raid 挑战：' + message + (state ? ' ' + JSON.stringify(state) : '')); };
  const phase = name => page.waitForFunction(value => window.__raidState?.phase === value, { timeout: 4000 }, name);
  const shot = name => page.screenshot({ path: path.join(process.cwd(), '.shots', 'pixelraid-' + name + '.png'), fullPage: true });
  const home = async () => {
    const state = await read();
    if (state.phase === 'playing') await page.keyboard.press('p');
    await page.click('#menu-home');
    if ((await read()).phase === 'confirmRestart') await page.click('#start');
    await phase('title');
  };

  await home();
  await page.click('#mode-campaign');
  await page.click('#difficulty-relaxed');
  const before = (await read()).progress;
  // Native focused Space/Enter selects the mode/card without triggering the hidden campaign action.
  await page.focus('#mode-challenges');
  await page.keyboard.press('Space');
  const choices = await page.evaluate(() => ({
    phase: window.__raidState.phase, mode: window.__raidState.titleView,
    campaignHidden: document.getElementById('start').hidden && document.getElementById('difficulty-options').hidden,
    cards: [...document.querySelectorAll('#challenge-menu button')].map(button => ({
      id: button.id, disabled: button.disabled, visible: button.getBoundingClientRect().height > 0,
    })),
  }));
  check(choices.phase === 'title' && choices.mode === 'challenges' && choices.campaignHidden &&
    choices.cards.length === 3 && choices.cards.every(card => !card.disabled && card.visible), '任务入口或模式选择不正确', choices);
  await shot('challenges-desktop');
  await page.focus('#challenge-sprint');
  await page.keyboard.press('Enter');
  await phase('playing');
  let state = await read();
  check(state.mode === 'challenge' && state.challengeId === 'sprint' && state.difficulty === 'standard' &&
    state.progress.selectedDifficulty === 'relaxed' && state.upgrades.dash === 1, '限时挑战或固定装具错误', state);
  await wait(160);
  await page.keyboard.press('p');
  await phase('pause');
  const frozen = await read();
  await wait(220);
  check((await read()).challengeTime === frozen.challengeTime, '暂停没有冻结任务计时');
  const mission = await page.evaluate(() => ({
    visible: !document.getElementById('mission-hud').hidden,
    goal: document.getElementById('mission-objective').textContent,
    time: document.getElementById('mission-time').textContent,
  }));
  check(mission.visible && mission.goal.includes('首领') && mission.time.includes('剩余'), '缺少目标或剩余时间', mission);
  await page.click('#restart'); await phase('confirmRestart');
  await page.click('#cancel-restart'); await phase('pause');
  check((await read()).challengeTime === frozen.challengeTime, '取消重开改变了任务计时');
  await page.click('#restart'); await page.click('#start'); await phase('playing');
  state = await read();
  check(state.challengeId === 'sprint' && state.challengeTime < 1 && state.x === 64, '重开错误地退出当前挑战', state);
  await home();
  check((await read()).difficulty === 'relaxed', '回指挥部没有恢复远征难度');

  // Reflect an actual turret projectile. A dash beginning midway through its
  // flight meets the first two burst shots; no mutable game hooks are exposed.
  await page.click('#challenge-counter'); await phase('playing');
  await page.waitForFunction(() => window.__raidState?.turretCharge > 0, { timeout: 4500 });
  await page.waitForFunction(() => window.__raidState?.turretCharge === 0, { timeout: 2500 });
  const volleyTime = (await read()).challengeTime;
  await page.waitForFunction(start => window.__raidState.challengeTime >= start + .43, { timeout: 2000 }, volleyTime);
  await page.keyboard.press('l');
  await page.waitForFunction(() => window.__raidState?.challengeReflections > 0, { timeout: 1800 });
  await page.keyboard.press('p'); await phase('pause');
  state = await read();
  check(state.challengeId === 'counter' && state.reflections === state.challengeReflections && state.upgrades.dash === 2,
    '真实反弹没有进入任务目标计数', state);
  check(await page.$eval('#mission-objective', element => element.textContent.includes('反弹')), '反弹目标未显示');
  await shot('challenge-counter');
  await home();

  // Complete all three arena bosses through ordinary fire and beam dodges.
  // The VM suite covers precise timings; this tests the minified gameplay path.
  await page.click('#challenge-bosses'); await phase('playing');
  state = await read();
  check(state.hp === 7 && state.lives === 1 && state.grenades === 5 && state.worldWidth === 960 && state.intelTotal === 0,
    '首领连战竞技场初始化错误', state);
  for (let round = 1; round <= 3; round++) {
    await shot('boss-arena-' + round);
    await page.keyboard.down('j');
    const deadline = Date.now() + 40000;
    let dodged = false, moving = false;
    try {
      while (Date.now() < deadline) {
        state = await read();
        if (state.phase !== 'playing') break;
        if (state.x < 680 && !moving) { await page.keyboard.down('d'); moving = true; }
        else if (state.x >= 680 && moving) { await page.keyboard.up('d'); moving = false; }
        const nearby = state.hostiles.some(bullet => bullet.x > state.x && bullet.x < state.x + 127 &&
          bullet.y > state.y - 15 && bullet.y < state.y + state.playerHeight + 15);
        if (nearby && state.dashCooldown === 0) await page.keyboard.press('l');
        if (state.bossAttackType === 'beam' && state.bossCharge > 0 && state.bossCharge <= .38 && !dodged) {
          if (state.bossBeamY > 405) await page.keyboard.press('w');
          else await page.keyboard.down('s');
          dodged = true;
        }
        if (state.bossCharge === 0 && state.bossBeamTime === 0) {
          await page.keyboard.up('s'); dodged = false;
        }
        await wait(100);
      }
    } finally { await page.keyboard.up('j'); await page.keyboard.up('d'); await page.keyboard.up('s'); }
    check(state.phase === (round < 3 ? 'bossBreak' : 'challengeClear') && state.bossWins === round,
      '真实射击未完成第 ' + round + ' 位首领', state);
    if (state.phase !== 'bossBreak' && state.phase !== 'challengeClear') break;
    if (round < 3) {
      const intermission = state;
      await wait(150);
      check((await read()).challengeTime === intermission.challengeTime, '首领整备计入用时');
      await page.click('#restart'); await page.click('#cancel-restart'); await phase('bossBreak');
      await page.click('#start'); await phase('playing');
      state = await read();
      check(state.stage === round + 1 && state.lives === 1 && state.hp === Math.min(7, intermission.hp + 2) &&
        state.grenades === Math.min(7, intermission.grenades + 2) && state.cam === 0 && state.challengeTime >= intermission.challengeTime,
        '关间资源或竞技场状态不正确', state);
    }
  }
  state = await read();
  if (state.phase === 'challengeClear') {
    await shot('challenge-complete');
    const record = state.progress.challenges.bosses;
    check(record.clears === 1 && record.best > 3900 && record.bestTime > 0, '连战没有保存有效完成纪录', record);
    check(JSON.stringify(state.progress.campaign) === JSON.stringify(before.campaign) &&
      JSON.stringify(state.progress.practice) === JSON.stringify(before.practice) && state.progress.unlocked === before.unlocked,
      '挑战污染远征或练习纪录');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__raidReady === true);
    state = await read();
    check(state.difficulty === 'relaxed' && JSON.stringify(state.progress.challenges.bosses) === JSON.stringify(record),
      '重载后丢失挑战纪录或难度偏好', state);
    await page.click('#mode-challenges');
    check(await page.$eval('#challenge-record-bosses', element => element.textContent.includes('完成 1 次') && element.textContent.includes('最快')),
      '指挥部没有展示完成纪录');
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__raidReady === true);
  }

  for (const viewport of [{ width: 320, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => window.__raidReady === true);
    await page.click('#mode-challenges');
    await page.$eval('#challenge-bosses', button => button.scrollIntoView({ block: 'center' }));
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth, viewport: innerWidth,
      cards: [...document.querySelectorAll('#challenge-menu button')].map(button => {
        const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height };
      }),
    }));
    check(layout.width <= layout.viewport + 1 && layout.cards.every(card => card.width >= 80 && card.height >= 44),
      '小屏挑战选择器溢出或触控区域过小', layout);
    await shot(viewport.width === 320 ? 'challenges-mobile' : 'challenges-landscape');
    await (await page.$('#challenge-bosses')).tap();
    await phase('playing');
    check((await read()).challengeId === 'bosses', '触屏未开始所选挑战');
    await page.keyboard.press('p'); await home();
  }
}
