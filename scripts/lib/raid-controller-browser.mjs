/** Published controller flows. Only the browser's input provider is substituted. */
import path from 'node:path';
import { survivalTactics } from './raid-survival-tactics.mjs';

export async function checkRaidController(sourcePage, problems) {
  // A separate, disposable profile gives locked-stage tests a genuine new save.
  // Do not clear storage, seed progress, or alter the game's read-only snapshot.
  const context = await sourcePage.browser().createBrowserContext();
  const page = await context.newPage();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let checkpoint = '初始化';
  const check = (ok, message, details) => {
    if (!ok) problems.push('Pixel Raid 手柄：' + message + (details ? ' ' + JSON.stringify(details) : ''));
    return ok;
  };
  const read = () => page.evaluate(() => ({ ...window.__raidState }));
  const phase = value => page.waitForFunction(expected => window.__raidState?.phase === expected,
    { timeout: 5000 }, value);
  const shot = name => page.screenshot({
    path: path.join(process.cwd(), '.shots', 'pixelraid-controller-' + name + '.png'), fullPage: true,
  });
  const frames = (count = 3) => page.evaluate(n => new Promise(resolve => {
    const tick = () => --n > 0 ? requestAnimationFrame(tick) : resolve();
    requestAnimationFrame(tick);
  }), count);
  const input = (buttons = [], axes = [0, 0], connected = true, id = 'Raid browser controller') =>
    page.evaluate(value => { window.__raidControllerInput = value; }, { buttons, axes, connected, id });
  const neutral = async () => { await input(); await frames(); };
  const press = async (button, axes = [0, 0]) => {
    await neutral(); await input(button === null ? [] : [button], axes); await frames();
    await neutral();
  };
  const focusKey = () => page.evaluate(() => {
    const n = document.activeElement;
    return n?.id || (n?.tagName === 'SUMMARY' ? n.closest('details')?.id + ' summary' : n?.tagName);
  });
  const focusTo = async selector => {
    // Walking production navigation is intentional. page.focus() would hide
    // broken candidate filtering, focus recovery and narrow-screen scrolling.
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(s => document.activeElement?.matches(s), selector)) return;
      await press(13);
    }
    throw new Error('手柄方向导航无法抵达 ' + selector + '，当前焦点 ' + await focusKey());
  };
  const choose = async selector => { await focusTo(selector); await press(0); };
  const visibleFocus = async label => {
    const result = await page.evaluate(() => {
      const n = document.activeElement, r = n.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      return {
        id: n.id || n.closest('details')?.id, visible: n.checkVisibility(),
        marked: n.classList.contains('gamepad-focus'), disabled: Boolean(n.disabled),
        top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        width: innerWidth, height: innerHeight, hit: hit === n || n.contains(hit),
        outline: getComputedStyle(n).outlineStyle,
      };
    });
    check(result.visible && result.marked && !result.disabled && result.outline !== 'none' &&
      result.top >= -1 && result.bottom <= result.height + 1 && result.left >= -1 &&
      result.right <= result.width + 1 && result.hit, '焦点不清晰、被遮挡或未滚入屏幕：' + label, result);
  };
  const hold = async (button, expectedPhase, ms = 430, onOpen = null) => {
    await neutral(); await input([button]); await frames(); await phase(expectedPhase);
    if (onOpen) await onOpen();
    await wait(ms); await frames();
    check((await read()).phase === expectedPhase, '长按按键重复触发：' + button, { checkpoint, state: await read() });
    await neutral();
  };
  const frozen = state => ({
    phase: state.phase, x: state.x, y: state.y, hp: state.hp, grenades: state.grenades,
    score: state.score, clock: state.clock, shots: state.shots, tacticalUses: state.tacticalUses,
    survivalTime: state.survivalTime, challengeTime: state.challengeTime,
    survivalWave: state.survivalWave, supplyOffers: state.supplyOffers,
    selectedSupply: state.selectedSupply, supplyRerolls: state.supplyRerolls,
    selectedContract: state.selectedContract, upgrades: state.upgrades,
  });
  const returnHome = async () => {
    if ((await read()).phase === 'playing') { await press(9); await phase('pause'); }
    await choose('#menu-home'); await phase('confirmRestart');
    await focusTo('#start'); await hold(0, 'title');
  };
  const newTitle = async viewport => {
    await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
    await frames();
  };

  page.on('pageerror', error => check(false, '页面异常：' + error.message, { checkpoint, stack: error.stack }));
  try {
    await page.evaluateOnNewDocument(() => {
      window.__raidControllerInput = { connected: false, buttons: [], axes: [0, 0], id: 'Raid browser controller' };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
        const value = window.__raidControllerInput;
        return value.connected ? [{
          connected: true, id: value.id, index: 0, mapping: 'standard', timestamp: performance.now(),
          axes: [...value.axes, 0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({
            pressed: value.buttons.includes(index), touched: value.buttons.includes(index),
            value: Number(value.buttons.includes(index)),
          })),
        }] : [];
      } });
    });
    await newTitle({ width: 1280, height: 900 });
    check(await page.$eval('#controller-hint', n => n.hidden) &&
      await page.$$eval('.gamepad-focus', nodes => nodes.length === 0), '没有手柄时仍显示手柄 UI');
    check((await read()).unlocked === 1, '隔离的新存档没有锁定第二、三章');

    checkpoint = '首次连接和方向输入';
    const initialFocus = await focusKey();
    await input([0, 12]); await frames(); await wait(430);
    check((await read()).phase === 'title' && await focusKey() === initialFocus,
      '连接时按住 A / 上方向绕过中立锁');
    check(await page.$eval('#controller-hint', n => !n.hidden), '连接后没有手柄操作提示');
    await neutral(); await focusTo('#mode-challenges');
    for (const [button, axes, selector] of [
      [14, [0, 0], '#mode-campaign'], [15, [0, 0], '#mode-challenges'],
      [12, [0, 0], '#mode-campaign'], [13, [0, 0], '#mode-challenges'],
      [null, [0, 1], '#mode-survival'], [null, [0, -1], '#mode-challenges'],
      [null, [1, 0], '#mode-survival'], [null, [-1, 0], '#mode-challenges'],
    ]) {
      await press(button, axes);
      check(await page.evaluate(s => document.activeElement?.matches(s), selector),
        '方向键或左摇杆未按前后顺序移动焦点', { button, axes, expected: selector, actual: await focusKey() });
    }
    await visibleFocus('桌面模式选择');
    // Observe real focus events, not an exact number of RAF ticks. Slower CI
    // frames may delay a repeat, but must not make it run faster than specified.
    await neutral();
    const repeats = await page.evaluate(async () => {
      const times = [], collect = () => times.push(performance.now());
      document.addEventListener('focusin', collect);
      window.__raidControllerInput.buttons = [13];
      await new Promise(resolve => setTimeout(resolve, 740));
      window.__raidControllerInput.buttons = [];
      document.removeEventListener('focusin', collect);
      return times.slice(1).map((time, index) => time - times[index]);
    });
    await neutral();
    check(repeats.length >= 2 && repeats[0] >= 300 && repeats.slice(1).every(n => n >= 120),
      '方向长按没有延迟连发，或连发过快', repeats);

    checkpoint = '折叠和锁定选关';
    await focusTo('#stage-menu > summary'); await hold(0, 'title');
    check(await page.$eval('#stage-menu', n => n.open), 'A 没有原生展开选关');
    await press(13); check(await focusKey() === 'stage-1', '展开后没有抵达第一章');
    await press(13);
    check(await page.evaluate(() => document.activeElement === document.querySelector('#campaign-guide > summary')),
      '导航没有跳过锁定的第二、三章', await focusKey());
    await press(12); await press(1);
    check(await page.$eval('#stage-menu', n => !n.open) &&
      await page.evaluate(() => document.activeElement === document.querySelector('#stage-menu > summary')),
    'B 没有收起当前选关并将焦点还给 summary');
    await press(13);
    check(await page.evaluate(() => document.activeElement === document.querySelector('#campaign-guide > summary')),
      '折叠后仍可导航到隐藏的练习按钮');

    checkpoint = 'checkVisibility 兼容路径 / 安装临时替身';
    try {
      // Keep the native descriptor and restoration closure in the page. In
      // particular, never return Element.prototype from Object.defineProperty:
      // CDP cannot reliably serialize its native methods/accessors by value.
      const installed = await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'checkVisibility');
        window.__raidRestoreVisibility = () => {
          if (descriptor) Object.defineProperty(Element.prototype, 'checkVisibility', descriptor);
          else delete Element.prototype.checkVisibility;
          delete window.__raidRestoreVisibility;
          const restored = Object.getOwnPropertyDescriptor(Element.prototype, 'checkVisibility');
          return descriptor ? restored?.value === descriptor.value && restored.writable === descriptor.writable &&
            restored.enumerable === descriptor.enumerable && restored.configurable === descriptor.configurable : !restored;
        };
        Object.defineProperty(Element.prototype, 'checkVisibility', {
          configurable: true, writable: true, value: undefined,
        });
        return typeof Element.prototype.checkVisibility === 'undefined';
      });
      check(installed, '兼容夹具未成功移除 checkVisibility');
      checkpoint = 'checkVisibility 兼容路径 / 跳过关闭折叠内容';
      await focusTo('#stage-menu > summary'); await press(13);
      check(await page.evaluate(() => document.activeElement === document.querySelector('#campaign-guide > summary')),
        '兼容路径未跳过关闭折叠里的练习按钮');
      checkpoint = 'checkVisibility 兼容路径 / 展开并访问可用练习';
      await choose('#stage-menu > summary'); await press(13);
      check(await focusKey() === 'stage-1', '兼容路径不能导航到展开后的可用练习');
      checkpoint = 'checkVisibility 兼容路径 / 跳过禁用练习';
      await press(13);
      check(await page.evaluate(() => document.activeElement === document.querySelector('#campaign-guide > summary')),
        '兼容路径没有过滤禁用练习按钮');
      checkpoint = 'checkVisibility 兼容路径 / B 收起折叠';
      await press(12); await press(1);
      check((await read()).phase === 'title' && await page.$eval('#stage-menu', n => !n.open),
        '缺少 checkVisibility 时菜单冻结或 B 无法收起折叠');
    } finally {
      // Report restoration errors separately without hiding the original input
      // failure or its precise subcheckpoint. Only a boolean crosses CDP.
      try {
        const restored = await page.evaluate(() => window.__raidRestoreVisibility?.() === true);
        check(restored, '兼容夹具未完整恢复原生 checkVisibility', { checkpoint });
      } catch (error) {
        check(false, 'checkVisibility 兼容路径 / 恢复原生方法失败：' + error.message,
          { checkpoint, stack: error.stack });
      }
    }
    checkpoint = 'checkVisibility 兼容路径 / 恢复后的焦点验证';
    await visibleFocus('恢复原生可见性检查后');

    checkpoint = '键盘鼠标交替';
    await focusTo('#mode-survival'); await visibleFocus('输入切换前');
    await page.keyboard.press('Tab');
    const keyboardFocus = await focusKey(); await wait(200); await frames();
    check(await focusKey() === keyboardFocus &&
      await page.$$eval('.gamepad-focus', nodes => nodes.length === 0), '键盘接管后闲置手柄抢回焦点或留下高亮');
    await page.click('#mode-challenges'); await wait(200); await frames();
    check((await read()).titleView === 'challenges' && await focusKey() === 'mode-challenges' &&
      await page.$$eval('.gamepad-focus', nodes => nodes.length === 0), '鼠标接管后模式或焦点被手柄覆盖');
    await press(15); check(await focusKey() === 'mode-survival', '手柄未从鼠标的当前焦点继续导航');
    await hold(0, 'title');
    check((await read()).titleView === 'survival', '长按 A 没有只选择防线模式');
    await focusTo('#loadout-counter'); await hold(0, 'title');
    check((await read()).selectedLoadout === 'counter', '手柄未选择反击先锋');
    await shot('desktop-loadout');

    checkpoint = '开局暂停和按键泄漏';
    await hold(9, 'playing');
    let state = await read();
    check(state.mode === 'survival' && state.loadout === 'counter' && state.hp === 5 &&
      state.grenades === 3 && state.shots === 0 && state.ground && state.tacticalUses === 0,
    'Start 开局重复暂停或泄漏战斗输入', state);
    await input([15]); await frames(6);
    const movingX = (await read()).x;
    await input([15], [0, 0], false); await frames();
    const released = await read(); await frames(6);
    check((await read()).x === released.x && released.x >= movingX,
      '战斗中持方向断连后继续移动', { movingX, released, after: await read() });
    await page.keyboard.down('a'); await frames(6); await page.keyboard.up('a'); await frames();
    check((await read()).x < released.x, '手柄断连后键盘不能接管移动');
    const beforeReconnect = await read();
    await input([0, 1, 2, 3, 15]); await frames(6);
    const reconnected = await read();
    check(reconnected.x === beforeReconnect.x && reconnected.shots === beforeReconnect.shots &&
      reconnected.grenades === beforeReconnect.grenades && reconnected.tacticalUses === beforeReconnect.tacticalUses &&
      reconnected.ground, '战斗中持键重连泄漏移动或攻击', { beforeReconnect, reconnected });
    await neutral();
    // Clicking non-interactive chrome hands ownership to the pointer without
    // changing the run. Start must immediately restore a visible default ring,
    // before any directional input could accidentally repair missing focus UI.
    await page.click('.brand');
    check(await page.$$eval('.gamepad-focus', nodes => nodes.length === 0), '鼠标未接回焦点所有权');
    await hold(9, 'pause', 430, () => visibleFocus('鼠标模式下 Start 打开暂停的默认项'));
    const paused = frozen(await read()); await wait(200);
    check(JSON.stringify(frozen(await read())) === JSON.stringify(paused), '暂停未冻结本局状态');
    await focusTo('#start'); await hold(0, 'playing');
    state = await read();
    check(state.ground && state.jumpBuffer === 0 && state.grenades === 3 && state.shots === 0,
      'A 继续后泄漏跳跃或其他攻击', state);
    await press(9); await phase('pause'); await hold(1, 'playing');
    check((await read()).grenades === 3, 'B 从暂停返回战斗消耗了手雷');
    await press(9); await phase('pause');

    checkpoint = '确认取消和长按保护';
    const beforeConfirm = frozen(await read());
    for (const cancelButton of [0, 1, 9]) {
      await focusTo('#menu-home'); await hold(0, 'confirmRestart');
      check(await focusKey() === 'cancel-restart', '确认框初始焦点不是安全的取消按钮');
      await hold(cancelButton, 'pause');
      check(JSON.stringify(frozen(await read())) === JSON.stringify(beforeConfirm),
        '取消返回改变本局状态或长按越过暂停', { cancelButton, beforeConfirm, after: frozen(await read()) });
    }
    await choose('#restart'); await phase('confirmRestart'); await hold(1, 'pause');
    check(JSON.stringify(frozen(await read())) === JSON.stringify(beforeConfirm), '取消重开未保留暂停状态');
    await shot('desktop-paused');
    await returnHome();

    checkpoint = '三项挑战入口';
    // Test both focused Start and the documented first-challenge fallback.
    for (const [id, useStart] of [['counter', true], ['bosses', false], ['sprint', true]]) {
      await choose('#mode-challenges');
      if (id !== 'sprint') await focusTo('#challenge-' + id);
      await hold(useStart ? 9 : 0, 'playing', 120);
      state = await read();
      check(state.mode === 'challenge' && state.challengeId === id && state.ground && state.shots === 0,
        '挑战入口选择错误或 A 泄漏跳跃', { expected: id, state });
      await returnHome();
    }

    checkpoint = '断连和持键重连';
    await focusTo('#mode-survival');
    await input([13], [0, 0], false); await frames();
    check(await page.$eval('#controller-hint', n => n.hidden) &&
      await page.$$eval('.gamepad-focus', nodes => nodes.length === 0), '断连没有清除提示和手柄焦点');
    const disconnectedFocus = await focusKey();
    await input([0, 13]); await frames(); await wait(430);
    check((await read()).phase === 'title' && await focusKey() === disconnectedFocus,
      '重连时持键绕过中立锁并移动/确认');
    await neutral(); await press(13); await visibleFocus('重连后');
    const replacementFocus = await focusKey();
    await input([0, 12], [0, -1], true, 'Replacement controller'); await frames(); await wait(430);
    check(await focusKey() === replacementFocus && (await read()).phase === 'title', '更换手柄时持键绕过中立锁');
    await input([], [0, 0], true, 'Replacement controller'); await frames();
    await neutral();

    checkpoint = '320px 菜单与折叠滚动';
    await newTitle({ width: 320, height: 740 }); await neutral();
    await choose('#mode-survival'); await choose('#loadout-demolition');
    await focusTo('#controls-guide > summary'); await press(0); await visibleFocus('320px 操作说明');
    check(await page.$eval('#controls-guide', n => n.open) &&
      await page.evaluate(() => scrollY > 0), '窄屏手柄没有滚到并展开底部说明');
    await shot('320-controls-expanded');
    await hold(1, 'title');
    check(await page.$eval('#controls-guide', n => !n.open) && (await read()).titleView === 'survival',
      'B 关闭说明时意外切换模式');
    await press(1);
    check((await read()).titleView === 'campaign', 'B 没有从防线设置返回远征');
    await focusTo('#stage-menu > summary'); await press(0); await press(13);
    check(await focusKey() === 'stage-1', '320px 手柄无法访问已解锁练习');
    await press(13);
    check(await page.evaluate(() => document.activeElement === document.querySelector('#campaign-guide > summary')),
      '320px 导航进入锁定练习');
    await choose('#mode-survival'); await choose('#loadout-demolition');
    await focusTo('#start'); await visibleFocus('320px 开局'); await shot('320-loadout');
    await hold(0, 'playing', 120); await press(9); await phase('pause');
    state = await read();
    check(state.loadout === 'demolition' && state.grenades === 5 && state.ground && state.shots === 0,
      '窄屏 A 开局改变装具或泄漏战斗输入', state);
    await focusTo('#controls-guide > summary'); await press(0); await visibleFocus('320px 暂停说明');
    await press(1); await phase('pause');
    check(await page.$eval('#controls-guide', n => !n.open), '暂停页 B 没有优先收起说明');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '320px 手柄菜单出现横向溢出');
    await shot('320-paused'); await returnHome();

    checkpoint = '手柄真实战斗至首波整备';
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await choose('#mode-survival'); await choose('#loadout-assault'); await press(9); await phase('playing');
    await neutral();
    const decide = survivalTactics(), deadline = Date.now() + 45000;
    let lastJump = false;
    try {
      while (Date.now() < deadline) {
        state = await read();
        if (state.phase !== 'playing') break;
        const action = decide(state), buttons = action.fire === false ? [] : [2];
        const jump = action.jump && state.ground && !lastJump;
        if (jump) buttons.push(0);
        if (action.grenade) buttons.push(1);
        if (action.dash) buttons.push(4);
        if (action.down) buttons.push(13);
        lastJump = jump;
        await input(buttons, [action.move === 'a' ? -1 : action.move === 'd' ? 1 : 0, 0]);
        await wait(80);
      }
    } finally { await neutral(); }
    state = await read();
    if (!check(state.phase === 'waveClear' && state.survivalCleared === 1 && state.hp > 0 &&
      state.progress.survival.wave === 1, '仅真实手柄输入未完成首波', state)) return;
    await visibleFocus('首波自动结算的默认补给，尚未导航');

    checkpoint = '补给重抽委托和禁用控件';
    const firstSupply = frozen(state);
    await hold(9, 'waveClear', 120);
    check((await read()).selectedSupply === null && await page.$eval('#start', n => n.disabled),
      '未选择补给时 Start 提前继续');
    await choose('#supply-0');
    check((await read()).selectedSupply === state.supplyOffers[0], 'A 没有选择首项补给');
    await choose('#contract-summary'); await choose('#contract-recovery');
    await press(1);
    check(await page.$eval('#contract-options', n => !n.open) &&
      (await read()).selectedContract === 'recovery' && (await read()).phase === 'waveClear',
    'B 没有收起委托或取消了已选委托');
    await focusTo('#supply-reroll'); await hold(0, 'waveClear');
    state = await read();
    check(state.supplyRerolls === 0 && state.selectedSupply === null && state.selectedContract === 'recovery' &&
      state.survivalTime === firstSupply.survivalTime && state.hp === firstSupply.hp && state.grenades === firstSupply.grenades &&
      await page.$eval('#start', n => n.disabled), '重抽后没有重新要求选择，或改变委托/资源/计时', state);
    await page.setViewport({ width: 320, height: 740, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await focusTo('#supply-2'); await press(13);
    check(await focusKey() === 'contract-summary', '导航没有跳过已禁用的重抽按钮');
    await visibleFocus('320px 整备委托'); await shot('320-supply');
    const beforeCancel = frozen(await read());
    await press(1); await phase('confirmRestart'); await hold(1, 'waveClear');
    check(JSON.stringify(frozen(await read())) === JSON.stringify(beforeCancel), 'B 取消整备返回改变补给、重抽或委托');
    await choose('#supply-1'); await hold(9, 'playing', 120);
    state = await read();
    check(state.survivalWave === 2 && state.fieldContract?.status === 'active' && state.ground &&
      state.tacticalUses === 0, '选好补给后 Start 未进入第二波或泄漏动作', state);
    await press(9); await phase('pause'); await shot('320-second-wave-paused');
  } catch (error) {
    check(false, checkpoint + '检查中断：' + error.message, { stack: error.stack ?? String(error) });
    await shot('failure').catch(() => {});
  } finally {
    await context.close();
    await sourcePage.bringToFront().catch(() => {});
  }
}
