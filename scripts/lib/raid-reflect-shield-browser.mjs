/** Return a shield guard's own projectile, then shoot its opened front. */
import fs from 'node:fs';
import path from 'node:path';

export async function checkRaidReflectShield(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext(), page = await context.newPage();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    const prefix = path.join(process.cwd(), '.shots', `pixelraid-reflect-shield-${label}`), held = new Map();
    let checkpoint = '初始化';
    const require = (ok, message, detail) => {
      if (!ok) throw new Error(message + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = predicate => page.waitForFunction(predicate, { timeout: 6000, polling: 'raf' });
    const phase = wanted => page.waitForFunction(value => window.__raidState.phase === value, { timeout: 6000, polling: 'raf' }, wanted);
    const activate = async selector => {
      require(held.size === 0, '点击菜单前必须释放所有原生接触');
      const element = await page.$(selector);await element.scrollIntoView();
      if (mobile) await element.tap();else await element.click();
    };
    const keys = { jump: 'w', down: 's', right: 'd', dash: 'l', fire: 'j' };
    const pointerAudit = async (index, types) => {
      await page.waitForFunction(({ index, types }) => window.__reflectShieldProof.inputs.slice(index).some(event => types.includes(event.type)),
        { timeout: 2000, polling: 'raf' }, { index, types });
      return page.evaluate(({ index, types }) => ({
        events: window.__reflectShieldProof.inputs.slice(index).filter(event => types.includes(event.type)),
        state: window.__raidState,
        active: [...document.querySelectorAll('[data-action].active')].map(el => el.dataset.action).sort()
      }), { index, types });
    };
    const down = async action => {
      if (held.has(action)) return;
      if (mobile) {
        const point = await page.$eval(`[data-action="${action}"]`, element => {
          element.closest('.controls').scrollIntoView({ block: 'end', behavior: 'instant' });
          const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { x, y, w: r.width, h: r.height, hit: hit === element || element.contains(hit) };
        });
        require(point.hit && point.w >= 42 && point.h >= 44 && point.x > 0 && point.x < 320 && point.y > 0 && point.y < 844,
          '原生触控目标不可达', { action, point });
        const index = await page.evaluate(() => window.__reflectShieldProof.inputs.length);
        const handle = await page.touchscreen.touchStart(point.x, point.y);
        held.set(action, { handle });
        const audit = await pointerAudit(index, ['pointerdown']);
        const event = audit.events[0];held.set(action, { handle, pointerId: event?.pointerId });
        require(audit.events.length === 1 && event.action === action && event.trusted && audit.state.phase === 'playing' &&
          audit.state.touchCount === held.size && JSON.stringify(audit.active) === JSON.stringify([...held.keys()].sort()),
        '真实按下未命中预期动作或触点状态不一致', { action, point, audit });
      } else { await page.keyboard.down(keys[action]);held.set(action, true); }
    };
    const up = async action => {
      if (!held.has(action)) return;
      if (mobile) {
        const contact = held.get(action), index = await page.evaluate(() => window.__reflectShieldProof.inputs.length);
        await contact.handle.end();held.delete(action);
        const audit = await pointerAudit(index, ['pointerup', 'pointercancel']), event = audit.events[0];
        require(audit.events.length === 1 && event.action === action && event.pointerId === contact.pointerId && event.trusted &&
          audit.state.touchCount === held.size && JSON.stringify(audit.active) === JSON.stringify([...held.keys()].sort()),
        '原生触点未独立释放', { action, audit });
      } else { await page.keyboard.up(keys[action]);held.delete(action); }
    };
    const release = async () => { for (const action of [...held.keys()]) await up(action); };
    page.on('pageerror', error => problems.push(`Pixel Raid 反弹破盾 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        const proof = window.__reflectShieldProof = { inputs: [], reflected: null, broken: null, followup: null };
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel']) {
          document.addEventListener(type, event => {
            const target = event.target.closest?.('[data-action],button'), s = window.__raidState;
            proof.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id,
              tag: event.target?.tagName, pointerId: event.pointerId, trusted: event.isTrusted, repeat: !!event.repeat,
              clock: s?.clock, phase: s?.phase });
          }, true);
        }
        let previous;
        function observe() {
          const s = window.__raidState, guard = s?.enemies.find(e => e.type === 'shield' && e.x < 800);
          if (s?.phase === 'playing' && previous?.phase === 'playing' && guard) {
            const old = previous.enemies.find(e => e.type === 'shield' && e.x < 800);
            if (!proof.reflected && guard.hp === 5 && s.playerProjectiles.some(b => b.reflected)) proof.reflected = s;
            if (!proof.broken && old?.hp === 5 && guard.hp === 3 && guard.shieldBreak > 0) {
              proof.broken = { before: previous, after: s };
              window.__reflectShieldCanvas = document.getElementById('field').toDataURL('image/png').split(',')[1];
            }
            if (proof.broken && !proof.followup && old?.hp === 3 && guard.hp === 2 && old.shieldBreak > 0 && guard.shieldBreak > 0) {
              proof.followup = { before: previous, after: s };
              window.__reflectShieldFollowupCanvas = document.getElementById('field').toDataURL('image/png').split(',')[1];
            }
          }
          previous = s;requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait(() => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页暴露可写入口');
      await activate('#mode-challenges');await activate('#challenge-counter');await phase('playing');
      checkpoint = '真实射击清理挡路炮塔';
      const initial = await read();await down('fire');
      await wait(() => !window.__raidState.enemies.some(e => e.type === 'turret' && e.x < 500));await up('fire');
      require((await read()).enemies.find(e => e.type === 'shield' && e.x < 800)?.hp === 5, '前置清场损伤目标盾卫');
      checkpoint = '跳过散弹并登台降层';
      // Controls-only VM route: 3 random seeds and 0/3/6/10-frame release/input
      // delays. Jump early enough to clear the pickup without gaining spread.
      await down('right');await wait(() => window.__raidState.x >= 100);await down('jump');
      await wait(() => window.__raidState.x >= 350);await up('right');await up('jump');
      await wait(() => window.__raidState.ground);
      if ((await read()).y + (await read()).playerHeight === 425) {
        await down('jump');await wait(() => !window.__raidState.ground);
        await wait(() => window.__raidState.vy >= 0);await up('jump');
        await wait(() => window.__raidState.ground);
      }
      const ledge = await read();
      require(ledge.x >= 350 && ledge.x < 400 && ledge.y + ledge.playerHeight === 328 && ledge.weapon === 'rifle',
        '自然走位未登上目标平台或拾取散弹污染单发验证', ledge);
      await down('down');await down('jump');await wait(() => window.__raidState.dropTime > 0 && !window.__raidState.ground);
      await up('jump');await up('down');await wait(() => window.__raidState.ground && window.__raidState.y + window.__raidState.playerHeight === 425);
      const positioned = await read();
      require(positioned.face === 1 && positioned.weapon === 'rifle' && positioned.reflections === 0 && positioned.stomps === 0,
        '反弹前出现额外动作或武器变化', positioned);
      checkpoint = '冲刺反弹真实盾卫子弹';
      await wait(() => { const s = window.__raidState;return s.dashCooldown === 0 && s.hostiles.some(b =>
        b.x > s.x && b.x < s.x + 130 && b.y > s.y - 15 && b.y < s.y + s.playerHeight + 15); });
      await down('dash');await up('dash');await wait(() => window.__reflectShieldProof.broken !== null);
      await release();await activate('#pause');await phase('pause');
      const broken = await page.evaluate(() => window.__reflectShieldProof), frozen = await read();
      const guard = broken.broken.after.enemies.find(e => e.type === 'shield' && e.x < 800);
      require(broken.reflected && broken.reflected.playerProjectiles.some(b => b.reflected && b.damage === 2) &&
        guard.hp === 3 && guard.shieldBreak > 0 && guard.shieldBreak <= 1.2 && guard.stagger === 0 &&
        broken.broken.after.reflections === 1 && broken.broken.after.shots === positioned.shots &&
        broken.broken.after.grenades === positioned.grenades && broken.broken.after.stomps === 0 &&
        broken.broken.after.combatText.includes('反弹破盾'), '未证明反弹弹以既有2伤命中并单独开启破防', broken);
      require(frozen.enemies.find(e => e.type === 'shield' && e.x < 800)?.shieldBreak > .5 && frozen.hp > 0,
        '暂停前破防窗口消失或玩家阵亡', frozen);
      await new Promise(resolve => setTimeout(resolve, 150));
      require(JSON.stringify(await read()) === JSON.stringify(frozen), '暂停没有冻结破防与战场');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require(JSON.stringify(await read()) === JSON.stringify(frozen), '取消重开改变破防状态');
      checkpoint = '原生步枪正面追击恰为1伤';
      await activate('#start');await phase('playing');await down('fire');
      await wait(() => window.__reflectShieldProof.followup !== null);await up('fire');await release();await activate('#pause');await phase('pause');
      const followup = await page.evaluate(() => window.__reflectShieldProof.followup);
      const prior = followup.before.enemies.find(e => e.type === 'shield' && e.x < 800);
      const next = followup.after.enemies.find(e => e.type === 'shield' && e.x < 800);
      require(prior.hp === 3 && next.hp === 2 && prior.face === -1 && followup.before.x + 27 <= prior.x &&
        followup.before.face === 1 && followup.after.weapon === 'rifle' && followup.after.shots > positioned.shots &&
        followup.after.reflections === 1 && followup.after.grenades === positioned.grenades && followup.after.stomps === 0 &&
        next.shieldBreak > 0 && next.shieldBreak <= prior.shieldBreak && next.stagger === 0,
      '追击不是正面普通1伤或错误刷新/增伤', followup);
      for (const [suffix, key] of [['active', '__reflectShieldCanvas'], ['followup', '__reflectShieldFollowupCanvas']]) {
        const png = await page.evaluate(key => window[key], key);
        require(typeof png === 'string' && png.length > 0, '缺少真实画布：' + suffix);
        fs.writeFileSync(prefix + '-' + suffix + '.png', Buffer.from(png, 'base64'));
      }
      const proof = await page.evaluate(() => window.__reflectShieldProof);
      require(proof.inputs.every(event => event.trusted), '路线包含非原生输入');
      fs.writeFileSync(prefix + '-route.json', JSON.stringify({ initial, ledge, positioned, frozen, proof }, null, 2));
      checkpoint = '重开清除破防及输入';
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      const restarted = await read();
      require(restarted.challengeId === 'counter' && restarted.reflections === 0 && restarted.shots === 0 && restarted.touchCount === 0 &&
        restarted.enemies.filter(e => e.type === 'shield').every(e => e.hp === 5 && e.shieldBreak === 0), '重开残留旧盾卫破防', restarted);
      await activate('#pause');await phase('pause');await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
        document.documentElement.scrollWidth <= innerWidth + 1), '大厅展开或横向溢出');
    } catch (error) {
      const evidence = await page.evaluate(() => ({ state: window.__raidState, proof: window.__reflectShieldProof })).catch(() => null);
      problems.push(`Pixel Raid 反弹破盾 ${label}：${checkpoint}：${error.message}`);
      fs.writeFileSync(prefix + '-diagnostic.json', JSON.stringify({ checkpoint, error: error.message, evidence }, null, 2));
      await page.screenshot({ path: prefix + '-error.png', fullPage: true }).catch(() => {});
    } finally { await release().catch(() => {});await context.close(); }
  }
}
