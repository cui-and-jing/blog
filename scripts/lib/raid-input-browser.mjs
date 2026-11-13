/** Real keyboard ownership and muzzle poses, without game/RNG/clock mutation. */
import path from 'node:path';

export async function checkRaidInput(sourcePage, problems) {
  const context = await sourcePage.browser().createBrowserContext();
  const page = await context.newPage();
  const held = new Set();
  let checkpoint = '初始化';
  const check = (ok, message, state) => {
    if (!ok) throw new Error(message + (state ? ' ' + JSON.stringify(state) : ''));
  };
  const read = () => page.evaluate(() => window.__raidState);
  const phase = value => page.waitForFunction(p => window.__raidState?.phase === p, { timeout: 5000 }, value);
  const visibleSpawn = () => page.waitForFunction(() => window.__raidState?.clock > 1.25, { timeout: 5000 });
  const frames = n => page.evaluate(count => new Promise(resolve => {
    const tick = () => --count > 0 ? requestAnimationFrame(tick) : resolve();
    requestAnimationFrame(tick);
  }), n);
  const down = async key => { await page.keyboard.down(key); held.add(key); };
  const up = async key => { await page.keyboard.up(key); held.delete(key); };
  const release = async () => { for (const key of [...held]) await up(key); };
  const shot = name => page.screenshot({ path: path.join(process.cwd(), '.shots', 'pixelraid-input-' + name + '.png'), fullPage: true });
  const restart = async () => {
    await release(); await page.click('#restart'); await phase('confirmRestart');
    await page.click('#start'); await phase('playing'); await frames(2);
    const s = await read(); check(s.shots === 0 && s.grenades === 3, '重开残留输入', s);
  };
  page.on('pageerror', error => problems.push('Pixel Raid 连续输入：' + error.message));
  try {
    await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(() => {
      window.__raidKeyboardAudit = [];
      for (const type of ['keydown', 'keyup']) document.addEventListener(type, e => {
        window.__raidKeyboardAudit.push({ type, key: e.key, code: e.code, repeat: e.repeat, trusted: e.isTrusted });
      }, true);
    });
    await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' }); await page.bringToFront();
    await page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
    check(await page.evaluate(() => !('__raidQA' in window)), '发布页面出现可写测试入口');
    await shot('clean-lobby'); await page.click('#start'); await phase('playing');

    checkpoint = '双移动键交接';
    for (const reverse of [false, true]) {
      for (const [a, b, direction] of [['d', 'ArrowRight', 1], ['a', 'ArrowLeft', -1]]) {
        await down(a); await down(b); await frames(4); await up(reverse ? b : a);
        const before = await read(); await frames(6); const after = await read();
        check(direction * (after.x - before.x) >= 8, '松开一个别名使仍按住的方向失效', { a, b, reverse, before, after });
        await up(reverse ? a : b); await frames(2); const stopped = await read(); await frames(4);
        check(Math.abs((await read()).x - stopped.x) < .01, '全部松开后仍在移动');
      }
    }
    checkpoint = '下蹲和连射交接';
    for (const reverse of [false, true]) {
      await down('s'); await down('ArrowDown'); await frames(2); await up(reverse ? 'ArrowDown' : 's'); await frames(2);
      check((await read()).crouch, '剩余下键没有保持下蹲'); await up(reverse ? 's' : 'ArrowDown'); await frames(2);
      check(!(await read()).crouch, '松开全部下键仍下蹲');
      await down('j'); await down('z'); await frames(2); await up(reverse ? 'z' : 'j');
      const before = await read(); await frames(16);
      check((await read()).shots > before.shots, '交接射击键后连射中断');
      await up(reverse ? 'j' : 'z'); const stopped = await read(); await frames(10);
      check((await read()).shots === stopped.shots, '松开全部射击键后仍开火');
    }

    checkpoint = '仰射交接与枪口'; await restart(); await visibleSpawn();
    await down('w'); await down('ArrowUp'); await down('j'); await frames(4); await up('w'); await frames(2);
    const upward = await read();
    check(!upward.ground && upward.fireAim === -1 && upward.playerProjectiles.some(b => b.vy < 0),
      '松开 W 后仍按 ↑ 没有保持实际仰射', upward);
    await shot('upward-muzzle'); await release();

    checkpoint = '俯射交接与枪口'; await restart(); await visibleSpawn();
    await down('w'); await frames(4); await up('w'); await down('s'); await down('ArrowDown'); await down('j');
    await up('s'); await frames(2); const downward = await read();
    check(!downward.ground && downward.fireAim === 1 && downward.playerProjectiles.some(b => b.vy > 0),
      '松开 S 后仍按 ↓ 没有保持实际俯射', downward);
    await shot('downward-muzzle'); await up('ArrowDown');
    check((await read()).fireAim === 0, '最后一个下键释放后没有恢复平射'); await release();

    // Repeat events are produced by actual browser keyboard input, not a
    // dispatchEvent fixture. Test both menu and real background interruptions.
    for (const interruption of ['pause', 'cancel-restart', 'background']) {
      checkpoint = interruption + ' 后旧键重复不得复活'; await restart();
      for (const key of ['d', 'j', 'z', 's', 'ArrowDown', 'k']) await down(key);
      await frames(2);
      let background;
      if (interruption === 'pause') { await page.keyboard.press('p'); await phase('pause'); }
      else if (interruption === 'cancel-restart') { await page.keyboard.press('r'); await phase('confirmRestart'); }
      else {
        background = await context.newPage(); await background.bringToFront();
        await page.waitForFunction(() => window.__raidState?.phase === 'pause', { timeout: 5000, polling: 100 });
        check(await page.evaluate(() => document.hidden || !document.hasFocus()), '未实际切到后台');
        await page.bringToFront(); await background.close();
      }
      const paused = await read(); await frames(4);
      check(JSON.stringify(await read()) === JSON.stringify(paused), '中断期间战斗没有冻结');
      if (interruption === 'cancel-restart') await page.click('#cancel-restart'); else await page.click('#start');
      await phase('playing'); await frames(2); const resumed = await read();
      const auditFrom = await page.evaluate(() => window.__raidKeyboardAudit.length);
      for (const key of [...held]) await page.keyboard.down(key);
      await frames(18); const repeated = await read();
      const audit = await page.evaluate(from => window.__raidKeyboardAudit.slice(from), auditFrom);
      check(audit.length === held.size && audit.every(e => e.type === 'keydown' && e.repeat && e.trusted),
        '未通过真实浏览器生成按住旧键的重复事件', audit);
      check(repeated.shots === resumed.shots && repeated.grenades === resumed.grenades && !repeated.crouch &&
        Math.abs(repeated.x - resumed.x) < .01, '旧重复事件恢复了移动、开火或消耗品', { resumed, repeated });
      await release(); await down('j'); await frames(12);
      check((await read()).shots > repeated.shots, '释放重按后没有恢复正常射击'); await release();
    }
    await page.keyboard.press('p'); await phase('pause'); await shot('released-pause');
    await page.click('#menu-home'); await phase('confirmRestart'); await page.click('#start'); await phase('title');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 &&
      !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open),
    '回大厅出现溢出或自动展开说明');
    await shot('returned-lobby');
  } catch (error) {
    problems.push('Pixel Raid 连续输入：' + checkpoint + '：' + error.message);
    await shot('failure').catch(() => {});
  } finally {
    await release().catch(() => {}); await context.close();
  }
}
