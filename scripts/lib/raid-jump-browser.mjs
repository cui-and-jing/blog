/** Variable ordinary jumps: native controls and read-only shipped-page evidence. */
import fs from 'node:fs';
import path from 'node:path';

export async function checkRaidJump(sourcePage, problems) {
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext();
    const page = await context.newPage();
    const label = mobile ? 'touch-320' : 'keyboard-1280';
    const prefix = path.join(process.cwd(), '.shots', 'pixelraid-jump-' + label);
    const keys = new Set(), contacts = new Map();
    let checkpoint = '初始化';
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details ? ' ' + JSON.stringify(details) : ''));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = predicate => page.waitForFunction(predicate, { timeout: 5000, polling: 'raf' });
    const phase = value => page.waitForFunction(p => window.__raidState?.phase === p, { timeout: 5000 }, value);
    const frames = count => page.evaluate(n => new Promise(resolve => {
      const next = () => --n > 0 ? requestAnimationFrame(next) : resolve();requestAnimationFrame(next);
    }), count);
    const shot = suffix => page.screenshot({ path: prefix + '-' + suffix + '.png', fullPage: true });
    const key = async (name, held) => {
      if (keys.has(name) === held) return;
      await page.keyboard[held ? 'down' : 'up'](name);
      if (held) keys.add(name); else keys.delete(name);
    };
    const activate = async selector => {
      const element = await page.$(selector);require(element, '找不到界面控件 ' + selector);
      if (mobile) { await element.scrollIntoView();await element.tap(); } else await element.click();
    };
    let points;
    const touch = async (action, held) => {
      if (contacts.has(action) === held) return;
      if (held) {
        const p = points[action];require(p?.hit && p.w >= 42 && p.h >= 44 && p.x < 320 && p.y < 844,
          '320px 跳跃触控不可达', { action, p });
        contacts.set(action, await page.touchscreen.touchStart(p.x, p.y));
      } else { await contacts.get(action).end();contacts.delete(action); }
    };
    const control = (action, held) => mobile ? touch(action, held) : key(action === 'jump' ? 'w' : 'd', held);
    const release = async () => {
      for (const name of [...keys]) await key(name, false);
      for (const name of [...contacts.keys()]) await touch(name, false);
    };
    const startObservation = async name => page.evaluate(name => {
      // This observer never replaces RAF, time, RNG, input events or game data.
      // Store actual rendered canvas pixels at the measured apex, not a fixture.
      const s = window.__raidState;
      const proof = window.__raidJumpRun = { name, start: s, samples: [], apex: null,
        minY: s.y, airborne: false, done: false, inputFrom: window.__raidJumpInputs.length };
      let playingMs = 0, lastObserved = performance.now();
      const observe = () => {
        if (window.__raidJumpRun !== proof || proof.done) return;
        const s = window.__raidState, now = performance.now();
        if (s.phase === 'playing') playingMs += now - lastObserved;
        lastObserved = now;
        proof.samples.push({ clock:s.clock, phase:s.phase, x:s.x, y:s.y, vy:s.vy, ground:s.ground,
          held:s.jumpHeld, eligible:s.jumpCutEligible, touches:s.touchCount });
        if (!s.ground) proof.airborne = true;
        if (s.y < proof.minY) {
          proof.minY = s.y;proof.apex = s;
          proof.png = document.getElementById('field').toDataURL('image/png').split(',')[1];
        }
        if (proof.airborne && s.ground) {
          proof.done = true;proof.end = s;proof.inputs = window.__raidJumpInputs.slice(proof.inputFrom);return;
        }
        if (playingMs > 5000) { proof.error = '原生跳跃没有自然落地';proof.done = true;return; }
        requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    }, name);
    const evidence = async name => {
      await page.waitForFunction(() => window.__raidJumpRun?.done, { timeout:12000, polling:'raf' });
      const proof = await page.evaluate(() => window.__raidJumpRun);
      require(!proof.error && proof.airborne && proof.apex && proof.png, proof.error || '没有观测到跳跃与顶点', proof);
      const { png, ...data } = proof;
      fs.writeFileSync(prefix + '-' + name + '-apex.png', Buffer.from(png, 'base64'));
      fs.writeFileSync(prefix + '-' + name + '.json', JSON.stringify(data, null, 2) + '\n');
      require(proof.inputs.length >= 1 && proof.inputs.every(input => input.trusted), '跳跃没有使用原生可信输入', proof.inputs);
      require(proof.end.hp === proof.start.hp && proof.end.lives === proof.start.lives &&
        proof.end.stomps === 0 && proof.end.shots === 0 && proof.end.grenades === 3 &&
        proof.end.dashTime === 0 && proof.end.stageDeaths === 0, '跳高验证混入战斗、冲刺或损失', data);
      return data;
    };
    const restart = async () => {
      await release();await activate('#restart');await phase('confirmRestart');
      await activate('#start');await phase('playing');await frames(2);
      if (mobile) points = await page.$$eval('[data-action="right"], [data-action="jump"]', elements => {
        elements[0].closest('.controls').scrollIntoView({ block:'end' });
        return Object.fromEntries(elements.map(element => {
          const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          const hit = document.elementFromPoint(x,y);
          return [element.dataset.action, { x,y,w:r.width,h:r.height,hit:hit===element||element.contains(hit) }];
        }));
      });
    };
    page.on('pageerror', error => problems.push('Pixel Raid 可变跳高 ' + label + '：' + error.message));
    try {
      await page.setViewport({ width:mobile?320:1280, height:mobile?844:960,
        deviceScaleFactor:1, isMobile:mobile, hasTouch:mobile });
      await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
      await page.evaluateOnNewDocument(() => {
        window.__raidJumpInputs = [];
        for (const type of ['keydown','keyup','pointerdown','pointerup','pointercancel']) document.addEventListener(type, event => {
          const action = event.target.closest?.('[data-action]')?.dataset.action;
          if (action || ['w','ArrowUp',' ','d'].includes(event.key)) {
            const s = window.__raidState;
            window.__raidJumpInputs.push({ type,key:event.key,action,pointerId:event.pointerId,
              trusted:event.isTrusted,repeat:!!event.repeat,clock:s?.clock,vy:s?.vy,ground:s?.ground });
          }
        }, true);
      });
      await page.goto(sourcePage.url(), {waitUntil:'domcontentloaded'});await page.bringToFront();
      await wait(() => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页暴露可写游戏入口');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open &&
        !document.querySelector('#survival-guide').open), '初始大厅说明没有收起');
      await activate('#start');await phase('playing');
      const results = {};
      for (const name of ['tap','hold']) {
        checkpoint = name === 'tap' ? '轻点短跳与多指独立释放' : '按住完整高度';
        await restart();await startObservation(name);
        // Both traverse the safe first-chapter spawn by real controls. Keeping
        // Right down proves releasing Jump does not release the other finger.
        await control('right', true);await control('jump', true);
        let released;
        if (name === 'tap') {
          // Deliberately no RAF wait: a tap wholly between physics updates is
          // valid user input and must still launch the queued short hop.
          await control('jump', false);released = await read();
          if (mobile) {
            require(released.touchCount === 1 && await page.$eval('[data-action="right"]',e=>e.classList.contains('active')) &&
              !await page.$eval('[data-action="jump"]',e=>e.classList.contains('active')),
            '松开跳跃误清掉仍按住的移动触点', released);
          }
        }
        results[name] = await evidence(name);await release();
        const r = results[name], height = r.start.y - r.minY;
        require(name === 'tap' ? height > 10 && height < 65 : height > 100 && height < 110,
          '轻点和按住没有得到预期高度', {name,height,start:r.start,apex:r.apex});
        require(r.end.x > (released?.x ?? r.start.x) + 20 && r.end.x < 400,
          '释放跳跃后移动没有继续，或路线越出安全区域', {released,end:r.end});
        if (mobile) {
          const events = r.inputs.filter(e=>e.type.startsWith('pointer'));
          const starts = events.filter(e=>e.type==='pointerdown');
          require(starts.length===2 && new Set(starts.map(e=>e.pointerId)).size===2 &&
            (name!=='tap'||events.some(e=>e.type==='pointerup'&&e.action==='jump'&&e.pointerId===starts.find(e=>e.action==='jump').pointerId)),
          '没有验证两个原生独立触点', events);
        }
        await shot(name + '-landed');
      }
      require(results.tap.minY - results.hold.minY > 45, '短跳与完整跳跃顶点差不够明显');

      if (!mobile) {
        checkpoint = '别名交接保持完整跳跃';await restart();await startObservation('aliases');
        await key('w',true);await key('ArrowUp',true);await key('w',false);
        const aliases = await evidence('aliases');await release();
        require(aliases.start.y-aliases.minY>100 && aliases.samples.filter(s=>s.vy<0).every(s=>s.held),
          '松开 W 截短了仍按住 ↑ 的跳跃', aliases);

        checkpoint = '暂停取消重开不截短或重放释放';await restart();await startObservation('pause-resume');
        await key('w',true);await wait(()=>window.__raidState.vy < -300);
        await page.keyboard.press('p');await phase('pause');await key('w',false);
        const paused=await read();await frames(5);require(JSON.stringify(await read())===JSON.stringify(paused),'暂停没有冻结跳跃');
        await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
        require((await read()).vy===paused.vy && !(await read()).jumpCutEligible,'取消重开留下了截短资格');
        await activate('#start');await phase('playing');
        const resumed=await evidence('pause-resume');
        require(resumed.start.y-resumed.minY>100,'暂停时释放旧输入截短了恢复后的跳跃',resumed);
      }
      checkpoint='返回大厅与布局';await release();await activate('#pause');await phase('pause');
      await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      require(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 &&
        !document.querySelector('#controls-guide').open&&!document.querySelector('#survival-guide').open),
      '返回大厅出现横向溢出或说明自动展开');await shot('lobby');
    } catch (error) {
      problems.push('Pixel Raid 可变跳高 ' + label + '：' + checkpoint + '：' + error.message);
      const diagnostic = await page.evaluate(() => {
        const { png, ...observation } = window.__raidJumpRun ?? {};
        return { state:window.__raidState, observation, inputs:window.__raidJumpInputs };
      }).catch(error => ({error:error.message}));
      fs.writeFileSync(prefix + '-failure.json', JSON.stringify({checkpoint,error:error.message,...diagnostic},null,2) + '\n');
      await shot('failure').catch(()=>{});
    } finally { await release().catch(()=>{});await context.close(); }
  }
}
