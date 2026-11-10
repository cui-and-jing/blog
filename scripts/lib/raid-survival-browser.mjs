/** Published Survival mode: ordinary DOM controls and genuine keyboard input only. */
import path from 'node:path';
import { survivalTactics } from './raid-survival-tactics.mjs';

export async function checkRaidSurvival(page, problems) {
  const read = () => page.evaluate(() => ({ ...window.__raidState }));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, message, state) => {
    if (!ok) problems.push('Pixel Raid 防线：' + message + (state ? ' ' + JSON.stringify(state) : ''));
  };
  const phase = name => page.waitForFunction(value => window.__raidState?.phase === value, { timeout: 4000 }, name);
  const shot = name => page.screenshot({ path: path.join(process.cwd(), '.shots', 'pixelraid-survival-' + name + '.png'), fullPage: true });
  const loadouts = {
    assault: { name: '机动突击', hp: 6, grenades: 3 },
    counter: { name: '反击先锋', hp: 5, grenades: 3 },
    demolition: { name: '爆破专家', hp: 6, grenades: 5 },
  };
  const pairs = { rapid: 'pierce', pierce: 'rapid', dash: 'reflect', reflect: 'dash', armor: 'blast', blast: 'armor' };
  const unchanged = (actual, expected, except = []) => JSON.stringify(Object.fromEntries(
    Object.entries(actual).filter(([key]) => !except.includes(key)),
  )) === JSON.stringify(Object.fromEntries(Object.entries(expected).filter(([key]) => !except.includes(key))));
  const visible = selector => page.$eval(selector, element =>
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
  const tap = async selector => {
    await page.$eval(selector, element => element.scrollIntoView({ block: 'center' }));
    await (await page.$(selector)).tap();
  };
  const checkSelection = async key => {
    const state = await read();
    const ui = await page.evaluate(() => ({
      status: document.querySelector('#loadout-status').textContent,
      choices: [...document.querySelectorAll('#survival-menu button[id^="loadout-"]')].map(element => ({
        id: element.id, pressed: element.getAttribute('aria-pressed'),
      })),
    }));
    check(state.phase === 'title' && state.titleView === 'survival' && state.selectedLoadout === key &&
      ui.status.includes(loadouts[key].name) && ui.choices.length === 3 &&
      ui.choices.every(choice => choice.pressed === String(choice.id === 'loadout-' + key)),
    '装具选择、说明或按钮按下状态错误', { state, ui });
  };
  const chooseLoadout = async (key, input = 'Space') => {
    const before = await read();
    if (input === 'touch') await tap('#loadout-' + key);
    else { await page.focus('#loadout-' + key); await page.keyboard.press(input); }
    const state = await read();
    check(unchanged(state, before, ['selectedLoadout']), '选择装具提前开局或改变当前角色、资源与纪录', { before, state });
    await checkSelection(key);
  };
  const checkLoadoutStart = async key => {
    const state = await read(), kit = loadouts[key];
    check(state.phase === 'playing' && state.mode === 'survival' && state.loadout === key && state.selectedLoadout === key &&
      state.hp === kit.hp && state.maxHp === kit.hp && state.grenades === kit.grenades && state.lives === 1 &&
      state.weapon === 'rifle' && state.weaponTime === 0 && state.shots === 0 && state.survivalWave === 1 &&
      Object.keys(pairs).every(module => state.upgrades[module] === 0) && state.synergies.length === 0,
    '开局装具、基础属性或零级模组错误：' + kit.name, state);
    check((await page.$eval('#run-label', element => element.textContent)).includes(kit.name) &&
      (await page.$eval('#build-summary', element => element.textContent)).includes(kit.name), '本局标签或构筑摘要缺少装具名称：' + kit.name);
    check(!await visible('#loadout-' + key) && !await visible('#supply-reroll'), '游玩中泄漏装具选择或补给重抽控件');
  };
  const checkComplement = state => {
    const missing = Object.keys(pairs).filter(key => state.upgrades[key] === 0 && state.upgrades[pairs[key]] > 0);
    check(!missing.length || missing.some(key => state.supplyOffers.includes(key)), '补给未提供未完成组合所缺的任一模组', state);
  };

  // Drive the same controls a player uses. Snapshots only choose the next input;
  // never replace enemies, move the player, change HP, seed RNG or skip a wave.
  const fight = async (wave, { bossScreenshot = false } = {}) => {
    const deadline = Date.now() + 45000;
    const decide = survivalTactics();
    let moving = '', jumping = false, captured = false;
    const move = async direction => {
      if (moving === direction) return;
      if (moving) await page.keyboard.up(moving);
      if (direction) await page.keyboard.down(direction);
      moving = direction;
    };
    await page.keyboard.down('j');
    try {
      while (Date.now() < deadline) {
        const state = await read();
        if (state.phase !== 'playing' || state.survivalWave !== wave) break;
        const input = decide(state);
        await move(input.move);
        if (input.jump && state.ground) {
          if (jumping) await page.keyboard.up('w');
          await page.keyboard.down('w'); jumping = true;
        } else if (!input.jump && jumping) {
          await page.keyboard.up('w'); jumping = false;
        }
        if (input.dash) await page.keyboard.press('l');
        if (input.grenade) await page.keyboard.press('k');
        if (bossScreenshot && !captured && state.spawnTime === 0 && state.bossHp > 0 && state.bossHp < state.bossMaxHp) {
          await shot('boss-combat'); captured = true;
        }
        await wait(80);
      }
    } finally {
      for (const key of ['j', 'a', 'd', 'w']) await page.keyboard.up(key);
    }
    const state = await read();
    check(state.phase === 'waveClear' && state.survivalCleared === wave && state.progress.survival.wave === wave &&
      state.hp > 0 && state.lives === 1 && state.stageDeaths === 0, '真实键盘战斗未完成第 ' + wave + ' 波', state);
    if (bossScreenshot) check(captured, '未观察到可截图的真实首领交战');
    return state;
  };

  const checkBuild = async () => {
    const state = await read();
    const build = await page.evaluate(() => ({
      shown: !document.querySelector('#build-panel').hidden,
      open: document.querySelector('#build-panel').open,
      summary: document.querySelector('#build-summary').textContent,
      modules: document.querySelector('#build-modules').textContent,
      recipes: [...document.querySelectorAll('#build-panel li')].map(element => ({
        key: element.id.replace('synergy-', ''), active: element.dataset.active === 'true', text: element.textContent,
      })),
    }));
    check(build.shown && build.open && build.summary.includes('本局构筑') &&
      build.summary.includes(loadouts[state.loadout]?.name) && build.modules.includes('1 级'),
      '游玩中的构筑面板未展开或未显示已装备模组', build);
    check(build.recipes.length === 3 && build.recipes.every(recipe => recipe.text.includes(' + ') &&
      recipe.active === state.synergies.includes(recipe.key)), '组合配方或点亮状态与实际构筑不一致', build);
  };

  await page.setViewport({ width: 1280, height: 960, isMobile: false, hasTouch: false });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__raidReady === true);
  check((await read()).selectedLoadout === 'assault', '刷新后的默认装具不是机动突击');
  await page.click('#difficulty-relaxed');
  const before = (await read()).progress;
  await page.focus('#mode-survival'); await page.keyboard.press('Space');
  check((await read()).titleView === 'survival' && (await read()).phase === 'title', '原生键盘选择模式意外开始游戏');
  check(await page.$eval('#survival-menu', element => !element.hidden) &&
    await page.$eval('#difficulty-options', element => element.hidden), '防线规则或固定难度入口显示错误');
  await checkSelection('assault');
  check(!await visible('#supply-reroll'), '标题页泄漏补给重抽控件');
  await shot('desktop-title');
  // Native activation selects, but never starts. Retry and either canceled
  // confirmation must preserve the chosen kit until the player returns home.
  for (const key of ['counter', 'demolition']) {
    await chooseLoadout(key, 'Space');
    await chooseLoadout(key, 'Enter');
    await page.focus('#start'); await page.keyboard.press('Enter'); await phase('playing');
    await checkLoadoutStart(key);
    await page.keyboard.press('p'); await phase('pause');
    const frozen = await read();
    for (const button of ['#restart', '#menu-home']) {
      await page.click(button); await phase('confirmRestart');
      check(!await visible('#loadout-' + key) && !await visible('#supply-reroll'), '确认期间泄漏装具选择或补给重抽控件');
      await page.click('#cancel-restart'); await phase('pause');
      check(unchanged(await read(), frozen), '取消操作改变暂停中的装具或本局状态：' + key);
    }
    await page.click('#restart'); await phase('confirmRestart');
    await page.click('#start'); await phase('playing');
    await checkLoadoutStart(key);
    await page.keyboard.press('p'); await phase('pause');
    await page.click('#menu-home'); await phase('confirmRestart'); await page.click('#start'); await phase('title');
    await checkSelection(key);
  }
  await chooseLoadout('assault', 'Enter');
  await chooseLoadout('assault', 'Space');
  await page.focus('#start'); await page.keyboard.press('Enter'); await phase('playing');
  await checkLoadoutStart('assault');
  let state = await read();
  check(state.mode === 'survival' && state.hp === 6 && state.lives === 1 && state.grenades === 3 &&
    state.survivalWave === 1 && !state.bossWave && state.bossMaxHp === 0 && state.difficulty === 'standard' &&
    state.worldWidth === 960, '起始资源、首波类型或竞技场错误', state);
  await page.keyboard.press('p'); await phase('pause');
  const paused = await read(); await wait(180);
  state = await read();
  check(state.survivalTime === paused.survivalTime && state.spawnTime === paused.spawnTime, '暂停没有冻结增援或生存计时');
  await page.click('#restart'); await phase('confirmRestart');
  await page.click('#cancel-restart'); await phase('pause');
  check((await read()).survivalTime === paused.survivalTime, '取消重开改变波次时间');
  await page.click('#start'); await phase('playing');
  await shot('spawn-warning');

  state = await fight(1);
  check(state.progress.survival.best > 250, '首波未保存清场得分', state);
  if (state.phase !== 'waveClear') return;
  check(await page.$eval('#start', element => element.disabled), '未选补给即可继续');
  check(state.supplyOffers.length === 3 && new Set(state.supplyOffers).size === 3, '补给选项重复');
  check((await page.$eval('#overlay-text', element => element.textContent)).includes('下一波：双向增援 · 第 2 波'), '首波未预告第二波增援');
  check(state.supplyRerolls === 1 && await visible('#supply-reroll') &&
    await page.$eval('#supply-reroll', element => element.getAttribute('aria-disabled') === 'false'), '首波没有可用的免费补给重抽', state);
  const beforeReroll = state;
  await page.focus('#supply-0'); await page.keyboard.press('Space');
  check((await read()).selectedSupply === beforeReroll.supplyOffers[0] &&
    !await page.$eval('#start', element => element.disabled), '重抽前的补给选择未生效');
  await page.focus('#supply-reroll'); await page.keyboard.press('Enter');
  state = await read();
  check(state.phase === 'waveClear' && state.supplyRerolls === 0 && state.selectedSupply === null &&
    state.supplyOffers.length === 3 && new Set(state.supplyOffers).size === 3 &&
    await page.$$eval('#survival-options button[id^="supply-"][aria-pressed]', elements =>
      elements.length === 3 && elements.every(element => element.getAttribute('aria-pressed') === 'false')) &&
    await page.$eval('#start', element => element.disabled) &&
    await page.$eval('#supply-reroll', element => element.getAttribute('aria-disabled') === 'true'),
  '重抽未清空选择、禁用继续或用尽本波次数', state);
  check(unchanged(state, beforeReroll, ['supplyOffers', 'selectedSupply', 'supplyRerolls']),
    '免费重抽改变了资源、模组、计时、纪录或触发战斗输入', { beforeReroll, state });
  checkComplement(state);
  const rerolled = state;
  await page.click('#supply-reroll');
  check(unchanged(await read(), rerolled), '重复点击已用尽的重抽仍改变补给或本局状态');
  for (const button of ['#restart', '#menu-home']) {
    await page.click(button); await phase('confirmRestart');
    check(!await visible('#supply-reroll'), '确认期间仍显示补给重抽');
    await page.click('#cancel-restart'); await phase('waveClear');
    check(unchanged(await read(), rerolled) && await page.$eval('#supply-reroll', element => element.getAttribute('aria-disabled') === 'true'),
      '取消操作恢复了已用重抽次数、旧选择或改变新补给');
  }
  const intermission = await read();
  await wait(200);
  check((await read()).survivalTime === intermission.survivalTime, '整备计入用时');
  await shot('desktop-supply');

  // Resize without toggling mobile emulation so the current run survives. The
  // real touch entry is exercised separately after the reload below.
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844, isMobile: false, hasTouch: false });
    for (const selector of ['#supply-0', '#supply-1', '#supply-2', '#supply-reroll']) {
      await page.$eval(selector, element => element.scrollIntoView({ block: 'center' }));
      const box = await page.$eval(selector, element => {
        const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width, h: r.height };
      });
      check(box.w >= 80 && box.h >= 44 && box.x >= 0 && box.right <= width + 1, '窄屏补给按钮尺寸或位置错误', box);
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '窄屏横向溢出');
    await shot('mobile-supply-' + width);
  }
  // A permanent first choice also makes the subsequent build panel meaningful.
  const firstChoice = Math.max(0, intermission.supplyOffers.indexOf('armor'));
  await page.focus('#supply-' + firstChoice); await page.keyboard.press('Space');
  const selected = await read();
  await page.click('#restart'); await phase('confirmRestart');
  await page.click('#cancel-restart'); await phase('waveClear');
  state = await read();
  check(state.selectedSupply === selected.selectedSupply && state.supplyRerolls === 0 &&
    JSON.stringify(state.supplyOffers) === JSON.stringify(selected.supplyOffers),
    '取消确认重抽补给或丢失选择');
  await page.setViewport({ width: 1280, height: 960, isMobile: false, hasTouch: false });
  await page.click('#start'); await phase('playing');
  state = await read();
  check(state.survivalWave === 2 && !state.bossWave && state.bossMaxHp === 0 &&
    state.loadout === 'assault' && state.upgrades[selected.selectedSupply] === 1 && state.shots === intermission.shots,
    '第二波类型、补给效果或整备输入隔离错误', state);
  check(!await visible('#supply-reroll'), '新波战斗仍显示补给重抽');

  // Native details/summary keyboard operation must work without Space jumping
  // in play, or Enter accidentally resuming the game while it is paused.
  await page.focus('#build-summary'); await page.keyboard.press('Space'); await wait(80);
  await checkBuild();
  state = await read();
  check(state.phase === 'playing' && state.ground && state.shots === intermission.shots, '展开构筑触发了战斗输入', state);
  await page.keyboard.press('Enter');
  check(await page.$eval('#build-panel', element => !element.open), 'Enter 不能收起构筑面板');
  await page.keyboard.press('Space');
  await page.keyboard.press('p'); await phase('pause');
  await page.focus('#build-summary'); await page.keyboard.press('Enter');
  check((await read()).phase === 'pause' && await page.$eval('#build-panel', element => !element.open), '暂停中查看构筑意外恢复战斗');
  await page.keyboard.press('Space');
  await checkBuild();
  await shot('build-expanded');
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844, isMobile: false, hasTouch: false });
    await page.$eval('#build-summary', element => element.scrollIntoView({ block: 'start' }));
    const box = await page.$eval('#build-panel', element => {
      const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width };
    });
    check(box.w > 0 && box.x >= 0 && box.right <= width + 1 &&
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '窄屏展开构筑横向溢出', box);
    await checkBuild();
    await shot('build-expanded-' + width);
  }
  await page.setViewport({ width: 1280, height: 960, isMobile: false, hasTouch: false });
  await page.click('#start'); await phase('playing');
  state = await fight(2);
  if (state.phase !== 'waveClear') return;
  check(state.supplyRerolls === 1 && await visible('#supply-reroll') &&
    await page.$eval('#supply-reroll', element => element.getAttribute('aria-disabled') === 'false'), '下一波清场没有恢复免费重抽', state);
  checkComplement(state);
  check((await page.$eval('#overlay-text', element => element.textContent)).includes('下一波：首领战 · 边境守卫'), '第二波未预告首位首领');
  const beforeBoss = state;
  // Pick a real recovery offer if needed, otherwise prefer a possible combo.
  let secondChoice = state.supplyOffers.indexOf('armor');
  if (secondChoice < 0 && state.hp < 4) secondChoice = state.supplyOffers.indexOf('heal');
  if (secondChoice < 0) secondChoice = state.supplyOffers.findIndex(key => state.upgrades[pairs[key]] > 0);
  await page.focus('#supply-' + Math.max(0, secondChoice)); await page.keyboard.press('Space');
  await page.click('#start'); await phase('playing');
  state = await read();
  check(state.survivalWave === 3 && state.bossWave && state.bossMaxHp === 32 && state.bossHp === 32 &&
    state.enemies.length === 0 && state.survivalCleared === 2 && state.progress.survival.wave === 2,
    '第三波不是首位独立首领，或首领未死便记入清场', state);
  check(state.spawnTime > 0 && state.spawnTime <= 2.2 &&
    Math.abs(state.survivalTime - beforeBoss.survivalTime + state.spawnTime - 2.2) < .04,
    '首领没有完整的 2.2 秒抵达预警', state);
  check((await page.$eval('#mission-name', element => element.textContent)).includes('首领战') &&
    (await page.$eval('#mission-objective', element => element.textContent)).includes('首领'), '首领预警缺少可读任务提示');
  await shot('boss-warning');
  await page.keyboard.press('p'); await phase('pause');
  const bossPaused = await read();
  // Longer than the entire warning, so a wall-clock countdown would expire.
  await wait(2400);
  state = await read();
  check(bossPaused.spawnTime > 0 && state.spawnTime === bossPaused.spawnTime && state.survivalTime === bossPaused.survivalTime &&
    state.bossHp === 32 && state.bossAttacks === 0 && state.hostiles.length === 0 &&
    state.refluxCooldown === bossPaused.refluxCooldown, '暂停消耗首领预警、组合冷却或触发首领攻击', state);
  await page.click('#start'); await phase('playing');
  await page.waitForFunction(() => window.__raidState?.spawnTime === 0, { timeout: 5000 });
  state = await read();
  check(state.phase === 'playing' && state.bossHp === 32 && state.enemies.length === 0 &&
    state.survivalCleared === 2 && state.progress.survival.wave === 2 && state.score === beforeBoss.score,
    '首领抵达后在未击杀时提前清场或加分', state);
  check(state.survivalTime - bossPaused.survivalTime >= bossPaused.spawnTime - .02,
    '恢复后首领提前结束抵达预警', state);
  state = await fight(3, { bossScreenshot: true });
  if (state.phase !== 'waveClear') return;
  check(state.supplyRerolls === 1 && state.loadout === 'assault', '首领清场未补充重抽或改变了本局装具', state);
  checkComplement(state);
  check(state.bossHp === 0 && state.progress.survival.best === state.score && state.score >= beforeBoss.score + 2150 &&
    state.selectedSupply === null && state.supplyOffers.length === 3 && new Set(state.supplyOffers).size === 3,
    '真实击败首领后纪录、奖励或补给错误', state);
  check((await page.$eval('#overlay-text', element => element.textContent)).includes('已恢复 2 点体力和 2 枚手雷') &&
    (await page.$eval('#overlay-text', element => element.textContent)).includes('下一波：双向增援 · 第 4 波'),
    '首领补给未显示强化恢复和第四波预告');
  check(await page.$eval('#start', element => element.disabled), '首领清场后未选补给即可继续');
  await shot('boss-supply');
  const record = state.progress.survival;
  await page.click('#menu-home'); await phase('confirmRestart'); await page.click('#start'); await phase('title');
  state = await read();
  check(state.difficulty === 'relaxed' && state.titleView === 'survival', '返回后没有恢复远征难度与玩法入口');
  check(await page.$eval('#build-panel', element => element.hidden), '标题页泄漏本局构筑面板');
  for (const key of ['campaign', 'practice', 'challenges', 'unlocked', 'selectedDifficulty']) {
    check(JSON.stringify(state.progress[key]) === JSON.stringify(before[key]), '防线污染其他记录：' + key);
  }
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__raidReady === true);
  check(JSON.stringify((await read()).progress.survival) === JSON.stringify(record), '刷新丢失已清场纪录');
  check((await read()).selectedLoadout === 'assault', '重载未恢复默认装具');
  for (const { key, ...viewport } of [{ key: 'counter', width: 320, height: 844 }, { key: 'demolition', width: 844, height: 390 }]) {
    await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => window.__raidReady === true);
    await tap('#mode-survival');
    for (const kit of Object.keys(loadouts)) {
      await chooseLoadout(kit, 'touch');
      const box = await page.$eval('#loadout-' + kit, element => {
        const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width, h: r.height };
      });
      check(box.w >= 80 && box.h >= 44 && box.x >= 0 && box.right <= viewport.width + 1,
        '触屏装具选择按钮尺寸或位置错误：' + kit, box);
    }
    await chooseLoadout(key, 'touch');
    await chooseLoadout(key, 'touch');
    await page.$eval('#start', element => element.scrollIntoView({ block: 'center' }));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '触屏标题溢出');
    await shot('touch-title-' + viewport.width);
    await tap('#start'); await phase('playing');
    await checkLoadoutStart(key);
    await tap('#pause'); await phase('pause');
    await shot('touch-loadout-' + key + '-' + viewport.width);
    await tap('#menu-home'); await phase('confirmRestart'); await tap('#start'); await phase('title');
    await checkSelection(key);
  }
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__raidReady === true);
  check((await read()).selectedLoadout === 'assault' && JSON.stringify((await read()).progress.survival) === JSON.stringify(record),
    '触屏装具选择被持久化或重载改变清场纪录');
}
