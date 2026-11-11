/** Published beacon commission: snapshots observe, genuine controls do all play. */
import path from 'node:path';
import { survivalTactics } from './raid-survival-tactics.mjs';
import { beaconTactics } from './raid-beacon-tactics.mjs';

export async function checkRaidBeacon(sourcePage, problems) {
  const context = await sourcePage.browser().createBrowserContext();
  const page = await context.newPage();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const read = () => page.evaluate(() => ({ ...window.__raidState }));
  const phase = value => page.waitForFunction(expected => window.__raidState?.phase === expected,
    { timeout: 5000 }, value);
  let checkpoint = '初始化', client = null, contacts = new Map();
  const keys = new Set();
  const check = (ok, message, details) => {
    if (!ok) problems.push('Pixel Raid 信标：' + message + (details ? ' ' + JSON.stringify(details) : ''));
    return ok;
  };
  const shot = name => page.screenshot({
    path: path.join(process.cwd(), '.shots', 'pixelraid-beacon-' + name + '.png'), fullPage: true,
  });
  const tap = async selector => {
    await page.$eval(selector, el => el.scrollIntoView({ block: 'center' }));
    await (await page.$(selector)).tap();
  };
  const key = async (name, pressed) => {
    if (keys.has(name) === pressed) return;
    await page.keyboard[pressed ? 'down' : 'up'](name);
    if (pressed) keys.add(name); else keys.delete(name);
  };
  const frames = (count = 3) => page.evaluate(n => new Promise(resolve => {
    const tick = () => --n > 0 ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick);
  }), count);
  const controller = (buttons = [], connected = true) => page.evaluate(value => {
    window.__raidBeaconController = value;
  }, { buttons, connected });
  const pressPad = async button => {
    await controller(); await frames(); await controller([button]); await frames();
    await controller(); await frames();
  };
  const focusPad = async selector => {
    // Exercise actual directional navigation, including its scrollIntoView.
    for (let n = 0; n < 70; n++) {
      if (await page.evaluate(s => document.activeElement?.matches(s), selector)) return;
      await pressPad(13);
    }
    throw new Error('手柄方向导航不能抵达 ' + selector);
  };
  const choosePad = async selector => { await focusPad(selector); await pressPad(0); };
  const release = async () => {
    for (const name of [...keys]) await key(name, false);
    if (contacts.size) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      contacts.clear();
    }
  };
  const touch = async (action, held) => {
    if (contacts.has(action) === held) return;
    if (!held) {
      contacts.delete(action);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...contacts.values()] });
      return;
    }
    const point = await page.$eval('[data-action="' + action + '"]', el => {
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!check(point.x >= 0 && point.x < 320 && point.y >= 0 && point.y < 844,
      '触控按键不在 320px 可触区域：' + action, point)) throw new Error('触控目标不可达');
    point.id = ['left', 'right', 'down', 'jump', 'fire'].indexOf(action) + 1;
    contacts.set(action, point);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...contacts.values()] });
  };
  const drive = async (input, state, mobile = false) => {
    if (mobile) {
      await touch('left', input.move === 'a'); await touch('right', input.move === 'd');
      await touch('down', input.down === true); await touch('fire', input.fire !== false);
      if (input.jump && state.ground) { await touch('jump', false); await touch('jump', true); }
      else if (!input.jump) await touch('jump', false);
    } else {
      await key('a', input.move === 'a'); await key('d', input.move === 'd');
      await key('s', input.down === true); await key('j', input.fire !== false);
      if (input.jump && state.ground) { await key('w', false); await key('w', true); }
      else if (!input.jump) await key('w', false);
      if (input.dash) await page.keyboard.press('l');
      if (input.grenade) await page.keyboard.press('k');
    }
  };
  const until = async (predicate, decide, { mobile = false, timeout = 15000 } = {}) => {
    const deadline = Date.now() + timeout;
    try {
      while (Date.now() < deadline) {
        const state = await read();
        if (predicate(state)) { await release(); return read(); }
        if (state.phase !== 'playing') throw new Error('到达目标前游戏进入 ' + state.phase);
        await drive(decide(state), state, mobile); await wait(mobile ? 45 : 70);
      }
      throw new Error('真实输入未在限定时间内到达目标');
    } finally { await release(); }
  };
  const fight = async wave => {
    const state = await until(s => s.phase !== 'playing', survivalTactics(), { timeout: 45000 });
    if (!check(state.phase === 'waveClear' && state.survivalCleared === wave && state.hp > 0 &&
      state.stageDeaths === 0 && state.lives === 1, '真实战斗未活着清场第 ' + wave + ' 波', state)) {
      throw new Error('真实战斗失败');
    }
    return state;
  };
  const invariant = state => ({
    phase: state.phase, x: state.x, y: state.y, hp: state.hp, score: state.score,
    grenades: state.grenades, shots: state.shots, survivalTime: state.survivalTime,
    spawnTime: state.spawnTime, fieldContract: state.fieldContract, selectedSupply: state.selectedSupply,
    supplyOffers: state.supplyOffers, upgrades: state.upgrades, tacticalCharge: state.tacticalCharge,
    tacticalTime: state.tacticalTime, progress: state.progress,
  });
  const begin = async mobile => {
    await release();
    await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
      deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' }); await page.bringToFront();
    await page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
    if (mobile) { await tap('#mode-survival'); await tap('#start'); }
    else {
      await page.focus('#mode-survival'); await page.keyboard.press('Space');
      await page.focus('#start'); await page.keyboard.press('Enter');
    }
    await phase('playing');
    const state = await read();
    check(state.survivalWave === 1 && state.fieldContract === null && state.selectedContract === 'hold',
      '新一局不是无委托首波和默认稳守', state);
    await fight(1);
  };
  const layout = async (selector, label, pad = false) => {
    const result = await page.$eval(selector, el => {
      const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        width: innerWidth, height: innerHeight, hit: hit === el || el.contains(hit),
        focused: document.activeElement === el, marked: el.classList.contains('gamepad-focus'),
        outline: getComputedStyle(el).outlineStyle, visible: el.checkVisibility(),
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
    check(result.visible && result.left >= -1 && result.right <= result.width + 1 && result.top >= -1 &&
      result.bottom <= result.height + 1 && result.hit && result.noOverflow &&
      (!pad || result.focused && result.marked && result.outline !== 'none'),
    label + '被裁切、遮挡、溢出或缺少手柄焦点', result);
  };
  const chooseContract = async mobile => {
    const before = await read();
    check(before.selectedContract === 'hold' && before.fieldContract === null &&
      await page.$eval('#contract-options', el => !el.open), '首轮委托不是折叠的默认稳守', before);
    if (mobile) {
      await tap('#contract-summary'); await tap('#contract-beacon');
      await layout('#contract-beacon', '320px 触屏信标选择');
    } else {
      await page.focus('#contract-summary'); await page.keyboard.press('Space');
      await page.focus('#contract-beacon'); await page.keyboard.press('Enter');
    }
    let state = await read();
    check(state.selectedContract === 'beacon' && equal(invariant(state), invariant(before)) &&
      await page.$eval('#start', el => el.disabled), '选择信标提前开局、奖励、改变资源或绕过补给选择', state);
    const choices = await page.$$eval('#contract-options button', els => els.map(el =>
      [el.id, el.getAttribute('aria-pressed')]));
    check(choices.length === 3 && choices.every(([id, pressed]) => pressed === String(id === 'contract-beacon')),
      '三项委托的互斥按下状态错误', choices);
    check((await page.$eval('#contract-selection', el => el.textContent)).includes('5 秒'), '信标说明缺少累计目标');
    if (mobile) {
      await controller(); await frames(); await choosePad('#contract-hold');
      check((await read()).selectedContract === 'hold', '手柄 A 未切换稳守');
      await choosePad('#contract-beacon'); await layout('#contract-beacon', '320px 手柄信标选择', true);
      // A is edge-triggered. A held over a choice must neither start the wave
      // nor repeatedly activate neighboring controls while it is scrolled.
      await controller(); await frames(); await controller([0]); await wait(450);
      check((await read()).phase === 'waveClear' && (await read()).selectedContract === 'beacon',
        '长按手柄 A 意外开始下一波');
      await controller(); await frames(); await controller([], false); await frames();
    } else {
      await page.keyboard.press('Space');
      check((await read()).selectedContract === 'beacon' && equal(invariant(await read()), invariant(before)),
        '原生空格重复选择信标产生副作用');
    }
    await shot(mobile ? 'choice-touch-controller-320' : 'choice-keyboard-1280');
    state = await read();
    const armor = state.supplyOffers.indexOf('armor');
    const index = armor >= 0 ? armor : Math.max(0, state.supplyOffers.indexOf('heal'));
    if (mobile) await tap('#supply-' + index);
    else { await page.focus('#supply-' + index); await page.keyboard.press('Space'); }
    check((await read()).selectedSupply === state.supplyOffers[index] &&
      !await page.$eval('#start', el => el.disabled), '选择真实补给后没有允许继续');
    if (mobile) await tap('#start');
    else { await page.focus('#start'); await page.keyboard.press('Enter'); }
    await phase('playing');
    state = await read();
    check(state.survivalWave === 2 && state.spawnTime > 0 && state.selectedContract === 'hold' &&
      state.fieldContract?.status === 'active' && state.fieldContract.nodes.length === 0 &&
      equal(state.fieldContract.beacon, { x: 222.5, y: 325, radius: 48, progress: 0, occupied: false }),
    '信标不是第二波独立高台上的零进度对象，或选择未复位', state);
    check(state.platforms.some(([x, y, width]) => y === state.fieldContract.beacon.y &&
      x + width / 2 === state.fieldContract.beacon.x), '信标未锚定实际平台');
    await wait(180);
    check((await read()).fieldContract.beacon.progress === 0, '增援期间提前累计夺控进度');
  };
  const pixels = async label => {
    // Inspect the actual canvas, not a DOM proxy or screenshot file existence.
    // Read-only canvas capture leaves the game clock and random source intact.
    await frames();
    const sample = await page.evaluate(() => {
      const s = window.__raidState, b = s.fieldContract.beacon, canvas = document.querySelector('#field');
      const ctx = canvas.getContext('2d'), x = Math.round(b.x), y = Math.round(b.y);
      const data = ctx.getImageData(x - 12, y - 66, 25, 18).data;
      let cyan = 0, yellow = 0, green = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], z = data[i + 2];
        if (r >= 140 && r <= 175 && g >= 215 && z >= 240) cyan++;
        if (r >= 240 && g >= 215 && z >= 140 && z <= 180) yellow++;
        if (r >= 155 && r <= 185 && g >= 230 && z >= 180 && z <= 210) green++;
      }
      return { cyan, yellow, green, occupied: b.occupied, progress: b.progress, spawn: s.spawnTime };
    });
    check(sample.spawn === 0 && (sample.progress >= 5 ? sample.green > 30 :
      sample.occupied ? sample.yellow > 30 : sample.cyan > 30), '画布信标灯未绘制正确状态：' + label, sample);
    await shot(label);
  };
  const freezeAndCancel = async () => {
    await page.keyboard.press('p'); await phase('pause');
    const paused = invariant(await read()); await wait(220);
    check(equal(invariant(await read()), paused), '暂停仍推进信标、战斗或资源');
    for (const selector of ['#restart', '#menu-home']) {
      await page.click(selector); await phase('confirmRestart');
      const confirming = invariant(await read()); await wait(180);
      check(equal(invariant(await read()), confirming), '确认期间仍推进夺控：' + selector);
      await page.click('#cancel-restart'); await phase('pause');
      check(equal(invariant(await read()), paused), '取消确认改变累计进度或当前战斗：' + selector);
    }
    await shot('partial-paused-canceled'); await page.click('#start'); await phase('playing');
  };
  const observeSettlement = () => page.evaluate(() => {
    // Observation only: no private evaluator, clock override, seeded RNG,
    // replacement combatants, position/health writes or storage writes.
    window.__raidBeaconSettlement = [];
    const observe = () => {
      const s = window.__raidState;
      window.__raidBeaconSettlement.push({ phase: s.phase, hp: s.hp, maxHp: s.maxHp, score: s.score,
        charge: s.tacticalCharge, tacticalTime: s.tacticalTime, combo: s.combo,
        grenades: s.grenades, enemies: s.enemies.map(e => ({ type: e.type, hp: e.hp })),
        pickups: s.pickups.map(p => ({ kind: p.kind, done: p.done })) });
      if (window.__raidBeaconSettlement.length > 180) window.__raidBeaconSettlement.shift();
      if (s.phase === 'playing') requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  const settlement = async (success, state) => {
    const samples = await page.evaluate(() => window.__raidBeaconSettlement);
    const at = samples.findIndex(s => s.phase === 'waveClear'), last = samples[at - 1], clear = samples[at];
    if (check(at > 0 && last.enemies.length > 0, '未观察到最后一次真实击杀和清场结算', samples.slice(-3))) {
      const killed = last.enemies.length;
      const killScore = Array.from({ length: killed }, (_, i) => {
        const combo = clear.combo - killed + i + 1; return 100 * (combo >= 4 ? 3 : combo >= 2 ? 2 : 1);
      }).reduce((a, b) => a + b, 0);
      const picked = clear.pickups.filter((p, i) => p.done && !last.pickups[i].done);
      check(clear.score - last.score === killScore + picked.length * 75 + 300 + (success ? 300 : 0),
        '信标奖励或正常第 2 波清场 +300 分重复、遗漏或被替换', { last, clear, killScore, success });
      check(clear.hp === Math.min(clear.maxHp, last.hp + 1 + Number(success) +
        (picked.some(p => p.kind === 'heal') ? 2 : 0)), '信标额外体力或正常清场恢复不正确', { last, clear, success });
      const chargeFromKills = last.tacticalTime > 0 ? 0 : last.enemies.reduce((n, e) => n + e.hp * 3 + 12, 0);
      check(clear.charge === Math.min(100, last.charge + chargeFromKills + (success ? 35 : 0)),
        '信标额外技能能量不正确或超过上限', { last, clear, success });
      check(clear.grenades === Math.min(7, last.grenades + 1), '信标改变了正常清场手雷奖励', { last, clear });
    }
    check(state.fieldContract.status === (success ? 'success' : 'missed') &&
      state.selectedContract === 'hold' && !state.fieldContract.beacon.occupied &&
      state.progress.survival.wave === 2 && state.progress.survival.best >= state.score,
    '清场结算状态、默认选择或保存纪录不一致', state);
    const text = await page.$eval('#result-details', el => el.textContent);
    check(text.includes(success ? '信标夺控完成' : '信标夺控未完成') &&
      (success ? text.includes('+300') && text.includes('+35') : text.includes('无额外奖励')),
    '清场文案未明确表示成功或失败的实际奖励', text);
    const settled = invariant(state), stored = await page.evaluate(() => localStorage.getItem('pixel-raid.progress.v1'));
    await wait(250);
    for (const selector of ['#restart', '#menu-home']) {
      await page.click(selector); await phase('confirmRestart');
      await page.click('#cancel-restart'); await phase('waveClear');
      check(equal(invariant(await read()), settled), '重复打开并取消清场确认重复兑现奖励：' + selector);
    }
    check(await page.evaluate(() => localStorage.getItem('pixel-raid.progress.v1')) === stored,
      '清场等待或取消确认重复更改存档');
    await shot(success ? 'success-reward-once' : 'missed-normal-reward');
    return stored;
  };

  page.on('pageerror', error => check(false, '页面异常：' + error.message, { checkpoint }));
  try {
    await page.evaluateOnNewDocument(() => {
      // Only the browser input provider is substituted, never the game itself.
      window.__raidBeaconController = { connected: false, buttons: [] };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
        const input = window.__raidBeaconController;
        return input.connected ? [{ connected: true, id: 'Beacon browser controller', index: 0,
          mapping: 'standard', timestamp: performance.now(), axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: input.buttons.includes(i),
            touched: input.buttons.includes(i), value: Number(input.buttons.includes(i)) })) }] : [];
      } });
    });
    checkpoint = '桌面真实首波和键盘接取'; await begin(false); await chooseContract(false);
    checkpoint = '真实跳跃上台并部分夺控';
    let state = await until(s => s.fieldContract.beacon.progress >= 1, beaconTactics());
    check(state.ground && state.y + state.playerHeight === 325 && state.fieldContract.beacon.occupied &&
      state.hp > 0 && state.enemies.length > 0 && state.fieldContract.beacon.progress < 5,
    '未站在真实信标高台且有敌人时累计部分进度', state);
    await pixels('partial-occupied-1280');
    const target = state.fieldContract.beacon.x + state.fieldContract.beacon.radius + 16;
    checkpoint = '离开夺控区保留进度';
    state = await until(s => s.x + 13.5 >= target && !s.fieldContract.beacon.occupied,
      () => ({ move: 'd', fire: false }));
    const left = state.fieldContract.beacon.progress;
    await wait(280); state = await read();
    check(state.fieldContract.beacon.progress === left && !state.fieldContract.beacon.occupied &&
      state.fieldContract.status === 'active', '离开高台信号范围仍累计、清零或失败', state);
    await pixels('partial-outside-1280'); await freezeAndCancel();
    checkpoint = '返回高台累计到五秒';
    state = await until(s => s.fieldContract.beacon.progress >= 5, beaconTactics());
    check(state.hp > 0 && state.phase === 'playing' && state.enemies.length > 0 &&
      state.fieldContract.status === 'active', '夺控完成提前清场或未活着等待结算', state);
    const beforeReward = { score: state.score, charge: state.tacticalCharge, progress: state.progress };
    await wait(180); state = await read();
    check(state.fieldContract.beacon.progress === 5 && state.score === beforeReward.score &&
      state.tacticalCharge === beforeReward.charge && equal(state.progress, beforeReward.progress),
    '满五秒后继续累计或在清场前提前发奖', state);
    await pixels('captured-before-clear-1280');
    checkpoint = '真实清场、奖励一次和保存';
    await observeSettlement(); state = await fight(2); await frames();
    const saved = await settlement(true, state);
    await page.click('#supply-0'); await page.click('#start'); await phase('playing');
    check((await read()).survivalWave === 3 && (await read()).fieldContract === null &&
      (await read()).selectedContract === 'hold', '下一波首领错误继承信标委托');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__raidReady === true);
    check(await page.evaluate(() => localStorage.getItem('pixel-raid.progress.v1')) === saved &&
      (await read()).progress.survival.wave === 2 && (await read()).selectedContract === 'hold' &&
      (await read()).fieldContract === null, '刷新未保留已清场纪录或错误续接信标');

    checkpoint = '320px 触屏与手柄委托选择';
    await begin(true); await chooseContract(true);
    client = await page.createCDPSession();
    await page.$eval('.controls', el => el.scrollIntoView({ block: 'end' }));
    checkpoint = '320px 真实触屏登台';
    state = await until(s => s.fieldContract.beacon.progress >= .6, beaconTactics(), { mobile: true });
    check(state.touchCount === 0 && state.fieldContract.beacon.progress < 5 && state.ground &&
      state.y + state.playerHeight === 325, '触屏移动和跳跃未抵达信标或释放触点', state);
    await pixels('partial-touch-320');
    checkpoint = '触屏降层不继续夺控';
    await touch('down', true); await touch('jump', true);
    await page.waitForFunction(() => window.__raidState.dropTime > 0, { timeout: 1500, polling: 'raf' });
    await release();
    await page.waitForFunction(() => {
      const s = window.__raidState; return s.ground && s.y + s.playerHeight === 425;
    }, { timeout: 2500, polling: 'raf' });
    const below = await read(); await wait(240); state = await read();
    check(state.fieldContract.beacon.progress === below.fieldContract.beacon.progress &&
      !state.fieldContract.beacon.occupied && state.touchCount === 0,
    '信标下方实地误判为占领、持续累计或触控残留', state);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '320px 游戏画面横向溢出');
    await shot('below-beacon-touch-320');
    checkpoint = '未完成委托仍能正常清场';
    await observeSettlement(); state = await fight(2); await frames(); await settlement(false, state);
  } catch (error) {
    check(false, checkpoint + '：' + error.message, await read().catch(() => null));
    await shot('failure').catch(() => {});
  } finally {
    await release().catch(() => {});
    if (client) await client.detach().catch(() => {});
    await context.close();
  }
}
