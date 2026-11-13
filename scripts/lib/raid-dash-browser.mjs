/** Dash forgiveness with native inputs and read-only real-time observation. */
import path from 'node:path';

export async function checkRaidDash(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    let checkpoint = '初始化', contact = null, keyHeld = false;
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details ? ' ' + JSON.stringify(details) : ''));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = predicate => page.waitForFunction(predicate, { timeout: 6000, polling: 'raf' });
    const shot = suffix => page.screenshot({ path: path.join(process.cwd(), '.shots', `pixelraid-dash-${label}-${suffix}.png`), fullPage: true });
    const frames = count => page.evaluate(n => new Promise(resolve => {
      const tick = () => --n > 0 ? requestAnimationFrame(tick) : resolve();requestAnimationFrame(tick);
    }), count);
    const up = async () => {
      if (contact) { await contact.end(); contact = null; }
      if (keyHeld) { await page.keyboard.up('l'); keyHeld = false; }
    };
    let point;
    const down = async () => {
      if (mobile) contact = await page.touchscreen.touchStart(point.x, point.y);
      else { await page.keyboard.down('l'); keyHeld = true; }
    };
    const tap = async selector => {
      const element = await page.$(selector);await element.scrollIntoView();
      if (mobile) await element.tap();else await element.click();
    };
    page.on('pageerror', error => problems.push(`Pixel Raid 冲刺 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        window.__dashInputs = [];window.__dashFrames = [];
        for (const type of ['keydown', 'pointerdown']) document.addEventListener(type, e => {
          if ((type === 'keydown' && e.key === 'l') || (type === 'pointerdown' && e.target.closest?.('[data-action="dash"]'))) {
            const s = window.__raidState;
            window.__dashInputs.push({ type, trusted: e.isTrusted, repeat: !!e.repeat, cooldown: s?.dashCooldown, clock: s?.clock });
          }
        }, true);
        const observe = () => {
          const s = window.__raidState;
          if (s && window.__dashFrames.length < 3000) window.__dashFrames.push({ phase: s.phase, cooldown: s.dashCooldown, buffer: s.dashBuffer, dash: s.dashTime, clock: s.clock, x: s.x });
          requestAnimationFrame(observe);
        };requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait(() => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写游戏入口');
      await tap('#start');await wait(() => window.__raidState.phase === 'playing');
      if (mobile) {
        point = await page.$eval('#dash-control', element => {
          element.scrollIntoView({ block: 'end' });const r = element.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
        });
        require(point.w >= 42 && point.h >= 44 && point.x < 320 && point.y < 844, '冲刺触控目标不可达', point);
      }
      checkpoint = '就绪与冷却反馈';
      require(await page.$eval('#dash-control', e => e.dataset.ready === 'true' && !e.disabled && e.getAttribute('aria-label').includes('已就绪')), '初始就绪状态不正确');
      await shot('ready');await down();await frames(2);await up();
      const first = await read();require(first.dashCooldown > 2 && first.dashTime > 0, '真实输入没有开始冲刺', first);
      const cooling = await page.$eval('#dash-control', e => ({ ready: e.dataset.ready, disabled: e.disabled, label: e.getAttribute('aria-label'), width: parseFloat(document.querySelector('#dash-meter').style.width) }));
      require(cooling.ready === 'false' && !cooling.disabled && cooling.label.includes('冷却') && cooling.width < 40, '冷却状态与短条错误', cooling);
      await shot('cooldown');

      checkpoint = '过早输入过期，长按不连冲';
      await wait(() => window.__raidState.dashCooldown < .45 && window.__raidState.dashCooldown > .2);
      await down();await wait(() => window.__raidState.dashCooldown === 0);await frames(5);
      require((await read()).dashTime === 0 && (await read()).dashBuffer === 0, '过早或长按输入自动冲刺');
      require(await page.$eval('#dash-control', e => e.dataset.ready === 'true' && document.querySelector('#dash-meter').style.width === '100%'), '恢复后未显示就绪');
      await up();

      checkpoint = '临近冷却的一次预输入';
      await down();await frames(2);await up();
      const start = await page.evaluate(() => window.__dashFrames.length);
      await wait(() => window.__raidState.dashCooldown <= .115 && window.__raidState.dashCooldown > .03);
      await down();await wait(() => window.__raidState.dashCooldown > 2);await up();
      const evidence = await page.evaluate(from => ({ frames: window.__dashFrames.slice(from), input: window.__dashInputs.at(-1), state: window.__raidState }), start);
      require(evidence.input.trusted && !evidence.input.repeat && evidence.input.cooldown > 0 && evidence.input.cooldown <= .12,
        '未在真实冷却窗口中输入', evidence.input);
      const queued = evidence.frames.findIndex(s => s.buffer > 0 && s.cooldown > 0 && s.dash === 0);
      require(queued >= 0 && evidence.frames.slice(queued + 1).some(s => s.cooldown > 2 && s.buffer === 0 && s.dash > 0),
        '未验证先等待再冲刺的完整过程', evidence);
      await shot('buffered-dash');

      checkpoint = '暂停和取消重开不遗留冲刺';
      await wait(() => window.__raidState.dashCooldown < .45 && window.__raidState.dashCooldown > .2);await down();
      await tap('#pause');await wait(() => window.__raidState.phase === 'pause');
      require((await read()).dashBuffer === 0, '暂停没有清除预输入');await up();
      const frozen = await read();await frames(5);require(JSON.stringify(await read()) === JSON.stringify(frozen), '暂停计时没有冻结');
      await tap('#start');await wait(() => window.__raidState.phase === 'playing');
      await wait(() => window.__raidState.dashCooldown === 0);require((await read()).dashTime === 0, '继续后突然冲刺');
      await tap('#restart');await wait(() => window.__raidState.phase === 'confirmRestart');await tap('#cancel-restart');
      await wait(() => window.__raidState.phase === 'playing');await frames(3);
      require((await read()).dashTime === 0 && (await read()).dashBuffer === 0 && (await read()).touchCount === 0, '取消重开残留动作');
      require(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '屏幕产生横向溢出');
      await tap('#pause');await wait(() => window.__raidState.phase === 'pause');
      await tap('#menu-home');await wait(() => window.__raidState.phase === 'confirmRestart');await tap('#start');await wait(() => window.__raidState.phase === 'title');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open), '大厅说明自动展开');
      await shot('lobby');
    } catch (error) {
      problems.push(`Pixel Raid 冲刺 ${label}：${checkpoint}：${error.message}`);await shot('failure').catch(() => {});
    } finally { await up().catch(() => {});await context.close(); }
  }
}
