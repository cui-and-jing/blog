/** Campaign stomp -> high rebound -> real platform/intel, using native input. */
import fs from 'node:fs';
import path from 'node:path';

export function campaignStompDamageAllowed(before, after, stompAge) {
  if (after.hp === before.hp) return after.protectionTime <= before.protectionTime;
  if (after.hp !== before.hp - 1 || after.protectionDuration !== 1.45 ||
      !(after.protectionTime > 1.2 && after.protectionTime <= 1.45)) return false;
  if (after.combatText === '敌方子弹 · 连击中断') return true;
  // A rendered frame can contain a hit BEFORE the stomp, followed by the
  // stomp replacing the HUD text. Both clocks must put the hit at least one
  // complete physics step earlier. Contact-time damage cannot pass this.
  return after.combatText.includes('空中踏击') && 1.45 - after.protectionTime >= stompAge + 1 / 60 - .00001;
}

/** Pure policy counterexamples, not browser/game-state fixtures. */
export function assertCampaignStompDamageBoundaries() {
  const before = { hp: 5, protectionTime: 0 }, age = .05;
  const base = { hp: 4, protectionDuration: 1.45, protectionTime: 1.45, combatText: '敌方子弹 · 连击中断' };
  const cases = [
    [true, { ...base }],
    [true, { ...base, combatText: '空中踏击', protectionTime: 1.45 - age - 1 / 60 }],
    [true, { ...base, hp: 5, protectionTime: 0, combatText: '空中踏击' }],
    [false, { ...base, combatText: '敌人接触 · 连击中断', protectionTime: 1.45 - age }],
    [false, { ...base, combatText: '空中踏击', protectionTime: 1.45 - age }],
    [false, { ...base, hp: 5, combatText: '空中踏击' }],
    [false, { ...base, hp: 3 }],
  ];
  for (const [expected, after] of cases) if (campaignStompDamageAllowed(before, after, age) !== expected)
    throw new Error('远征踏击伤害归因边界错误：' + JSON.stringify({ expected, before, after, age }));
}

export function assertCampaignStompRoute(fresh, proof) {
  const require = (ok, message, details) => {
    if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
  };
  const { takeoff, impact, landed, intel } = proof;
  require(takeoff && !takeoff.ground && takeoff.vy < 0 && takeoff.hp > 0 && takeoff.stomps === 0,
    '没有从原生跳跃开始远征踏击', takeoff);
  require(impact, '没有真实踏击证据');
  const { before, after, mintPixels } = impact, burst = after.stompBurst;
  const target = after.enemies[0], age = burst ? .28 - burst.time : Infinity;
  const damageAllowed = campaignStompDamageAllowed(before, after, age);
  require(before.mode === 'campaign' && after.mode === 'campaign' && after.stage === 1 && before.stomps === 0 &&
    after.stomps === 1 && before.enemies[0].type === 'walker' && before.enemies[0].hp === 3 && target?.hp === 1 &&
    after.enemies.length === before.enemies.length && after.enemies.slice(1).every((enemy, i) => enemy.hp === before.enemies[i + 1].hp),
  '普通远征没有恰好踏伤首个满血步兵2点', impact);
  require(before.vy > 0 && !before.ground && !after.ground && after.vy < 0 && after.jumpHeld && burst?.boosted === true &&
    !burst.device && age >= 0 && age < .28 && Math.abs(after.vy - (-560 + 1250 * age)) < .001 &&
    before.y + before.playerHeight <= before.enemies[0].y && after.y + after.playerHeight <= target.y &&
    Math.abs(target.stagger - (.3 - age)) < .001 &&
    (after.combatText.includes('空中踏击') || damageAllowed && after.combatText === '敌方子弹 · 连击中断'),
  '实际下降接触没有形成按住跳跃的高弹与短硬直', impact);
  // Existing enemy bullets remain dangerous during the rebound. Attribute a
  // coincident one-point hit explicitly; never accept contact damage, a lost
  // life or arbitrary damage as a successful non-damaging top collision.
  require(['lives', 'score', 'shots', 'grenades', 'reflections', 'intel', 'dashTime', 'dashCooldown', 'tacticalUses', 'tacticalCharge']
    .every(key => before[key] === after[key]) && damageAllowed && after.hp > 0 &&
    after.lives === fresh.lives && after.shots === 0 &&
    after.grenades === fresh.grenades && after.reflections === 0 && after.dashTime === 0 && after.dashCooldown === 0 &&
    after.challengeId === null && after.challengeTime === 0,
  '非致命踏击扣血、免费奖励、刷新保护或借用了其他攻击', impact);
  require(mintPixels >= 35, '实际画布缺少高弹踏击的薄荷色标记', { mintPixels, burst });
  require(landed?.ground && landed.y + landed.playerHeight === 325 && landed.x >= 480 && landed.x < 660 &&
    landed.stomps === 1 && landed.stompBurst === null && landed.enemies[0].hp === 1 && landed.lives === fresh.lives && landed.hp > 0 &&
    landed.shots === 0 && landed.grenades === fresh.grenades && landed.reflections === 0 &&
    landed.dashTime === 0 && landed.dashCooldown === 0 && landed.tacticalUses === 0 &&
    intel?.intel === 1 && intel.label === '1 / 3', '高弹没有通过真实走位登台并取得首份情报', { landed, intel });
  // Real movement collects the scatter pickup; a later enemy shot can also
  // make the nearby medkit useful. Account for those actual pickups rather
  // than attributing their legitimate points/healing to the stomp itself.
  const scored = intel.state;
  const pickupPoints = scored.pickups.filter((pickup, i) => pickup.done && !fresh.pickups[i].done).length * 75;
  require(scored.score === pickupPoints + 150 && scored.stomps === 1 && scored.enemies[0].hp === 1 &&
    scored.grenades === fresh.grenades && scored.reflections === 0 && scored.shots === 0,
  '情报或路上拾取物之外出现免费奖励', { pickupPoints, scored });
}

export async function checkRaidCampaignStomp(sourcePage, problems) {
  assertCampaignStompDamageBoundaries();
  for (const mobile of [false, true]) {
    const context = await sourcePage.browser().createBrowserContext(), page = await context.newPage();
    const label = mobile ? 'touch-320' : 'keyboard-1280', held = new Map();
    let checkpoint = '初始化';
    const require = (ok, message, details) => {
      if (!ok) throw new Error(message + (details === undefined ? '' : ' ' + JSON.stringify(details)));
    };
    const read = () => page.evaluate(() => window.__raidState);
    const wait = (description, predicate) => {
      checkpoint = description;
      return page.waitForFunction(predicate, { timeout: 6000, polling: 'raf' });
    };
    const phase = expected => page.waitForFunction(value => window.__raidState?.phase === value,
      { timeout: 5000, polling: 'raf' }, expected);
    const activate = async selector => {
      checkpoint = '操作按钮 ' + selector;
      require(held.size === 0, '菜单操作前必须释放全部游戏输入');
      const control = await page.$(selector);await control.scrollIntoView();
      if (mobile) await control.tap();else { await control.focus();await page.keyboard.press('Enter'); }
    };
    const keys = { right: 'd', left: 'a', jump: 'w' };
    const inputIndex = () => page.evaluate(() => window.__campaignStompProof.inputs.length);
    const auditTouch = async (index, action, kind, pointerId = null) => {
      await page.waitForFunction(start => window.__campaignStompProof.inputs.slice(start).some(input =>
        ['pointerdown', 'pointerup', 'pointercancel'].includes(input.type)), { timeout: 2000, polling: 'raf' }, index);
      const audit = await page.evaluate(start => ({
        events: window.__campaignStompProof.inputs.slice(start).filter(input => ['pointerdown', 'pointerup', 'pointercancel'].includes(input.type)),
        state: window.__raidState,
        active: [...document.querySelectorAll('[data-action].active')].map(element => element.dataset.action).sort()
      }), index);
      const event = audit.events[0], actions = [...held.keys()].sort();
      require(audit.events.length === 1 && event.trusted && event.action === action &&
        (kind === 'down' ? event.type === 'pointerdown' && Number.isInteger(event.pointerId) :
          ['pointerup', 'pointercancel'].includes(event.type) && event.pointerId === pointerId) &&
        audit.state.phase === 'playing' && audit.state.touchCount === held.size && JSON.stringify(audit.active) === JSON.stringify(actions),
      '原生触控身份或剩余触点错误', { action, kind, actions, audit });
      return event.pointerId;
    };
    const down = async action => {
      if (held.has(action)) return;
      checkpoint = '按住 ' + action;
      if (mobile) {
        const point = await page.$eval(`[data-action="${action}"]`, element => {
          element.closest('.controls').scrollIntoView({ block: 'end', behavior: 'instant' });
          const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { x, y, w: r.width, h: r.height, hit: hit === element || element.contains(hit) };
        });
        require(point.hit && point.w >= 42 && point.h >= 44 && point.x > 0 && point.x < 320 && point.y > 0 && point.y < 844,
          '触控目标不可达', { action, point });
        const index = await inputIndex(), contact = { handle: await page.touchscreen.touchStart(point.x, point.y), pointerId: null };
        held.set(action, contact);contact.pointerId = await auditTouch(index, action, 'down');
      } else { await page.keyboard.down(keys[action]);held.set(action, true); }
    };
    const up = async action => {
      if (!held.has(action)) return;
      checkpoint = '释放 ' + action;
      if (mobile) {
        const index = await inputIndex(), contact = held.get(action);
        await contact.handle.end();held.delete(action);await auditTouch(index, action, 'up', contact.pointerId);
      } else { await page.keyboard.up(keys[action]);held.delete(action); }
    };
    const release = async () => { for (const action of [...held.keys()]) await up(action); };
    const file = suffix => path.join(process.cwd(), '.shots', `pixelraid-campaign-stomp-${label}-${suffix}`);
    const shot = suffix => page.screenshot({ path: file(suffix + '.png'), fullPage: true });
    const saveCanvases = async () => {
      const canvases = await page.evaluate(() => window.__campaignStompCanvases ?? {});
      for (const [name, image] of Object.entries(canvases)) fs.writeFileSync(file(name + '.png'), Buffer.from(image, 'base64'));
      return canvases;
    };
    page.on('pageerror', error => problems.push(`Pixel Raid 远征踏击 ${label}：${error.message}`));
    try {
      await page.setViewport({ width: mobile ? 320 : 1280, height: mobile ? 844 : 960,
        deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(() => {
        const proof = window.__campaignStompProof = { inputs: [], takeoff: null, impact: null, landed: null, intel: null, flight: [] };
        const canvases = window.__campaignStompCanvases = {};
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'click']) document.addEventListener(type, event => {
          const target = event.target.closest?.('[data-action], button');
          proof.inputs.push({ type, key: event.key, action: target?.dataset.action, id: target?.id,
            pointerId: event.pointerId, trusted: event.isTrusted, repeat: !!event.repeat, phase: window.__raidState?.phase });
        }, true);
        let previous;
        const capture = name => {
          if (!canvases[name]) canvases[name] = document.getElementById('field').toDataURL('image/png').split(',')[1];
        };
        function observe() {
          const state = window.__raidState;
          if (state?.phase === 'playing' && previous?.phase === 'playing') {
            if (!proof.takeoff && previous.ground && !state.ground && state.vy < 0) proof.takeoff = state;
            if (proof.takeoff && !proof.landed) proof.flight.push({ clock: state.clock, x: state.x, y: state.y,
              vy: state.vy, ground: state.ground, hp: state.hp, stomps: state.stomps, intel: state.intel });
            if (!proof.impact && state.stomps > previous.stomps) {
              const canvas = document.getElementById('field'), burst = state.stompBurst;
              let mintPixels = 0;
              if (burst) {
                const pixels = canvas.getContext('2d').getImageData(Math.floor(burst.x - state.cam - 29), Math.floor(burst.y - 36), 58, 47).data;
                for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 185 && pixels[i + 1] === 255 && pixels[i + 2] === 226) mintPixels++;
              }
              proof.impact = { before: previous, after: state, mintPixels };capture('impact');
            }
            if (proof.impact && !proof.landed && state.ground && state.y + state.playerHeight === 325) {
              proof.landed = state;capture('platform');
            }
            if (proof.impact && !proof.intel && state.intel === 1) {
              proof.intel = { intel: state.intel, label: document.getElementById('intel').textContent, state };capture('intel');
            }
          }
          previous = state;requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      });
      await page.goto(sourcePage.url(), { waitUntil: 'domcontentloaded' });await page.bringToFront();
      await wait('等待游戏初始化', () => window.__raidReady);
      require(await page.evaluate(() => !('__raidQA' in window)), '发布页出现可写测试入口');
      const lobby = await read();
      require(lobby.phase === 'title' && lobby.difficulty === 'standard' && lobby.unlocked === 1, '路线不是全新标准存档', lobby);
      await activate('#start');await phase('playing');
      const fresh = await read();
      require(fresh.mode === 'campaign' && fresh.stage === 1 && fresh.hp === 5 && fresh.lives === 3 && fresh.x === 64 &&
        fresh.shots === 0 && fresh.grenades === 3 && fresh.stomps === 0 && fresh.enemies[0].hp === 3, '未从真实远征出生点开始', fresh);
      await down('right');await wait('走到首个步兵前起跳', () => window.__raidState.x >= 280);await down('jump');
      // This is a native feedback controller, not a scene fixture. Wait for a
      // direction change or the actual impact inside the page, then dispatch
      // only a real keyboard/pointer action from Puppeteer. Keep jump held.
      const deadline = Date.now() + 6000;
      for (;;) {
        checkpoint = '真实空中走位对齐首个步兵';
        require(Date.now() < deadline, '原生对齐没有在限定时间内完成');
        const direction = held.has('right') ? 'right' : held.has('left') ? 'left' : null;
        const handle = await page.waitForFunction(current => {
          const s = window.__raidState;
          if (window.__campaignStompProof.impact) return { impact: true };
          if (s.phase !== 'playing') return { error: s.phase };
          const enemy = s.enemies[0], dx = enemy.x + enemy.w / 2 - (s.x + 13.5);
          const desired = dx > 10 ? 'right' : dx < -10 ? 'left' : null;
          return desired !== current ? { desired } : false;
        }, { timeout: 5000, polling: 'raf' }, direction);
        const next = await handle.jsonValue();await handle.dispose();
        require(!next.error, '对齐期间离开战斗', next);
        if (next.impact) break;
        if (next.desired !== 'left') await up('left');
        if (next.desired !== 'right') await up('right');
        // Contact may happen during a native release/acknowledgement. Do not
        // send a stale opposite-direction command after the rebound starts.
        if (await page.evaluate(() => window.__raidState.stomps > 0)) break;
        if (next.desired) await down(next.desired);
      }
      await up('left');await down('right');
      await wait('用高弹向第一平台与情报移动', () => window.__raidState.x >= 520);
      await up('right');await up('jump');
      await wait('等待真实落台及情报记录', () => window.__campaignStompProof.landed && window.__campaignStompProof.intel);
      const proof = await page.evaluate(() => window.__campaignStompProof);
      fs.writeFileSync(file('route.json'), JSON.stringify({ fresh, proof }, null, 2));
      const canvases = await saveCanvases();
      checkpoint = '验证非致命踏击与可玩收益';assertCampaignStompRoute(fresh, proof);
      require(['impact', 'platform', 'intel'].every(name => canvases[name]), '缺少真实踏击、平台或情报画布');
      const gameplay = proof.inputs.filter(event => mobile ? event.action && event.type.startsWith('pointer') :
        ['keydown', 'keyup'].includes(event.type) && event.phase === 'playing' &&
          !(event.key === 'Enter' && event.type === 'keyup')); // Native Start-button release is not gameplay.
      const names = mobile ? ['left', 'right', 'jump'] : ['a', 'd', 'w'];
      require(proof.inputs.every(event => event.trusted) && gameplay.every(event => !event.repeat && names.includes(mobile ? event.action : event.key)),
        '路线使用了原生方向/跳跃之外的攻击或合成事件', gameplay);
      for (const action of names) {
        const events = gameplay.filter(event => (mobile ? event.action : event.key) === action);
        const downs = events.filter(event => event.type === (mobile ? 'pointerdown' : 'keydown')).length;
        const ups = events.filter(event => mobile ? ['pointerup', 'pointercancel'].includes(event.type) : event.type === 'keyup').length;
        require(downs === ups && (action !== (mobile ? 'jump' : 'w') || downs === 1), '原生方向或跳跃没有独立完整释放', { action, events });
      }
      await activate('#pause');await phase('pause');const paused = await read();await shot('platform-paused');
      await new Promise(resolve => setTimeout(resolve, 180));
      require(JSON.stringify(await read()) === JSON.stringify(paused), '暂停仍推进敌人或踏击状态');
      await activate('#restart');await phase('confirmRestart');await activate('#cancel-restart');await phase('pause');
      require(JSON.stringify(await read()) === JSON.stringify(paused), '取消重开改变了踏击路线');
      await activate('#restart');await phase('confirmRestart');await activate('#start');await phase('playing');
      const retry = await read();
      require(retry.stomps === 0 && retry.stompBurst === null && retry.intel === 0 && retry.score === 0 && retry.hp === 5 && retry.lives === 3 &&
        retry.x === 64 && retry.enemies[0].hp === 3 && retry.enemies[0].stagger === 0 && retry.shots === 0 && retry.grenades === 3 &&
        retry.reflections === 0 && retry.dashCooldown === 0 && retry.touchCount === 0, '重开残留踏击、敌伤、情报或原生输入', retry);
      await activate('#pause');await phase('pause');await activate('#menu-home');await phase('confirmRestart');await activate('#start');await phase('title');
      require(await page.evaluate(() => !document.querySelector('#controls-guide').open && !document.querySelector('#survival-guide').open &&
        document.querySelector('#result-details').hidden && document.querySelectorAll('[data-action].active').length === 0 &&
        document.documentElement.scrollWidth <= innerWidth + 1), '大厅残留展开内容、触点或横向溢出');await shot('lobby');
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({ state: window.__raidState, proof: window.__campaignStompProof })).catch(() => null);
      fs.writeFileSync(file('error.json'), JSON.stringify({ checkpoint, error: error.message, diagnostic }, null, 2));
      await saveCanvases().catch(() => {});
      problems.push(`Pixel Raid 远征踏击 ${label}：${checkpoint}：${error.message.slice(0, 1200)}（完整证据见 ${path.basename(file('error.json'))}）`);
      await shot('error').catch(() => {});
    } finally { await release().catch(() => {});await context.close(); }
  }
}
