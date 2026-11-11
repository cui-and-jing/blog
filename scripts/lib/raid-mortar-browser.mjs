/** Mortar counterplay, earned through real combat and unmodified game clocks. */
import fs from 'node:fs';
import path from 'node:path';
import { survivalTactics } from './raid-survival-tactics.mjs';

export async function checkRaidMortar(sourcePage, problems) {
  const context = await sourcePage.browser().createBrowserContext();
  const page = await context.newPage();
  const keys = new Set(), contacts = new Map();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const read = () => page.evaluate(() => window.__raidState);
  const mortar = state => state.enemies.find(enemy => enemy.type === 'mortar');
  const check = (ok, message, details) => {
    if (!ok) problems.push('Pixel Raid 投弹兵：' + message + (details ? ' ' + JSON.stringify(details) : ''));
    return ok;
  };
  const require = (ok, message, details) => {
    if (!check(ok, message, details)) throw new Error(message);
  };
  const phase = expected => page.waitForFunction(value => window.__raidState?.phase === value,
    { timeout: 5000 }, expected);
  // Keep the state seen on the successful frame, not a later CDP round trip.
  const observe = async (predicate, ...args) => {
    const handle = await page.waitForFunction(predicate, { timeout: 7000, polling: 'raf' }, ...args);
    try { return await handle.jsonValue(); } finally { await handle.dispose(); }
  };
  const shot = async name => {
    const prefix = path.join(process.cwd(), '.shots', 'pixelraid-mortar-');
    await page.screenshot({ path: prefix + name + '.png', fullPage: true });
    // The native pause overlay deliberately dims the field. Preserve the
    // actual rendered canvas too, so visual review can inspect the warning,
    // projectile and impact geometry without modifying DOM or game state.
    const png = await page.$eval('#field', canvas => canvas.toDataURL('image/png').split(',')[1]);
    fs.writeFileSync(prefix + 'field-' + name + '.png', Buffer.from(png, 'base64'));
  };
  const key = async (name, held) => {
    if (keys.has(name) === held) return;
    await page.keyboard[held ? 'down' : 'up'](name);
    if (held) keys.add(name); else keys.delete(name);
  };
  const touch = async (action, held) => {
    if (contacts.has(action) === held) return;
    const from = await page.evaluate(() => window.__raidMortarTouches.length);
    let previous;
    if (!held) {
      previous = contacts.get(action);
      // End this exact native finger, never reconstruct a CDP touch list from
      // coordinates which might now belong to a different wrapped HUD button.
      await previous.handle.end(); contacts.delete(action);
    } else {
      const point = await page.$eval('[data-action="' + action + '"]', el => {
        el.closest('.controls').scrollIntoView({ block: 'end' });
        const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { x, y, hit: hit === el || el.contains(hit), w: r.width, h: r.height,
          width: innerWidth, height: innerHeight };
      });
      require(point.hit && point.w >= 42 && point.h >= 44 && point.x >= 0 && point.x < point.width &&
        point.y >= 0 && point.y < point.height, '320px 触控目标不可达：' + action, point);
      const handle = await page.touchscreen.touchStart(point.x, point.y);
      contacts.set(action, { handle, pointerId: null });
    }
    const audit = await page.evaluate(index => ({ events: window.__raidMortarTouches.slice(index),
      active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action).sort(),
      count: window.__raidState.touchCount, phase: window.__raidState.phase }), from);
    const event = audit.events[0], expected = [...contacts.keys()].sort();
    require(audit.events.length === 1 && event.action === action && event.trusted &&
      event.type === (held ? 'pointerdown' : 'pointerup') && (held || event.pointerId === previous.pointerId) &&
      (audit.phase !== 'playing' || equal(audit.active, expected) && audit.count === expected.length),
    '真实触点命中、独立释放或活动集合错误', { action, held, expected, audit });
    if (held) contacts.get(action).pointerId = event.pointerId;
  };
  const release = async () => {
    for (const name of [...keys]) await key(name, false);
    for (const action of [...contacts.keys()].sort((a, b) => Number(b === 'jump') - Number(a === 'jump'))) {
      await touch(action, false);
    }
  };
  const drive = async (input, state) => {
    await key('a', input.move === 'a'); await key('d', input.move === 'd');
    await key('s', input.down === true); await key('j', input.fire !== false);
    if (input.jump && state.ground) { await key('w', false); await key('w', true); }
    else if (!input.jump) await key('w', false);
    if (input.dash) await page.keyboard.press('l');
    if (input.grenade) await page.keyboard.press('k');
  };
  const until = async (predicate, decide, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    try {
      while (Date.now() < deadline) {
        const state = await read();
        if (predicate(state)) return state;
        if (state.phase !== 'playing') throw new Error('真实输入途中进入 ' + state.phase);
        await drive(decide(state), state); await wait(65);
      }
      throw new Error('真实输入未在限定时间内到达目标');
    } finally { await release(); }
  };
  const unchangedResources = (before, after) => ['hp', 'shots', 'grenades', 'tacticalUses', 'stageDeaths', 'score']
    .every(name => before[name] === after[name]);
  const moveTo = async x => {
    const state = await read(), right = state.x < x;
    await key(right ? 'd' : 'a', true);
    await observe((target, right) => { const s = window.__raidState;
      return (right ? s.x >= target : s.x <= target) ? s : false;
    }, x, right);
    await release(); return read();
  };
  const getWarning = async () => observe(() => {
    const s = window.__raidState, e = s.enemies.find(enemy => enemy.type === 'mortar');
    return e?.windup > .85 && s.ground && Math.abs(e.aimX - Math.max(58, Math.min(902, s.x + 13.5))) < .01 ? s : false;
  });
  const freeze = async () => { await page.keyboard.press('p'); await phase('pause'); return read(); };
  const resume = async () => { await page.keyboard.press('p'); await phase('playing'); };
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
  const detached = async () => {
    const result = await page.evaluate(() => {
      const d = Object.getOwnPropertyDescriptor(window, '__raidState'), a = window.__raidState, b = window.__raidState;
      return { getter: typeof d.get === 'function', setter: Boolean(d.set), configurable: d.configurable,
        detached: a !== b && a.enemies !== b.enemies && a.enemies.every((e, i) => e !== b.enemies[i]) &&
          a.shells !== b.shells && a.shells.every((s, i) => s !== b.shells[i] && s.zone !== b.shells[i].zone) &&
          a.mortarBursts !== b.mortarBursts && a.mortarBursts.every((s, i) => s !== b.mortarBursts[i]),
        equal: JSON.stringify(a) === JSON.stringify(b) };
    });
    check(result.getter && !result.setter && !result.configurable && result.detached && result.equal,
      '调试快照并非只读入口与独立嵌套对象', result);
  };
  const pixels = async warning => {
    await frame();
    const e = mortar(warning);
    const result = await page.$eval('#field', (canvas, target) => {
      const { aimX, aimY } = target, x = Math.ceil(aimX - 58), width = 116;
      const count = (y, height) => {
        const data = canvas.getContext('2d').getImageData(x, y, width, height).data;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] === 239 && data[i + 1] === 204 && data[i + 2] === 255) n++;
        return n;
      };
      return { floor: count(aimY - 3, 3), top: count(aimY - 65, 3) };
    }, e);
    check(result.floor >= 55 && result.top >= 25, '实际画布缺少对应伤害矩形的紫色底线和上边框', { result, target: e });
  };
  let checkpoint = '初始化';
  try {
    await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(() => {
      window.__raidMortarTouches = [];
      for (const type of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(type, event => {
        const target = event.target.closest?.('[data-action]');
        if (target) window.__raidMortarTouches.push({ type, action: target.dataset.action,
          pointerId: event.pointerId, trusted: event.isTrusted });
      }, true);
    });
    await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' }); await page.bringToFront();
    await page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
    await page.focus('#mode-survival'); await page.keyboard.press('Enter');
    await page.focus('#loadout-demolition'); await page.keyboard.press('Enter');
    await page.focus('#start'); await page.keyboard.press('Enter'); await phase('playing');
    for (let wave = 1; wave <= 4; wave++) {
      checkpoint = '真实清场第 ' + wave + ' 波';
      const state = await until(s => s.phase !== 'playing', survivalTactics());
      require(state.phase === 'waveClear' && state.survivalCleared === wave && state.hp > 0 &&
        state.stageDeaths === 0 && state.lives === 1, '真实战斗未活着清场第 ' + wave + ' 波', state);
      const preferred = ['armor', 'heal', 'rapid', 'pierce'];
      const index = preferred.map(name => state.supplyOffers.indexOf(name)).find(index => index >= 0) ?? 0;
      await page.focus('#supply-' + index); await page.keyboard.press('Space');
      await page.focus('#start'); await page.keyboard.press('Enter'); await phase('playing');
    }
    let state = await read();
    require(state.survivalWave === 5 && state.survivalCleared === 4 && state.spawnTime > 0 &&
      state.enemies.length === 5 && state.enemies.filter(e => e.type === 'mortar').length === 1 &&
      !state.enemies.some(e => e.type === 'turret') && mortar(state).hp === 5,
    '第五波未用一名投弹兵替换炮台，或增加了总敌人数', state);
    check((await page.$eval('#announcer', el => el.textContent)).includes('紫色投弹兵'), '第五波缺少投弹兵反制说明');

    checkpoint = '真实击败其他四名敌人';
    // The earned demolition skill removes the close shield and walker while
    // the rightmost mortar is well outside its 220px radius. Do this with the
    // actual E control, not a damage hook or edited enemies/HP.
    await key('a', true); await frame(); await release();
    state = await observe(() => { const s = window.__raidState; return s.spawnTime === 0 ? s : false; });
    require(state.tacticalCharge === 100 && state.x < 490 && state.x > 430 &&
      Math.abs(mortar(state).x + 15 - state.x - 13.5) > 260,
    '真实震荡脉冲的能量或安全位置错误', state);
    await page.keyboard.press('e');
    await observe(() => { const s = window.__raidState; return s.tacticalUses === 1 ? s : false; });
    const decide = survivalTactics(); let isolationFacing = -1;
    state = await until(s => s.enemies.length === 1 && mortar(s), s => {
      // Filtering a detached observation only changes our choice of controls.
      // Never shoot right through a killed target into the mortar. Reflected
      // bullets are excluded too: use jumps, not dash reflection, for this fight.
      const input = decide({ ...s, enemies: s.enemies.filter(e => e.type !== 'mortar') });
      if (input.move && s.dashTime === 0) isolationFacing = input.move === 'a' ? -1 : 1;
      return { ...input, fire: isolationFacing < 0, grenade: input.grenade && isolationFacing < 0, dash: false };
    });
    require(mortar(state)?.hp === 5 && state.hp > 0 && state.stageDeaths === 0 && state.tacticalUses === 1,
      '未用真实战斗留下满血投弹兵', state);

    checkpoint = '地面预警、暂停和取消';
    // Open floor between the left and centre platforms, far from the mortar.
    await moveTo(465);
    await observe(() => { const s = window.__raidState; return s.ground && s.y + s.playerHeight === 425 ? s : false; });
    // Drain earlier hostile bullets. No health assertions rely on unrelated
    // enemies, a pickup, invulnerability, a dash or a tactical shield.
    await observe(() => { const s = window.__raidState; return s.hostiles.length === 0 ? s : false; });
    let warning = await getWarning(), locked = mortar(warning);
    require(warning.ground && locked.aimY === 425 && Math.abs(locked.aimX - warning.x - 13.5) < .01 &&
      locked.windup > .85 && locked.windup <= .9 && warning.shells.length === 0,
    '地面预警未锁定真实脚下位置或不是 0.9 秒蓄力', warning);
    const paused = await freeze(); await wait(1000);
    check(equal(await read(), paused), '暂停推进投弹预警或战场');
    for (const selector of ['#restart', '#menu-home']) {
      await page.click(selector); await phase('confirmRestart');
      const confirm = await read(); await wait(180);
      check(equal(await read(), confirm), '重开或回首页确认没有冻结投弹状态：' + selector);
      await page.click('#cancel-restart'); await phase('pause');
      check(equal(await read(), paused), '取消确认改变投弹预警或战场：' + selector);
    }
    await detached(); await pixels(paused); await shot('warning-paused-keyboard-1280');
    await resume();
    checkpoint = '键盘离开地面落点';
    await key('a', true);
    const escaped = await observe(aimX => { const s = window.__raidState;
      return s.x + 27 < aimX - 58 - 12 ? s : false;
    }, locked.aimX);
    await release();
    check(escaped.ground && escaped.y + escaped.playerHeight === 425 && mortar(escaped).windup > 0 &&
      mortar(escaped).aimX === locked.aimX && mortar(escaped).aimY === locked.aimY,
    '真实键盘移动未在蓄力期离开同层紫框，或落点追踪了玩家', escaped);
    const launched = await observe(() => { const s = window.__raidState; return s.shells.length ? s : false; });
    const shell = launched.shells[0];
    check(Math.abs(launched.survivalTime - warning.survivalTime - .9) < .055 &&
      shell.elapsed <= 1 / 30 && shell.aimX === locked.aimX && shell.aimY === locked.aimY &&
      shell.startX === mortar(launched).x + mortar(launched).w / 2 && shell.startY === mortar(launched).y + 6 &&
      equal(shell.zone, { x: locked.aimX - 58, y: locked.aimY - 64, w: 116, h: 64 }),
    '出手时机、固定落点、抛物线起点或实际伤害矩形错误', { warning, launched });
    const flying = await observe(() => { const s = window.__raidState;
      return s.shells[0]?.elapsed >= .35 ? s : false;
    });
    const arc = flying.shells[0], t = arc.elapsed / .85;
    check(arc.elapsed < .85 && arc.aimX === locked.aimX && arc.aimY === locked.aimY &&
      Math.abs(arc.x - (arc.startX + (arc.aimX - arc.startX) * t)) < .001 &&
      Math.abs(arc.y - (arc.startY + (arc.aimY - 8 - arc.startY) * t - 480 * t * (1 - t))) < .001 &&
      unchangedResources(warning, flying), '抛物线、飞行落点或飞行阶段生命和资源异常', { warning, flying });
    const flightPause = await freeze(); await wait(950); await detached();
    check(equal(await read(), flightPause), '暂停未冻结已出手投弹或提前引爆');
    await shot('shell-flight-paused-1280'); await resume();
    const impact = await observe(() => { const s = window.__raidState; return s.mortarBursts.length ? s : false; });
    check(impact.shells.length === 0 && Math.abs(impact.survivalTime - launched.survivalTime - .85) < .055 &&
      impact.mortarBursts[0].x === locked.aimX - 58 && impact.mortarBursts[0].y === locked.aimY - 64 &&
      impact.mortarBursts[0].w === 116 && impact.mortarBursts[0].h === 64 &&
      unchangedResources(warning, impact), '0.85 秒飞行后爆炸未对应矩形，或键盘逃出后仍受伤', { warning, impact });
    await freeze(); await detached(); await shot('keyboard-floor-escape-1280'); await resume();

    checkpoint = '真实登台与空中禁止索敌';
    await moveTo(270);
    await page.keyboard.press('w');
    await observe(() => { const s = window.__raidState; return s.ground && s.y + s.playerHeight === 325 ? s : false; });
    // Wait out the current shot, then jump just before the next acquisition is
    // due. Its cooldown runs out in mid-air but must not lock an airborne point.
    await observe(() => { const s = window.__raidState, e = s.enemies.find(e => e.type === 'mortar');
      return e && e.windup === 0 && e.shot > .1 && e.shot < .3 && s.ground ? s : false;
    });
    await page.keyboard.press('w');
    const noAirLock = await observe(() => { const s = window.__raidState, e = s.enemies.find(e => e.type === 'mortar');
      return !s.ground && e?.shot <= -.1 ? s : false;
    });
    check(mortar(noAirLock).windup === 0 && noAirLock.shells.length === 0,
      '投弹兵在玩家腾空时锁定空中落点', noAirLock);
    warning = await getWarning(); locked = mortar(warning);
    require(warning.ground && warning.y + warning.playerHeight === 325 && locked.aimY === 325,
      '落地后预警未锁定高台实际支撑线', warning);
    state = await freeze();
    await page.setViewport({ ...page.viewport(), width: 320, height: 844 });
    require(equal(await read(), state), '320px 视口变更重载、推进或重置已赚取第五波');
    await pixels(state); await shot('platform-warning-paused-touch-320');
    await resume();

    checkpoint = '320px 多指真实降层避让';
    await touch('down', true); await touch('jump', true);
    const dropping = await observe(() => { const s = window.__raidState; return s.dropTime > 0 && !s.ground ? s : false; });
    await touch('jump', false);
    const oneFinger = await read();
    check(dropping.touchCount === 2 && oneFinger.touchCount === 1 && contacts.has('down') && !contacts.has('jump'),
      '降层未使用两个真实触点，或释放跳跃误清掉仍按住的下蹲触点', { dropping, oneFinger });
    await touch('down', false);
    const below = await observe(() => { const s = window.__raidState;
      return s.ground && s.y + s.playerHeight === 425 ? s : false;
    });
    check(below.x + 27 > locked.aimX - 58 && below.x < locked.aimX + 58 && below.y >= locked.aimY &&
      below.touchCount === 0 && below.dashTime === 0 && below.tacticalTime === 0,
    '触屏降层未在同一横向落点正下方着地，或借用了其他免伤动作', below);
    const upperImpact = await observe(() => { const s = window.__raidState;
      return s.mortarBursts.some(b => b.y === 261) ? s : false;
    });
    check(upperImpact.y >= locked.aimY && upperImpact.x + 27 > locked.aimX - 58 && upperImpact.x < locked.aimX + 58 &&
      unchangedResources(warning, upperImpact) && upperImpact.mortarBursts[0].y + upperImpact.mortarBursts[0].h === 325,
    '高台爆炸伤到了同一落点下方地面，或触屏避让消耗了额外资源', { warning, upperImpact });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '320px 投弹预警页面横向溢出');
    await freeze(); await shot('touch-below-platform-escape-320');

    checkpoint = '真实身体穿过无伤抛物线';
    await page.setViewport({ ...page.viewport(), width: 1280, height: 960 });
    await resume();
    // From beneath the left ledge, jump right only after the mortar throws.
    // The player and visible shell then genuinely cross in mid-air. The player
    // remains outside the locked floor blast; no dash/shield masks arc damage.
    warning = await getWarning(); locked = mortar(warning);
    require(warning.ground && locked.aimY === 425 && warning.x >= 255 && warning.x <= 290,
      '无伤抛物线检查没有从左台下方真实地面开始', warning);
    await observe(() => { const s = window.__raidState; return s.shells.length ? s : false; });
    await key('d', true); await key('w', true);
    const crossing = await observe(() => {
      const s = window.__raidState;
      return s.shells.some(shot => shot.x >= s.x && shot.x <= s.x + 27 &&
        shot.y >= s.y && shot.y <= s.y + s.playerHeight) ? s : false;
    });
    await release();
    check(!crossing.ground && crossing.shells[0].elapsed > 0 && crossing.shells[0].elapsed < .85 &&
      crossing.dashTime === 0 && crossing.tacticalTime === 0 && unchangedResources(warning, crossing),
    '真实身体穿过投弹抛物线时受伤，或用了冲刺/护盾免伤', { warning, crossing });
    await freeze(); await shot('harmless-arc-body-crossing-1280'); await resume();
    const finalImpact = await observe(() => { const s = window.__raidState;
      return s.mortarBursts.some(burst => burst.y === 361) ? s : false;
    });
    check(finalImpact.x > locked.aimX + 58 && unchangedResources(warning, finalImpact),
      '穿过无伤抛物线后未真正离开落点，或爆炸误伤框外玩家', { warning, finalImpact });
  } catch (error) {
    check(false, checkpoint + '：' + error.message, await read().catch(() => null));
    await shot('failure').catch(() => {});
  } finally {
    await release().catch(error => check(false, '结束时未能释放真实输入：' + error.message));
    await context.close();
  }
}
