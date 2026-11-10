/**
 * Pixel Raid expedition contracts.
 *
 * Runs the actual unminified IIFE with a deterministic clock, seeded randomness
 * and a minimal DOM. The private evaluator is injected in this in-memory copy
 * only; the published game has no mutable test API. Browser smoke separately
 * checks the real DOM, layout, storage, keyboard and touch controls.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../public/games/pixelraid.html', import.meta.url), 'utf8');
const inline = source.match(/<script>\s*([\s\S]*?)<\/script>/i)?.[1];
assert(inline, 'Pixel Raid must contain an inline game script');
const entry = "resetStage(0,null);phase='title';hud();draw();window.__raidReady=true;requestAnimationFrame(loop);";
assert.equal(inline.split(entry).length, 2, 'Exact game initialization anchor changed');
assert(!source.includes('__raidQA'), 'Mutable test hooks must never be published');
const injected = inline.replace(entry, 'window.__raidQA = code => eval(code);' + entry);
const STORE = 'pixel-raid.progress.v1';

function createGame({ storage = {}, blocked = false, reducedMotion = false } = {}) {
  const nodes = new Map(), events = new Map(), documentEvents = new Map();
  const values = new Map(Object.entries(storage));
  let queued = null, now = 0, seed = 16437, gamepads = [];
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const attrsFrom = (text) => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)]
    .map((match) => [match[1], match[2] ?? '']));
  const matches = (element, selector) => {
    if (selector.startsWith('#')) return element.id === selector.slice(1);
    if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
    const match = selector.match(/^\[([^=\]]+)(?:="?([^"\]]+)"?)?\]$/);
    return match ? Object.hasOwn(element.attributes, match[1]) &&
      (match[2] === undefined || element.attributes[match[1]] === match[2]) : element.tagName === selector.toUpperCase();
  };
  function node(id, attrs = {}, tag = 'div') {
    if (!nodes.has(id)) {
      const listeners = new Map(), classes = new Set();
      const item = {
        id, tagName: tag.toUpperCase(), hidden: Object.hasOwn(attrs, 'hidden'),
        disabled: Object.hasOwn(attrs, 'disabled'), textContent: '', innerHTML: '',
        attributes: { ...attrs }, style: {}, dataset: {},
        classList: {
          add: (...names) => names.forEach((name) => classes.add(name)),
          remove: (...names) => names.forEach((name) => classes.delete(name)),
          contains: (name) => classes.has(name),
          toggle(name, force) { const on = force ?? !classes.has(name); on ? classes.add(name) : classes.delete(name); return on; },
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        removeAttribute(name) { delete this.attributes[name]; },
        addEventListener(name, callback) {
          if (!listeners.has(name)) listeners.set(name, []);
          listeners.get(name).push(callback);
        },
        dispatch(name, options = {}) {
          if (name === 'click' && this.disabled) return;
          const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...options };
          for (const callback of listeners.get(name) ?? []) callback(event);
        },
        click() { this.dispatch('click'); },
        blur() { if (document.activeElement === this) document.activeElement = null; },
        focus() { document.activeElement = this; },
        setPointerCapture() {}, releasePointerCapture() {},
        querySelectorAll(selector) { return [...nodes.values()].filter((candidate) => candidate !== this && matches(candidate, selector)); },
      };
      for (const [name, value] of Object.entries(attrs)) {
        if (name.startsWith('data-')) item.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
      for (const name of (attrs.class ?? '').split(/\s+/).filter(Boolean)) classes.add(name);
      nodes.set(id, item);
    }
    return nodes.get(id);
  }
  for (const [_, tag, text] of source.matchAll(/<([a-z][\w-]*)\s+([^>]+)>/gi)) {
    const attrs = attrsFrom(text);
    if (attrs.id || attrs['data-action'] || attrs['data-upgrade'] || attrs['data-stage'] || attrs['data-difficulty']) {
      node(attrs.id ?? `${tag}-${nodes.size}`, attrs, tag);
    }
  }
  const graphics = new Proxy({}, { get: (target, name) => target[name] ?? (() => {}), set: (target, name, value) => { target[name] = value; return true; } });
  node('field').getContext = () => graphics;
  const document = {
    getElementById: node,
    querySelectorAll: (selector) => [...nodes.values()].filter((item) => matches(item, selector)),
    querySelector: (selector) => [...nodes.values()].find((item) => matches(item, selector)) ?? null,
    addEventListener(name, callback) { documentEvents.set(name, callback); },
    activeElement: null, hidden: false,
  };
  const win = { addEventListener(name, callback) { events.set(name, callback); }, matchMedia: () => ({ matches: reducedMotion }) };
  const math = Object.create(Math);
  math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const localStorage = {
    getItem(key) { if (blocked) throw new Error('Storage denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage denied'); values.set(key, String(value)); },
    removeItem(key) { if (blocked) throw new Error('Storage denied'); values.delete(key); },
  };
  const context = {
    window: win, document, Math: math, localStorage,
    performance: { now: () => now }, requestAnimationFrame: (callback) => { queued = callback; },
    navigator: { getGamepads: () => gamepads },
    setTimeout: (fn) => fn(), clearTimeout() {}, console,
  };
  vm.runInNewContext(injected, context, { timeout: 5000 });
  assert(win.__raidReady && win.__raidQA, 'Game failed to initialize');
  const game = {
    win, nodes, values, document,
    state: () => clone(win.__raidState),
    read: (code) => clone(win.__raidQA(code)),
    run: (code) => win.__raidQA(code),
    frames(count = 1) {
      for (let i = 0; i < count; i++) {
        const current = queued;
        assert.equal(typeof current, 'function', 'Animation loop stopped');
        queued = null; now += 1000 / 60; current(now);
      }
    },
    key(key, down = true, repeat = false) {
      events.get(down ? 'keydown' : 'keyup')?.({ key, repeat, target: document.activeElement, preventDefault() {} });
    },
    click(id) { assert(nodes.has(id), 'Missing DOM node #' + id); node(id).click(); },
    event(name) { events.get(name)?.(); },
    visibility(hidden) { document.hidden = hidden; documentEvents.get('visibilitychange')?.(); },
    pad(buttons = [], axes = [0, 0]) {
      gamepads = [{ connected: true, axes, buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: buttons.includes(index) })) }];
    },
    noPad() { gamepads = []; },
    safe() { game.run('player.inv=100; enemies.forEach(e=>e.dead=true);'); },
    start() { game.click('start'); game.safe(); game.frames(2); },
    nearBoss() { game.run('player.x=boss.x-190; player.y=G-player.h; player.vy=0; player.ground=true; player.inv=100; cam=clamp(player.x-290,0,stage.width-W);'); },
    exit() { game.run('player.x=stage.width-95; player.y=G-player.h; player.vy=0; player.ground=true; player.inv=100;'); },
    clear() { game.exit(); game.run('damageBoss(boss.hp)'); game.frames(3); },
  };
  return game;
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); }
function near(actual, expected, message) { assert(Math.abs(actual - expected) < 0.00001, message ?? `${actual} != ${expected}`); }
const countBits = (mask) => [1, 2, 4].filter((bit) => mask & bit).length;
function until(game, predicate, limit = 400) {
  for (let frame = 0; frame < limit && !predicate(); frame++) game.frames(1);
  assert(predicate(), 'Timed out waiting for deterministic state: ' + JSON.stringify(game.state()));
}

// Keep the old combat contracts: these are easy to accidentally regress when
// adding choices, input buffering and campaign state around the update loop.
test('title initializes safely with no published mutable API', () => {
  const g = createGame();
  eq(g.state().phase, 'title'); eq(g.state().stage, 1);
  const snapshot = g.win.__raidState;
  try { snapshot.hp = -999; } catch {}
  assert(g.state().hp > 0, 'Mutating a state snapshot must not affect gameplay');
});
test('rifle, reachable scatter pickup and timed weapon expiry', () => {
  const g = createGame(); g.start();
  eq(g.state().weapon, 'rifle');
  g.key('j'); g.frames(4); g.key('j', false);
  eq(g.state().lastVolley, 1); assert(g.state().shots >= 1);
  g.key('d'); g.frames(54); g.key('d', false);
  assert(g.state().x > 260 && g.state().weapon === 'spread' && g.state().weaponTime > 10);
  g.key('j'); g.frames(20); g.key('j', false);
  eq(g.state().lastVolley, 3); assert(g.state().shots >= 4);
  g.frames(760); eq(g.state().weapon, 'rifle'); eq(g.state().weaponTime, 0);
});
test('boss one telegraphs and changes from one to three bullets in rage', () => {
  const g = createGame(); g.start(); g.frames(760); g.nearBoss();
  g.frames(30); assert(g.state().bossCharge > 0); eq(g.state().bossAttacks, 0);
  g.frames(50); assert(g.state().bossAttacks >= 1); eq(g.state().bossLastVolley, 1);
  g.run('boss.hp=Math.ceil(boss.maxHp*.4)'); g.frames(190);
  assert(g.state().bossRage && g.state().bossAttacks >= 2); eq(g.state().bossLastVolley, 3);
});

test('three stages have three intel pickups and safe checkpoint geometry', () => {
  const g = createGame();
  eq(g.read('STAGES.length'), 3);
  for (let index = 0; index < 3; index++) {
    g.run(`resetStage(${index},null); phase='playing'; player.inv=100; enemies.forEach(e=>e.dead=true);`);
    eq(g.read('intel.length'), 3, `stage ${index + 1} intel count`);
    const positions = g.read('intel.map(p=>[p.x,p.y])');
    eq(new Set(positions.map(([x, y]) => `${x},${y}`)).size, 3, 'Intel locations must be distinct');
    for (let x = 70; x < g.read('stage.width') - 390; x += 80) {
      g.run(`player.x=${x}; player.y=G-player.h; player.ground=true; player.vy=0; update(DT);`);
      const checkpoint = g.read('player.checkpoint');
      assert(g.read(`!isGap(${checkpoint}+player.w/2)`), `stage ${index + 1} unsafe checkpoint ${checkpoint}`);
    }
  }
});

test('intel is collected through collision once and resets for a new stage', () => {
  const g = createGame(); g.start();
  const before = g.read('points');
  for (let index = 0; index < 3; index++) {
    g.run(`player.x=intel[${index}].x-player.w/2; player.y=intel[${index}].y-player.h/2; player.vy=0; player.inv=100;`);
    g.frames(2);
    eq(g.state().intel, index + 1);
  }
  const collected = g.read('points'); assert(collected > before);
  g.frames(2); eq(g.read('points'), collected, 'Collected intel must not award points twice');
  g.clear(); eq(g.state().stageStars, 7, 'Clear + all intel + no lost lives should award all three stars');
  g.click('upgrade-rapid'); g.click('start');
  eq(g.state().stage, 2); eq(g.state().intel, 0);
});

test('three-stage campaign, locked exits and exactly-once upgrade selection', () => {
  const g = createGame(); g.start(); g.exit(); g.frames(3);
  eq(g.state().phase, 'playing', 'Boss must guard the exit');
  g.clear(); eq(g.state().phase, 'stageClear'); eq(g.state().unlocked, 2);
  eq(g.state().stageStars, 5, 'Missing intel should not award collection star');
  g.click('start'); eq(g.state().stage, 1, 'Cannot advance without a tactical choice');
  g.click('upgrade-rapid'); g.click('upgrade-rapid'); g.click('upgrade-armor');
  eq(g.state().upgrades, { rapid: 0, dash: 0, armor: 0 }, 'Selection must not apply upgrade early');
  g.click('start'); g.click('start');
  eq(g.state().stage, 2); eq(g.state().phase, 'playing'); eq(g.state().upgrades.armor, 1);
  eq(g.state().maxHp, 6); eq(g.state().hp, 6);
  g.safe(); g.nearBoss(); g.frames(150);
  assert(g.state().bossAttacks >= 1); eq(g.state().bossLastVolley, 3);
  g.run('boss.hp=Math.ceil(boss.maxHp*.4)'); g.frames(190);
  eq(g.state().bossLastVolley, 5); assert(g.state().bossRage);
  g.clear(); eq(g.state().phase, 'stageClear'); eq(g.state().unlocked, 3);
  g.click('upgrade-dash'); g.click('start');
  eq(g.state().stage, 3); eq(g.state().upgrades.dash, 1); eq(g.state().upgrades.armor, 1);
  g.safe(); g.nearBoss(); g.frames(160);
  assert(g.state().bossAttacks >= 1); eq(g.state().bossLastVolley, 0, 'Reactor opens with a beam');
  until(g, () => g.state().bossLastVolley === 3);
  g.run('boss.hp=Math.ceil(boss.maxHp*.4)');
  until(g, () => g.state().bossLastVolley === 5);
  assert(g.state().bossRage);
  g.clear(); eq(g.state().phase, 'victory'); eq(g.state().stage, 3);
  const points = g.read('points'); g.frames(120); eq(g.read('points'), points, 'Victory bonus must be awarded once');
  const saved = JSON.parse(g.values.get(STORE));
  eq(saved.unlocked, 3); assert(saved.campaign.standard.best > 0);
  eq(saved.campaign.standard.stars.map(countBits), [2, 2, 2]);
  g.click('start'); eq(g.state().stage, 1); eq(g.state().phase, 'playing');
  eq(g.state().upgrades, { rapid: 0, dash: 0, armor: 0 });
});

test('damage versus death star, checkpoint respawn and game-over retry', () => {
  const g = createGame(); g.start();
  g.run('player.inv=0; hurt(1)'); eq(g.state().stageDeaths, 0);
  g.clear(); eq(g.state().stageStars, 5, 'Taking damage alone must not remove the no-death star');
  const retry = createGame(); retry.start();
  retry.run('player.checkpoint=1100; player.inv=0; hurt(player.hp)');
  eq(retry.state().lives, 2); eq(retry.state().stageDeaths, 1); eq(retry.state().x, 1100);
  assert(retry.state().hp > 0 && retry.state().ground);
  retry.clear(); eq(retry.state().stageStars, 1, 'A lost life must remove the no-death star');
  const fail = createGame(); fail.start();
  for (let i = 0; i < 3; i++) fail.run('player.inv=0; hurt(player.hp)');
  eq(fail.state().phase, 'gameOver'); eq(fail.state().lives, 0);
  fail.click('start');
  eq(fail.state().phase, 'playing'); eq(fail.state().lives, 3); eq(fail.state().stageDeaths, 0);
  eq(fail.state().hp, 5); eq(fail.state().shots, 0); eq(fail.state().intel, 0);
});

function storedProgress(overrides = {}) {
  return {
    version: 1, unlocked: 1, selectedDifficulty: 'standard',
    campaign: { standard: { best: 0, stars: [0, 0, 0] }, relaxed: { best: 0, stars: [0, 0, 0] } },
    practice: { standard: { best: 0, stars: [0, 0, 0] }, relaxed: { best: 0, stars: [0, 0, 0] } },
    ...overrides,
  };
}

test('relaxed difficulty has separate records and explicit extra resources', () => {
  const g = createGame(); g.click('difficulty-relaxed'); g.start();
  eq(g.state().difficulty, 'relaxed'); eq(g.state().hp, 6); eq(g.state().maxHp, 6); eq(g.state().lives, 4);
  g.clear();
  const saved = JSON.parse(g.values.get(STORE));
  eq(saved.selectedDifficulty, 'relaxed'); eq(saved.campaign.relaxed.stars[0], 5);
  eq(saved.campaign.standard.stars, [0, 0, 0]);
  const reloaded = createGame({ storage: { [STORE]: g.values.get(STORE) } });
  eq(reloaded.state().difficulty, 'relaxed'); eq(reloaded.state().unlocked, 2);
  reloaded.click('difficulty-standard'); reloaded.start();
  eq(reloaded.state().hp, 5); eq(reloaded.state().lives, 3); eq(reloaded.state().difficulty, 'standard');
});

test('locked practice is rejected and unlocked practice cannot alter campaign records', () => {
  const locked = createGame(); locked.run('startPractice(2)');
  eq(locked.state().phase, 'title'); eq(locked.state().stage, 1);
  const saved = storedProgress({ unlocked: 3 });
  saved.campaign.standard = { best: 12345, stars: [7, 5, 1] };
  const g = createGame({ storage: { [STORE]: JSON.stringify(saved) } });
  g.click('stage-2'); g.safe();
  eq(g.state().phase, 'playing'); eq(g.state().mode, 'practice'); eq(g.state().stage, 2);
  eq(g.state().upgrades, { rapid: 0, dash: 0, armor: 0 });
  g.clear(); eq(g.state().phase, 'practiceClear');
  const record = JSON.parse(g.values.get(STORE));
  eq(record.unlocked, 3); eq(record.campaign, saved.campaign);
  eq(record.practice.standard.stars[1], 5); assert(record.practice.standard.best > 0);
  g.click('start');
  eq(g.state().mode, 'practice'); eq(g.state().stage, 2); eq(g.state().phase, 'playing');
});

test('best score and best simultaneous stars never degrade on a weaker run', () => {
  const saved = storedProgress({ unlocked: 3 });
  saved.campaign.standard = { best: 98765, stars: [7, 5, 3] };
  const g = createGame({ storage: { [STORE]: JSON.stringify(saved) } }); g.start();
  g.run('player.inv=0; hurt(player.hp)'); g.clear();
  const after = JSON.parse(g.values.get(STORE));
  eq(after.campaign.standard.best, 98765); eq(after.campaign.standard.stars, [7, 5, 3]);
  const snapshot = g.win.__raidState;
  try { snapshot.progress.campaign.standard.stars[0] = 0; snapshot.upgrades.armor = 99; } catch {}
  eq(g.state().progress.campaign.standard.stars[0], 7); eq(g.state().upgrades.armor, 0);
});

test('malformed, out-of-range and prototype-shaped stored progress is sanitized', () => {
  const records = [
    'not JSON', 'null', '[]', '42', '{}',
    JSON.stringify({ version: 999, unlocked: 99, selectedDifficulty: 'impossible' }),
    '{"version":1,"unlocked":-9,"selectedDifficulty":"relaxed","campaign":{"standard":{"best":-50,"stars":[99,-1,"7"]}},"practice":null,"__proto__":{"polluted":true}}',
    JSON.stringify({ ...storedProgress(), unlocked: 99, campaign: { standard: { best: 'Infinity', stars: [7, {}, null, 999] } } }),
  ];
  for (const raw of records) {
    const g = createGame({ storage: { [STORE]: raw, 'pixel-raid.best': 'Infinity' } });
    eq(g.state().phase, 'title'); assert(Number.isInteger(g.state().unlocked) && g.state().unlocked >= 1 && g.state().unlocked <= 3);
    assert(['standard', 'relaxed'].includes(g.state().difficulty));
    const progress = g.state().progress;
    for (const mode of ['campaign', 'practice']) for (const difficulty of ['standard', 'relaxed']) {
      const record = progress[mode][difficulty];
      assert(Number.isFinite(record.best) && record.best >= 0);
      eq(record.stars.length, 3);
      assert(record.stars.every((value) => Number.isInteger(value) && value >= 0 && value <= 7));
    }
    g.start(); assert(g.state().hp > 0 && Number.isFinite(g.read('best')));
  }
  eq({}.polluted, undefined);
});

test('blocked localStorage preserves a fully playable campaign in memory', () => {
  const g = createGame({ blocked: true });
  eq(g.state().storageAvailable, false);
  g.start(); g.clear(); eq(g.state().phase, 'stageClear'); eq(g.state().unlocked, 2);
  g.click('upgrade-rapid'); g.click('start'); eq(g.state().stage, 2);
  eq(g.state().upgrades.rapid, 1); eq(g.values.size, 0);
});

test('pause freezes every gameplay timer and clears queued keyboard actions', () => {
  const g = createGame(); g.start();
  g.run('player.weaponTime=8; player.boost=7; player.inv=6;');
  g.key('k'); g.frames(2); g.key('k', false);
  g.key('l'); g.frames(2); g.key('l', false);
  g.key('d'); g.key('j'); g.frames(2); g.key('p');
  eq(g.state().phase, 'pause');
  const timers = () => g.read('({clock,weapon:player.weaponTime,boost:player.boost,inv:player.inv,shoot:player.shoot,boss:boss.phase,bombs:bombs.map(b=>b.timer),dash:player.dashTime,cooldown:player.dashCooldown})');
  const frozen = timers(), paused = g.state();
  for (const key of ['w', 'k', 'l', 'j']) g.key(key);
  g.frames(180); eq(timers(), frozen); eq(g.state().x, paused.x); eq(g.state().shots, paused.shots);
  g.key('p'); g.frames(3);
  eq(g.state().phase, 'playing'); eq(g.state().shots, paused.shots); eq(g.state().grenades, paused.grenades);
  assert(g.read('held.size===0 && touch.size===0'), 'Pause/resume must clear stale held and touch controls');
});

test('blur and hidden-document interruptions clear touch styles and inputs', () => {
  for (const interrupt of ['blur', 'hidden']) {
    const g = createGame(); g.start();
    const button = [...g.nodes.values()].find((item) => item.dataset.action === 'right');
    button.dispatch('pointerdown', { pointerId: 8 });
    g.key('j'); g.frames(3); assert(g.state().touchCount > 0);
    if (interrupt === 'blur') g.event('blur'); else g.visibility(true);
    eq(g.state().phase, 'pause'); eq(g.state().touchCount, 0);
    assert(!button.classList.contains('active'), `${interrupt} left a pressed touch style`);
    g.click('start'); const before = g.state(); g.frames(5);
    eq(g.state().x, before.x); eq(g.state().shots, before.shots);
  }
});

test('crouching changes collision height and avoids an upper-body projectile', () => {
  const standing = createGame(); standing.start();
  standing.run("player.inv=0; projectile(player.x+12,G-36,0,0,'e')"); standing.frames(2);
  eq(standing.state().hp, 4, 'Standing target should be hit by the control bullet');
  const crouched = createGame(); crouched.start(); crouched.key('s'); crouched.frames(2);
  crouched.run("player.inv=0; projectile(player.x+12,G-36,0,0,'e')"); crouched.frames(2);
  eq(crouched.state().hp, 5, 'Crouching must dodge the same upper-body bullet');
  crouched.run('bullets=[]'); crouched.key('s', false); crouched.frames(2);
  crouched.run("player.inv=0; projectile(player.x+12,G-36,0,0,'e')"); crouched.frames(2);
  eq(crouched.state().hp, 4, 'Standing up must restore the full hitbox');
});

test('dash is directional, briefly active and cannot bypass its cooldown', () => {
  const g = createGame(); g.start(); const x = g.state().x;
  g.key('l'); g.frames(3); g.key('l', false);
  assert(g.state().x > x + 20); assert(g.state().dashTime > 0 && g.state().dashCooldown > 0);
  const initialCooldown = g.state().dashCooldown;
  g.frames(20); eq(g.state().dashTime, 0);
  g.key('l'); g.frames(2); g.key('l', false);
  eq(g.state().dashTime, 0); assert(g.state().dashCooldown < initialCooldown);
  g.frames(180); eq(g.state().dashCooldown, 0);
  g.run('player.face=-1'); const right = g.state().x;
  g.key('Shift'); g.frames(3); g.key('Shift', false);
  assert(g.state().x < right - 20); assert(g.state().dashTime > 0);
});

test('coyote jump works after stepping off a platform, with no unlimited air jumps', () => {
  const g = createGame(); g.start();
  g.run('player.x=650; player.y=325-player.h; player.vy=0; player.ground=true;');
  g.key('d'); g.frames(4); g.key('d', false);
  assert(!g.state().ground, 'Test must walk off the platform edge');
  g.key('w'); g.frames(2); g.key('w', false);
  assert(g.read('player.vy') < -400, 'Coyote window should allow a jump after leaving support');
  g.frames(10); const speed = g.read('player.vy');
  g.key('w'); g.frames(2); g.key('w', false);
  assert(g.read('player.vy') > speed, 'Second midair press must not reset the jump');
});

test('jump input just before landing is buffered into a real jump', () => {
  const g = createGame(); g.start();
  g.run('player.x=80; player.y=G-player.h-7; player.vy=300; player.ground=false;');
  g.frames(10); // Clear any initial grounded grace before arranging the landing.
  g.run('player.y=G-player.h-7; player.vy=300; player.ground=false; player.coyote=0;');
  g.key('w'); g.key('w', false); g.frames(5);
  assert(g.read('player.vy') < -350 && !g.state().ground, 'Buffered jump should fire on the landing');
});

test('restart and return-home confirmations preserve or discard the right run', () => {
  const g = createGame(); g.start(); g.key('d'); g.frames(20); g.key('d', false);
  const x = g.state().x;
  g.key('r'); eq(g.state().phase, 'confirmRestart'); g.frames(120); eq(g.state().x, x);
  g.click('cancel-restart'); eq(g.state().phase, 'playing'); eq(g.state().x, x);
  g.key('r'); g.click('start'); eq(g.state().phase, 'playing'); eq(g.state().x, 64);
  g.safe(); g.clear(); g.click('upgrade-dash');
  g.click('restart'); eq(g.state().phase, 'confirmRestart');
  g.click('cancel-restart'); eq(g.state().phase, 'stageClear'); eq(g.state().selectedUpgrade, 'dash');
  g.click('start'); eq(g.state().stage, 2); eq(g.state().upgrades.dash, 1);
  g.key('p'); g.click('menu-home'); eq(g.state().phase, 'confirmRestart');
  g.click('start'); eq(g.state().phase, 'title');
  g.click('start'); eq(g.state().stage, 1); eq(g.state().upgrades.dash, 0);
});

test('menu choice keys never leak jump, grenade, fire or dash into the next run', () => {
  const g = createGame();
  for (const key of ['w', 'j', 'k', 'l', 'd']) g.key(key);
  g.start(); g.frames(6);
  eq(g.state().x, 64); eq(g.state().shots, 0); eq(g.state().grenades, 3); eq(g.state().dashTime, 0); assert(g.state().ground);
  g.clear();
  for (const key of ['w', 'j', 'k', 'l', 'd']) g.key(key);
  g.click('upgrade-rapid'); g.click('start'); g.safe(); g.frames(6);
  eq(g.state().x, 64); eq(g.state().shots, 0); eq(g.state().grenades, 3); eq(g.state().dashTime, 0); assert(g.state().ground);
});

test('gamepad provides dash and edge-triggered pause without phantom resume actions', () => {
  const g = createGame(); g.start();
  g.pad(); g.frames(2); g.pad([4]); g.frames(3); assert(g.state().dashTime > 0 && g.state().dashCooldown > 0);
  g.pad(); g.frames(20); g.pad([9]); g.frames(4); eq(g.state().phase, 'pause');
  g.frames(120); eq(g.state().phase, 'pause', 'Holding Start must not toggle repeatedly');
  g.pad(); g.frames(2); g.pad([9]); g.frames(2); eq(g.state().phase, 'playing');
  g.pad(); g.frames(3); assert(g.state().touchCount === 0);
});

// A real control replay, not pickup teleportation: enemies alone are disabled to
// isolate level geometry. All nine optional intel routes must remain reachable
// with standard resources and no tactical upgrades. Stage two intentionally
// chains a platform jump and an apex dash to cross its widest elevated gap.
test('all nine intel are reachable from spawn through real jump/dash input', () => {
  for (let index = 0; index < 3; index++) {
    const g = createGame();
    g.run(`resetStage(${index},null); phase='playing'; enemies.forEach(enemy=>enemy.dead=true); player.inv=10000;`);
    function runTo(x) {
      g.key('d'); until(g, () => g.state().x >= x, 400); g.key('d', false);
      eq(g.state().hp, 5, `Stage ${index + 1} route fell before x=${x}`);
      eq(g.state().lives, 3); eq(g.state().stageDeaths, 0);
    }
    function jumpTo(x) {
      g.key('w'); g.key('w', false); runTo(x);
      until(g, () => g.state().ground, 180);
    }
    if (index === 0) {
      runTo(420); jumpTo(550); runTo(790); jumpTo(1010);
      runTo(1250); jumpTo(1410); runTo(1640); jumpTo(1850);
      runTo(2200); jumpTo(2370); runTo(2400); jumpTo(2640);
    } else if (index === 1) {
      runTo(290); jumpTo(430); runTo(690); jumpTo(910);
      runTo(1210); jumpTo(1380); runTo(1400); jumpTo(1680);
      runTo(2035); jumpTo(2190); runTo(2270);
      g.key('w'); g.key('w', false); runTo(2370);
      g.key('l'); g.key('l', false); runTo(2640);
      until(g, () => g.state().ground, 180);
    } else {
      runTo(330); jumpTo(470); runTo(640); jumpTo(850);
      runTo(1210); jumpTo(1370); runTo(1410); jumpTo(1660);
      runTo(2305); jumpTo(2525); runTo(2875); jumpTo(3080);
    }
    eq(g.state().intel, 3, `Stage ${index + 1} route did not collect every intel`);
    eq(g.state().hp, 5); eq(g.state().lives, 3); eq(g.state().stageDeaths, 0);
  }
});

test('reactor low/high beams are telegraphed and countered by jump/crouch/dash', () => {
  const build = () => {
    const g = createGame();
    g.run("resetStage(2,null); phase='playing'; enemies.forEach(enemy=>enemy.dead=true);");
    g.nearBoss(); return g;
  };
  const telegraph = build();
  until(telegraph, () => telegraph.state().bossCharge > 0, 120);
  eq(telegraph.state().bossAttackType, 'beam'); eq(telegraph.state().bossAttacks, 0);
  assert(telegraph.state().bossBeamY > 400, 'First reactor beam should warn at ankle height');
  telegraph.frames(20); eq(telegraph.state().bossAttacks, 0, 'Laser charge should give time to react');
  until(telegraph, () => telegraph.state().bossBeamTime > 0, 90);
  eq(telegraph.state().bossAttacks, 1);
  const hitWithBeam = (strategy, high = false) => {
    const g = build();
    if (strategy === 'crouch') { g.key('s'); g.frames(2); }
    if (strategy === 'jump') { g.key('w'); g.frames(12); g.key('w', false); }
    if (strategy === 'dash') { g.key('l'); g.frames(1); g.key('l', false); }
    g.run(`player.inv=0; boss.shot=100; boss.beamTime=.1; boss.beamY=G-${high ? 36 : 12};`);
    g.frames(2); return g.state().hp;
  };
  eq(hitWithBeam('stand'), 4, 'Low beam must damage a stationary player');
  eq(hitWithBeam('jump'), 5, 'Jumping must clear the low beam');
  eq(hitWithBeam('stand', true), 4, 'High beam must damage a standing player');
  eq(hitWithBeam('crouch', true), 5, 'Crouching must avoid the high beam');
  eq(hitWithBeam('dash'), 5, 'Active dash must protect against a beam');
});

test('rapid and dash upgrades change mechanics and stack only across stage advances', () => {
  const rapid = createGame(); rapid.start();
  rapid.run('player.weaponTime=0; player.boost=0; player.shoot=0; fire()');
  const baseInterval = rapid.read('player.shoot');
  for (let count = 1; count <= 2; count++) {
    rapid.clear(); rapid.click('upgrade-rapid'); rapid.click('start'); rapid.safe();
    eq(rapid.state().upgrades.rapid, count);
    rapid.run('player.weaponTime=0; player.boost=0; player.shoot=0; fire()');
    near(rapid.read('player.shoot'), baseInterval * (0.8 ** count));
  }
  const dash = createGame(); dash.start();
  dash.run('dash()'); near(dash.state().dashCooldown, 2.4);
  for (let count = 1; count <= 2; count++) {
    dash.run('player.dashTime=0'); dash.clear(); dash.click('upgrade-dash'); dash.click('start'); dash.safe();
    dash.run('dash()'); near(dash.state().dashCooldown, 2.4 - count * 0.6);
  }
});

test('projectile lethal damage respawns once without stale bullet iteration', () => {
  const g = createGame(); g.start();
  g.run("player.hp=1; player.inv=0; for(let i=0;i<4;i++)projectile(player.x+12,player.y+20,0,0,'e')");
  g.frames(2);
  eq(g.state().lives, 2); eq(g.state().hp, 5); eq(g.state().stageDeaths, 1);
  eq(g.read("bullets.filter(b=>b.owner==='e').length"), 0);
});

test('pointer cancellation and lost capture release only their own active touch', () => {
  const g = createGame(); g.start();
  const button = [...g.nodes.values()].find((item) => item.dataset.action === 'right');
  button.dispatch('pointerdown', { pointerId: 1 });
  button.dispatch('pointerdown', { pointerId: 2 });
  eq(g.state().touchCount, 2);
  button.dispatch('pointercancel', { pointerId: 1 });
  eq(g.state().touchCount, 1); assert(button.classList.contains('active'));
  button.dispatch('lostpointercapture', { pointerId: 2 });
  eq(g.state().touchCount, 0); assert(!button.classList.contains('active'));
  const x = g.state().x; g.frames(5); eq(g.state().x, x);
});

test('expired jump buffers do not cause an automatic jump on a later landing', () => {
  const g = createGame(); g.start();
  g.run('player.y=120; player.vy=0; player.ground=false; player.coyote=0;');
  g.key('w'); g.key('w', false); g.frames(60);
  assert(g.state().ground); near(g.read('player.y+player.h'), 425);
  eq(g.state().jumpBuffer, 0);
});

test('gamepad disconnect releases movement without freezing the keyboard', () => {
  const g = createGame(); g.start(); g.pad(); g.frames(2);
  g.pad([], [1, 0]); g.frames(8); assert(g.state().x > 80);
  g.noPad(); const x = g.state().x; g.frames(5); eq(g.state().x, x);
  g.key('a'); g.frames(5); g.key('a', false); assert(g.state().x < x);
});

// The combat iteration keeps these tests on the real update/collision path. Small
// arenas remove unrelated patrols and pickups, never replace the gameplay code.
function combatArena(type = null, stage = 0, difficulty = 'standard') {
  const g = createGame();
  g.run(`difficulty=${JSON.stringify(difficulty)}; resetStage(${stage},null); phase='playing';
    enemies=${type ? `enemies.filter(e=>e.type===${JSON.stringify(type)}).slice(0,1)` : '[]'};
    enemies.forEach(e=>{e.x=e.home=300;e.age=0;e.shot=100;});
    pickups=[];intel=[];player.inv=100;boss.shot=100;`);
  if (type) eq(g.read('enemies.length'), 1, `Missing ${type} fixture`);
  return g;
}
function tick(g, count = 1) { g.run(`for(let frame=0;frame<${count};frame++)update(DT);`); }
function tickUntil(g, code, limit = 400) {
  for (let frame = 0; frame < limit && !g.read(code); frame++) tick(g);
  assert(g.read(code), 'Timed out waiting for combat condition: ' + code);
}

test('shield patrols introduce fixed-facing armor only in later chapters', () => {
  const g = createGame();
  for (let index = 0; index < 3; index++) {
    g.run(`resetStage(${index},null);`);
    const shields = g.read("enemies.filter(e=>e.type==='shield')");
    if (index === 0) eq(shields.length, 0);
    else {
      assert(shields.length >= 2, `Chapter ${index + 1} should teach and repeat the shield encounter`);
      assert(shields.every(e => e.hp === 5 && e.maxHp === 5 && e.face === -1));
    }
  }
  const patrol = combatArena('shield', 1);
  patrol.run('player.x=420;'); tick(patrol, 30);
  eq(patrol.read('enemies[0].face'), -1, 'Walking behind a shield must not silently rotate its armor');
});

test('shield collision blocks frontal fire but rear fire, reflection and grenades work', () => {
  const g = combatArena('shield', 1);
  const hit = (vx, reflected = false) => {
    g.run(`projectile(enemies[0].x+15,enemies[0].y+18,${vx},0,'p',${reflected ? 2 : 1});
      bullets[bullets.length-1].reflected=${reflected};`);
    tick(g);
    eq(g.read('bullets.length'), 0, 'A collision must consume exactly one player bullet');
  };
  hit(650); eq(g.read('enemies[0].hp'), 5); eq(g.state().score, 0); eq(g.state().combo, 0);
  assert(g.read('enemies[0].blockFlash') > 0); assert(g.state().combatText.includes('盾牌'));
  hit(-650); eq(g.read('enemies[0].hp'), 4); assert(g.read('enemies[0].flash') > 0);
  hit(650, true); eq(g.read('enemies[0].hp'), 2);
  g.run('boom(enemies[0].x+15,enemies[0].y+18)');
  assert(g.read('enemies[0].dead')); eq(g.state().score, 200); eq(g.state().combo, 1);
  g.run('boom(enemies[0].x+15,enemies[0].y+18); damageEnemy(enemies[0],6)');
  eq(g.state().score, 200); eq(g.state().combo, 1, 'A dead shield must never award another kill');
});

test('turrets telegraph a locked target and fire three spaced shots before cooldown', () => {
  for (const difficulty of ['standard', 'relaxed']) {
    const g = combatArena('turret', 0, difficulty);
    g.run('enemies[0].shot=0;'); tick(g);
    near(g.read('enemies[0].windup'), difficulty === 'relaxed' ? 1.05 : .8);
    eq(g.read('bullets.length'), 0);
    const target = g.read('[enemies[0].aimX,enemies[0].aimY]');
    // Change the hitbox after the aim lock; later rounds must not retarget it.
    g.key('s'); tick(g, 10);
    eq(g.read('[enemies[0].aimX,enemies[0].aimY]'), target);
    eq(g.read('bullets.length'), 0);
    tickUntil(g, 'bullets.length===1', 65);
    const first = g.read('({clock,vx:bullets[0].vx,vy:bullets[0].vy,sourceX:bullets[0].sourceX,sourceY:bullets[0].sourceY})');
    const chargeDuration = difficulty === 'relaxed' ? 1.05 : .8;
    assert(first.clock - 1 / 60 >= chargeDuration - 1e-8 && first.clock - 1 / 60 <= chargeDuration + 1 / 60 + 1e-8);
    near(first.vx * (target[1] - first.sourceY), first.vy * (target[0] - first.sourceX));
    near(Math.hypot(first.vx, first.vy), 315 * (difficulty === 'relaxed' ? .78 : 1));
    eq(g.read('enemies[0].burst'), 2);
    tick(g, 8); eq(g.read('bullets.length'), 1, 'Burst spacing must not collapse into one frame');
    tick(g); eq(g.read('bullets.length'), 2);
    tick(g, 8); eq(g.read('bullets.length'), 2);
    tick(g); eq(g.read('bullets.length'), 3); eq(g.read('enemies[0].burst'), 0);
    for (const bullet of g.read('bullets')) { near(bullet.vx, first.vx); near(bullet.vy, first.vy); }
    near(g.read('enemies[0].shot'), 2.1);
    tick(g, 125); eq(g.read('enemies[0].windup'), 0);
    tickUntil(g, 'enemies[0].windup>0', 3);
    assert(g.read('enemies[0].windup') > .7, 'Next attack must start with a new warning, not an immediate bullet');
  }
});

test('turrets cancel charging and unfinished bursts outside range or behind the camera', () => {
  for (const pending of ['charge', 'burst']) for (const exit of ['range', 'camera']) {
    const g = combatArena('turret');
    g.run('enemies[0].shot=0;'); tick(g);
    if (pending === 'burst') tickUntil(g, 'enemies[0].burst===2', 60);
    g.run(`player.x=enemies[0].x+${exit === 'range' ? 700 : 420}; player.y=G-player.h; bullets=[];`); tick(g);
    if (exit === 'camera') {
      assert(g.read('Math.abs(enemies[0].x-player.x)<570 && enemies[0].x+enemies[0].w<cam'),
        'Camera regression must leave the turret within active distance but fully offscreen');
    }
    eq(g.read('enemies[0].windup'), 0); eq(g.read('enemies[0].burst'), 0);
    tick(g, 180); eq(g.read('bullets.length'), 0, 'Inactive turret must never finish an offscreen attack');
    g.run('player.x=64; player.y=G-player.h;'); tick(g);
    eq(g.read('bullets.length'), 0); eq(g.read('enemies[0].windup'), 0);
    tickUntil(g, 'enemies[0].windup>0', 30);
    eq(g.read('bullets.length'), 0, 'Returning to range must still give a complete warning');
  }
  const destroyed = combatArena('turret');
  destroyed.run('enemies[0].shot=0;'); tick(destroyed);
  tickUntil(destroyed, 'enemies[0].burst===2', 60);
  destroyed.run('damageEnemy(enemies[0],99); bullets=[];'); tick(destroyed, 60);
  eq(destroyed.read('bullets.length'), 0); eq(destroyed.read('enemies[0].burst'), 0);
});

test('dash reflects the same enemy projectile toward its saved source with double damage', () => {
  const g = combatArena();
  g.run(`player.inv=0; projectile(320,G-70,-315,0,'e');
    window.testBullet=bullets[0]; bullets[0].x=player.x+30;bullets[0].y=player.y+20; dash();`);
  tick(g);
  assert(g.read('bullets.length===1 && bullets[0]===window.testBullet'), 'Reflection must convert the object, not duplicate it');
  const bullet = g.read('bullets[0]');
  eq(bullet.owner, 'p'); eq(bullet.reflected, true); eq(bullet.damage, 2);
  eq(bullet.sourceX, 320); eq(bullet.sourceY, 355);
  near(bullet.vx * (bullet.sourceY - bullet.y), bullet.vy * (bullet.sourceX - bullet.x));
  assert(bullet.vx * (bullet.sourceX - bullet.x) + bullet.vy * (bullet.sourceY - bullet.y) > 0);
  near(Math.hypot(bullet.vx, bullet.vy), 650);
  eq(g.state().reflections, 1); eq(g.state().hp, 5); eq(g.state().combo, 0); eq(g.state().shots, 0);
  assert(g.state().combatText.includes('冲刺反弹'));
  tick(g, 4); eq(g.state().reflections, 1, 'One projectile must not reflect twice');
});

test('normal invulnerability consumes hostile fire and a dash does not reflect reactor beams', () => {
  const invulnerable = combatArena();
  invulnerable.run("projectile(player.x+12,player.y+20,0,0,'e')"); tick(invulnerable);
  eq(invulnerable.state().hp, 5); eq(invulnerable.state().reflections, 0); eq(invulnerable.read('bullets.length'), 0);
  const beam = combatArena(null, 2);
  beam.nearBoss();
  beam.run('player.inv=0; dash(); boss.beamTime=.12;boss.beamY=G-12;boss.shot=100;'); tick(beam);
  eq(beam.state().hp, 5); eq(beam.state().reflections, 0); eq(beam.read('bullets.length'), 0);
  const coincident = combatArena();
  coincident.run("player.face=-1; projectile(player.x+12,player.y+20,0,0,'e'); reflectBullet(bullets[0]);");
  eq(coincident.read('[bullets[0].vx,bullets[0].vy]'), [-650, 0]);
});

test('reflected projectiles damage bosses once without becoming a combo kill', () => {
  const g = combatArena(); g.nearBoss();
  g.run(`boss.hp=2; projectile(boss.x+20,boss.y+50,650,0,'p',2); bullets[0].reflected=true;`); tick(g);
  eq(g.state().bossHp, 0); eq(g.state().score, 1300); eq(g.state().combo, 0);
  eq(g.read('bullets.length'), 0); tick(g, 3); eq(g.state().score, 1300);
});

test('combo rewards follow kill thresholds, cap at triple points and award dead enemies once', () => {
  const g = combatArena();
  g.run("enemies=Array.from({length:12},()=>({x:300,y:389,w:30,h:36,type:'walker',hp:1,dead:false}));");
  const totals = [100, 300, 500, 800, 1100, 1400, 1700, 2000, 2300, 2600, 2900, 3200];
  for (let index = 0; index < totals.length; index++) {
    g.run(`damageEnemy(enemies[${index}],1);`);
    eq(g.state().score, totals[index]); eq(g.state().combo, index + 1); near(g.state().comboTime, 5);
  }
  eq(g.state().comboBest, 12); assert(g.nodes.get('combo-status').textContent.includes('×3'));
  g.run('enemies.forEach(e=>damageEnemy(e,99));');
  eq(g.state().score, 3200); eq(g.state().combo, 12);
  const values = combatArena('turret');
  values.run('damageEnemy(enemies[0],99);'); eq(values.state().score, 160);
  values.run("damageEnemy({type:'shield',hp:1,x:300,y:389,w:30,h:36,dead:false},1)");
  eq(values.state().score, 560, 'Shield base reward must receive the second-kill multiplier');
});

test('combo expiry and actual damage reset the streak but preserve the best chain', () => {
  const g = combatArena();
  g.run('rewardKill(100);'); tick(g, 240);
  assert(g.state().comboTime > .9 && g.state().comboTime < 1.1);
  g.run('rewardKill(100);'); eq(g.state().combo, 2); near(g.state().comboTime, 5);
  g.run('hurt(1);'); eq(g.state().combo, 2, 'Ordinary invulnerability must preserve the streak');
  g.run('player.inv=0;dash();hurt(1);'); eq(g.state().combo, 2, 'Dash protection must preserve the streak');
  g.run('player.dashTime=0;hurt(1);'); eq(g.state().hp, 4); eq(g.state().combo, 0); eq(g.state().comboTime, 0);
  eq(g.state().comboBest, 2); assert(g.state().combatText.includes('连击中断'));
  g.run('rewardKill(100);'); eq(g.state().combo, 1); tick(g, 301);
  eq(g.state().combo, 0); eq(g.state().comboTime, 0); eq(g.state().comboBest, 2); eq(g.state().combatText, '');
  g.run('rewardKill(100);'); eq(g.state().combo, 1); eq(g.state().score, 500);
});

test('pickups, intel, boss and stage-clear awards are not multiplied by a kill chain', () => {
  const g = combatArena();
  g.run('for(let i=0;i<4;i++)rewardKill(100);'); eq(g.state().score, 800);
  g.run(`pickups=[{x:player.x+12,y:player.y+20,kind:'grenade',done:false,age:0}];
    intel=[{x:player.x+12,y:player.y+20,done:false}];`); tick(g);
  eq(g.state().score, 1025); eq(g.state().combo, 4);
  tick(g, 3); eq(g.state().score, 1025, 'Collected objects must not award points again');
  g.run('damageBoss(boss.hp);'); eq(g.state().score, 2325); eq(g.state().combo, 4);
  g.exit(); tick(g); eq(g.state().phase, 'stageClear'); eq(g.state().score, 2975);
  tick(g, 120); eq(g.state().score, 2975); eq(g.state().comboBest, 4);
});

test('pause freezes combat timers and stage changes or restart clear all combat state', () => {
  for (const reset of ['stage', 'restart']) {
    const g = combatArena('turret');
    g.run(`rewardKill(100);rewardKill(100);reflections=3;enemies[0].windup=.4;
      enemies[0].burst=2;enemies[0].burstTimer=.1;enemies[0].flash=.12;`);
    const timers = () => g.read('({combo,combatText,combatTime,reflections,windup:enemies[0].windup,burst:enemies[0].burst,burstTimer:enemies[0].burstTimer,flash:enemies[0].flash})');
    g.key('p'); const frozen = timers(); g.frames(180); eq(timers(), frozen);
    const snapshot = g.win.__raidState;
    try { snapshot.combo=999; snapshot.comboTime=999; snapshot.comboBest=999; snapshot.reflections=999; snapshot.combatText='changed'; } catch {}
    eq(g.state().combo, 2); eq(g.state().reflections, 3); eq(timers(), frozen);
    if (reset === 'stage') g.run("resetStage(1,{hp:player.hp,lives:player.lives,grenades:player.grenades});phase='playing';");
    else { g.key('r'); g.click('start'); }
    eq(g.state().phase, 'playing'); eq(g.state().combo, 0); eq(g.state().comboTime, 0); eq(g.state().comboBest, 0);
    eq(g.state().reflections, 0); eq(g.state().combatText, ''); eq(g.read('combatTime'), 0);
    assert(g.read('enemies.every(e=>e.windup===0&&e.burst===0&&e.flash===0&&e.blockFlash===0)'));
    eq(g.nodes.get('combo-status').textContent, '待命');
  }
});

test('lethal hostile fire retains reflected shots without stale iteration or duplicate kill awards', () => {
  const g = combatArena('shield', 1);
  g.run(`enemies[0].hp=2;
    enemies.push({...enemies[0],type:'walker',hp:1,x:450,home:450});
    projectile(465,G-18,0,0,'p');
    projectile(315,G-18,650,0,'p',2);bullets[1].reflected=true;
    player.hp=1;player.inv=0;
    for(let i=0;i<4;i++)projectile(player.x+12,player.y+20,0,0,'e');`);
  tick(g);
  eq(g.state().lives, 2); eq(g.state().hp, 5); eq(g.state().stageDeaths, 1);
  assert(g.read('enemies.every(e=>e.dead)')); eq(g.read('bullets.length'), 0);
  eq(g.state().score, 400); eq(g.state().combo, 2); eq(g.state().reflections, 0);
  tick(g, 3); eq(g.state().score, 400); eq(g.state().combo, 2);
});

test('reduced-motion rendering suppresses enemy and boss hit flashes while keeping combat feedback', () => {
  for (const reducedMotion of [false, true]) {
    const g = createGame({ reducedMotion });
    g.run(`phase='playing';enemies[0].flash=.12;boss.flash=.12;
      combatNotice('命中');window.drawRects=[];
      c.fillRect=(...coords)=>window.drawRects.push({coords,fill:c.fillStyle,alpha:c.globalAlpha});
      drawEnemy(enemies[0]);drawBoss();`);
    const overlays = g.read("window.drawRects.filter(rect=>rect.fill==='#fff3c9')");
    eq(overlays.length, reducedMotion ? 0 : 2);
    if (!reducedMotion) eq(overlays.map(rect => rect.alpha), [.65, .55]);
    eq(g.state().combatText, '命中');
  }
});

test('combat feedback never covers the reactor beam dodge warning', () => {
  const g = createGame();
  g.run(`resetStage(2,null);phase='playing';player.x=boss.x-300;cam=player.x-290;
    boss.attackType='beam';boss.windup=.5;combatNotice('冲刺反弹');
    window.drawRects=[];c.fillRect=(...coords)=>window.drawRects.push({coords,fill:c.fillStyle});draw();`);
  const warning = g.read("window.drawRects.find(rect=>rect.fill==='#241d31').coords");
  const feedback = g.read("window.drawRects.find(rect=>rect.fill==='#14283c').coords");
  assert(feedback[1] >= warning[1] + warning[3], 'Hit feedback must sit below the critical dodge instruction');
});

// Operations share the production loop and storage schema. Fixtures below only
// arrange boundary conditions; collisions, input dispatch and transitions always
// run through the game's real implementation.
const operationIds = ['sprint', 'counter', 'bosses'];
const emptyOperationRecord = () => ({ clears: 0, best: 0, bestTime: 0 });
function operation(id, options) {
  const g = createGame(options);
  g.click('mode-challenges'); g.click('challenge-' + id);
  eq(g.state().phase, 'playing'); eq(g.state().challengeId, id);
  return g;
}
function reflectShots(g, count) {
  // The dash moves right before bullet collision. These stationary hostile
  // projectiles overlap that next hitbox and retain a genuine source position.
  g.run(`enemies.forEach(e=>e.dead=true); boss.shot=100;
    player.face=1; player.dashTime=0; player.dashCooldown=0;
    for(let i=0;i<${count};i++){
      projectile(player.x+24,player.y+20,0,0,'e');
      bullets[bullets.length-1].sourceX=player.x+200;
    }`);
  g.key('l'); tick(g); g.key('l', false);
}
function finishOperation(g) {
  g.exit(); g.run('player.dashTime=0; damageBoss(boss.hp);'); tick(g);
}
function finishArena(g) { g.run('damageBoss(boss.hp);'); tick(g); }
function savedOtherModes(g) {
  return g.read('({unlocked:progress.unlocked,selectedDifficulty:progress.selectedDifficulty,campaign:progress.campaign,practice:progress.practice})');
}

test('operation menu exposes three independent missions and fixed standard loadouts', () => {
  const expected = {
    sprint: { stage: 1, hp: 5, lives: 3, grenades: 3, upgrades: { rapid: 0, dash: 1, armor: 0 } },
    counter: { stage: 2, hp: 5, lives: 3, grenades: 3, upgrades: { rapid: 0, dash: 2, armor: 0 } },
    bosses: { stage: 1, hp: 7, lives: 1, grenades: 5, upgrades: { rapid: 1, dash: 1, armor: 2 } },
  };
  for (const id of operationIds) {
    const g = createGame(); g.click('difficulty-relaxed'); g.click('mode-challenges');
    assert(!g.nodes.get('challenge-menu').hidden && g.nodes.get('difficulty-options').hidden);
    assert(g.nodes.get('stage-menu').hidden && g.nodes.get('start').hidden);
    eq(g.nodes.get('mode-challenges').getAttribute('aria-pressed'), 'true');
    g.click('start'); g.document.activeElement = null; g.key('Enter');
    eq(g.state().phase, 'title', 'The hidden campaign action must not start a run from the operation menu');
    g.key('r'); eq(g.state().phase, 'title', 'R must not launch a campaign from the operation menu');
    g.click('restart'); eq(g.state().phase, 'title', 'The top restart button must not launch a campaign from the operation menu');
    eq(g.state().titleView, 'challenges'); eq(g.state().challengeId, null);
    g.run("beginChallenge('__proto__');beginChallenge('missing');"); eq(g.state().phase, 'title');
    g.click('challenge-' + id);
    const state = g.state(), loadout = expected[id];
    eq(state.mode, 'challenge'); eq(state.difficulty, 'standard');
    for (const key of ['stage', 'hp', 'lives', 'grenades', 'upgrades']) eq(state[key], loadout[key], `${id} ${key}`);
    eq(state.maxHp, loadout.hp); eq(state.challengeTime, 0); eq(state.challengeReflections, 0); eq(state.bossWins, 0);
    eq(state.progress.selectedDifficulty, 'relaxed'); assert(!g.nodes.get('mission-hud').hidden);
    g.click('challenge-' + (id === 'sprint' ? 'counter' : 'sprint')); g.click('difficulty-relaxed');
    eq(g.state().challengeId, id, 'Hidden mission buttons must not replace an active run');
    eq(g.state().difficulty, 'standard');
  }
  for (const action of ['r', 'restart', 'Enter']) {
    const g = createGame(); g.click('mode-challenges'); g.click('mode-campaign'); g.document.activeElement = null;
    if (action === 'restart') g.click(action); else g.key(action);
    eq(g.state().phase, 'playing', `Campaign title must retain its ${action} shortcut`);
    eq(g.state().mode, 'campaign'); eq(g.state().challengeId, null);
  }
});

test('returning from any operation restores the saved campaign difficulty and title choice', () => {
  for (const id of operationIds) {
    const saved = storedProgress({ selectedDifficulty: 'relaxed', unlocked: 2 });
    const g = operation(id, { storage: { [STORE]: JSON.stringify(saved) } });
    g.key('p'); g.click('menu-home'); eq(g.state().phase, 'confirmRestart');
    g.click('start'); eq(g.state().phase, 'title'); eq(g.state().difficulty, 'relaxed');
    eq(g.state().mode, 'campaign'); eq(g.state().challengeId, null); eq(g.state().titleView, 'challenges');
    assert(g.nodes.get('mission-hud').hidden);
    g.click('mode-campaign'); assert(!g.nodes.get('difficulty-options').hidden);
    g.click('start'); eq(g.state().hp, 6); eq(g.state().lives, 4); eq(g.state().upgrades, { rapid: 0, dash: 0, armor: 0 });
    eq(g.state().unlocked, 2);
  }
});

test('legacy saves gain empty operation records without losing prior campaign or practice scores', () => {
  const saved = storedProgress({ selectedDifficulty: 'relaxed', unlocked: 3 });
  saved.campaign.standard = { best: 12000, stars: [7, 5, 1] };
  saved.practice.relaxed = { best: 6400, stars: [1, 7, 5] };
  const g = createGame({ storage: { [STORE]: JSON.stringify(saved) } });
  eq(savedOtherModes(g), { unlocked: 3, selectedDifficulty: 'relaxed', campaign: saved.campaign, practice: saved.practice });
  eq(g.state().progress.challenges, Object.fromEntries(operationIds.map(id => [id, emptyOperationRecord()])));
  const legacy = createGame({ storage: { 'pixel-raid.best': '1234' } });
  eq(legacy.state().progress.campaign.standard.best, 1234);
  eq(legacy.state().progress.challenges, g.state().progress.challenges);
});

test('hostile operation records are bounded, normalized and cannot grow the storage schema', () => {
  const cases = [
    { input: null, expected: emptyOperationRecord() },
    { input: { clears: 1, best: 99, bestTime: 0 }, expected: emptyOperationRecord() },
    { input: { clears: 0, best: 99, bestTime: 200 }, expected: emptyOperationRecord() },
    { input: { clears: -1, best: -5, bestTime: -20 }, expected: emptyOperationRecord() },
    { input: { clears: '8', best: 'Infinity', bestTime: '30' }, expected: emptyOperationRecord() },
    { input: { clears: 2.9, best: 991.8, bestTime: 204.9 }, expected: { clears: 2, best: 991, bestTime: 204 } },
    { input: { clears: 1e100, best: 1e100, bestTime: 1e100, extra: { injected: true } }, expected: { clears: 9999, best: 9999999, bestTime: 36000000 } },
    { input: { clears: 1, best: {}, bestTime: 100 }, expected: { clears: 1, best: 0, bestTime: 100 } },
  ];
  for (const { input, expected } of cases) {
    const raw = storedProgress({ challenges: Object.fromEntries([...operationIds.map(id => [id, input]), ['unknown', input]]) });
    const g = createGame({ storage: { [STORE]: JSON.stringify(raw) } });
    eq(g.state().progress.challenges, Object.fromEntries(operationIds.map(id => [id, expected])));
    g.click('mode-challenges'); g.click('challenge-sprint');
    assert(Number.isFinite(g.read('best')));
  }
  for (const raw of [
    '{"version":1,"challenges":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"sprint":{"clears":1,"best":1e309,"bestTime":1e309}}}',
    JSON.stringify(storedProgress({ challenges: { sprint: { clears: 1, best: 2, bestTime: 3 } }, padding: 'x'.repeat(12000) })),
  ]) {
    const g = createGame({ storage: { [STORE]: raw } });
    eq(g.state().progress.challenges, Object.fromEntries(operationIds.map(id => [id, emptyOperationRecord()])));
  }
  eq({}.polluted, undefined);
});

test('operation snapshots cannot mutate challenge counters, nested records or loadouts', () => {
  const g = operation('counter'); reflectShots(g, 2);
  g.run("projectile(400,250,-100,0,'e');");
  const before = g.state(), snapshot = g.win.__raidState;
  eq(snapshot.hostiles.length, 1); eq(Object.keys(snapshot.hostiles[0]).sort(), ['x', 'y']);
  try {
    snapshot.challengeId = 'bosses'; snapshot.challengeTime = 900; snapshot.challengeReflections = 99; snapshot.bossWins = 3;
    snapshot.upgrades.dash = 99; snapshot.progress.challenges.counter.clears = 999;
    snapshot.progress.challenges.counter.bestTime = 1; snapshot.progress.challenges.injected = { clears: 100 };
    snapshot.progress.campaign.standard.stars.push(7); snapshot.runStars.push(7);
    snapshot.hostiles[0].x = -999; snapshot.hostiles[0].y = -999; snapshot.hostiles.push({ x: 0, y: 0 });
  } catch {}
  eq(g.state(), before, 'Every published nested object must be detached from live state');
});

test('operation points and successful records remain isolated from campaign, practice and unlocks', () => {
  for (const id of operationIds) {
    const saved = storedProgress({ selectedDifficulty: 'relaxed' });
    saved.campaign.standard = { best: 4321, stars: [5, 0, 0] };
    saved.practice.relaxed = { best: 3456, stars: [7, 0, 0] };
    const g = operation(id, { storage: { [STORE]: JSON.stringify(saved) } }), untouched = savedOtherModes(g);
    g.run('rewardKill(100);'); eq(savedOtherModes(g), untouched);
    eq(g.state().progress.challenges[id], emptyOperationRecord(), 'Unfinished scores must not become records');
    if (id === 'counter') reflectShots(g, 5);
    if (id === 'bosses') {
      for (let index = 0; index < 3; index++) { finishArena(g); if (index < 2) g.click('start'); }
    } else finishOperation(g);
    eq(g.state().phase, 'challengeClear'); eq(savedOtherModes(g), untouched);
    const record = JSON.parse(g.values.get(STORE));
    eq(record.campaign, saved.campaign); eq(record.practice, saved.practice); eq(record.unlocked, 1); eq(record.selectedDifficulty, 'relaxed');
    eq(record.challenges[id].clears, 1); assert(record.challenges[id].best > 0 && record.challenges[id].bestTime > 0);
    for (const other of operationIds.filter(other => other !== id)) eq(record.challenges[other], emptyOperationRecord());
  }
});

test('operation success commits one award once and fastest time and best score improve independently', () => {
  const g = operation('sprint'); g.run('challengeTime=40; points=2000;'); finishOperation(g);
  eq(g.state().phase, 'challengeClear'); eq(g.state().score, 4290);
  const first = g.state(), persisted = g.values.get(STORE);
  tick(g, 180); g.frames(120); g.run("finishStage();finishChallenge(true,'duplicate');finishChallenge(false,'late');damageBoss(99);");
  eq(g.state(), first); eq(g.values.get(STORE), persisted);
  g.click('start'); g.run('challengeTime=30; points=0;'); finishOperation(g);
  const faster = g.state().progress.challenges.sprint;
  eq(faster.clears, 2); eq(faster.best, first.score); assert(faster.bestTime < first.progress.challenges.sprint.bestTime);
  g.click('start'); g.run('challengeTime=60; points=8000;'); finishOperation(g);
  const richer = g.state().progress.challenges.sprint;
  eq(richer.clears, 3); assert(richer.best > faster.best); eq(richer.bestTime, faster.bestTime);
});

test('operation failure never overwrites completed records or awards twice', () => {
  for (const id of operationIds) {
    const saved = storedProgress({ challenges: Object.fromEntries(operationIds.map(key => [key, { clears: 2, best: 9000, bestTime: 1234 }])) });
    const raw = JSON.stringify(saved), g = operation(id, { storage: { [STORE]: raw } });
    g.run('points=99999;player.lives=1;player.hp=1;player.inv=0;hurt(1);');
    eq(g.state().phase, 'challengeFailed'); eq(g.state().lives, 0); eq(g.state().stageDeaths, 1);
    const terminal = g.state();
    tick(g, 120); g.frames(60); g.run("finishChallenge(true,'late');finishChallenge(false,'duplicate');finishStage();hurt(1);");
    eq(g.state(), terminal); eq(g.values.get(STORE), raw);
    eq(g.state().progress.challenges, saved.challenges);
  }
});

test('sprint must exit strictly before 90 seconds, with timeout preceding exit and pending hits', () => {
  for (const offset of [-0.001, 0, 0.001]) {
    const g = operation('sprint'); g.exit(); g.run(`damageBoss(boss.hp);challengeTime=90-DT+${offset};`); tick(g);
    eq(g.state().phase, offset < 0 ? 'challengeClear' : 'challengeFailed', `deadline offset ${offset}`);
    if (offset < 0) { assert(g.state().challengeTime < 90); eq(g.state().progress.challenges.sprint.clears, 1); }
    else { eq(g.state().challengeTime, 90); eq(g.state().progress.challenges.sprint.clears, 0); eq(g.state().score, 1300); }
    const terminal = g.state(); tick(g, 30); eq(g.state(), terminal);
  }
  const pending = operation('sprint'); pending.run(`enemies=[];player.inv=0;player.hp=1;player.lives=1;boss.hp=1;
    challengeTime=90-DT;projectile(boss.x+30,boss.y+30,0,0,'p');projectile(player.x+12,player.y+20,0,0,'e');`);
  tick(pending); eq(pending.state().phase, 'challengeFailed'); eq(pending.state().bossHp, 1);
  eq(pending.state().hp, 1); eq(pending.state().lives, 1); eq(pending.state().score, 0);
});

test('operation elapsed time advances only while playing, including interrupted and canceled menus', () => {
  for (const interrupt of ['pause', 'blur', 'hidden', 'restart', 'home']) {
    const g = operation('counter'); g.safe(); tick(g, 12);
    if (interrupt === 'pause') g.key('p');
    else if (interrupt === 'blur') g.event('blur');
    else if (interrupt === 'hidden') g.visibility(true);
    else if (interrupt === 'restart') g.key('r');
    else { g.key('p'); g.click('menu-home'); }
    const time = g.state().challengeTime, clock = g.state().clock;
    tick(g, 300); g.frames(300); near(g.state().challengeTime, time); near(g.state().clock, clock);
    if (g.state().phase === 'confirmRestart') g.click('cancel-restart');
    if (interrupt === 'hidden') g.visibility(false);
    if (g.state().phase === 'pause') g.click('start');
    tick(g, 3); near(g.state().challengeTime, time + 3 / 60);
  }
  const g = operation('bosses'); tick(g, 10); finishArena(g);
  const time = g.state().challengeTime; eq(g.state().phase, 'bossBreak');
  tick(g, 300); g.frames(300); near(g.state().challengeTime, time);
  g.click('start'); tick(g, 2); near(g.state().challengeTime, time + 2 / 60);
  g.run('player.inv=0;hurt(player.hp);'); const failed = g.state().challengeTime;
  g.frames(300); tick(g, 300); near(g.state().challengeTime, failed);
});

test('counter and gauntlet remain playable beyond the sprint deadline', () => {
  for (const id of ['counter', 'bosses']) {
    const g = operation(id); g.run('challengeTime=89.99;player.inv=100;enemies.forEach(e=>e.dead=true);boss.shot=100;');
    tick(g, 120); eq(g.state().phase, 'playing'); near(g.state().challengeTime, 91.99);
    eq(g.state().progress.challenges[id], emptyOperationRecord());
    assert(g.nodes.get('mission-time').textContent.startsWith('用时 '));
    if (id === 'counter') { reflectShots(g, 5); finishOperation(g); }
    else for (let index = 0; index < 3; index++) { finishArena(g); if (index < 2) g.click('start'); }
    eq(g.state().phase, 'challengeClear'); assert(g.state().progress.challenges[id].bestTime > 9000);
  }
});

test('completed operation records reload with centisecond precision and bounded clear and score totals', () => {
  const saved = storedProgress({ selectedDifficulty: 'relaxed', challenges: {
    sprint: { clears: 9999, best: 9999999, bestTime: 126 },
    counter: { clears: 4, best: 3200, bestTime: 9001 },
    bosses: { clears: 3, best: 5100, bestTime: 1820 },
  } });
  const g = operation('sprint', { storage: { [STORE]: JSON.stringify(saved) } });
  g.run('challengeTime=1.231;points=10000000;'); finishOperation(g);
  const record = g.state().progress.challenges.sprint;
  eq(record, { clears: 9999, best: 9999999, bestTime: 125 });
  eq(g.state().progress.challenges.counter, saved.challenges.counter); eq(g.state().progress.challenges.bosses, saved.challenges.bosses);
  const reloaded = createGame({ storage: { [STORE]: g.values.get(STORE) } });
  eq(reloaded.state().difficulty, 'relaxed'); eq(reloaded.state().progress.challenges, g.state().progress.challenges);
  reloaded.click('mode-challenges');
  for (const id of operationIds) {
    const text = reloaded.nodes.get('challenge-record-' + id).textContent;
    assert(text.includes('完成 ') && text.includes('最高 ') && text.includes('最快 '));
  }
  reloaded.click('challenge-sprint'); eq(reloaded.read('best'), 9999999);
  eq(reloaded.state().difficulty, 'standard'); eq(reloaded.state().challengeTime, 0); eq(reloaded.state().score, 0);
});

test('counter completion requires real reflected collisions at the 4, 5 and 6 shot boundaries', () => {
  for (const count of [4, 5, 6]) {
    const g = operation('counter'); reflectShots(g, count);
    eq(g.state().challengeReflections, count); eq(g.state().reflections, count);
    assert(g.read("bullets.every(b=>b.owner==='p'&&b.reflected&&b.damage===2)"));
    eq(g.state().hp, 5, 'Reflected impacts must not cost health');
    finishOperation(g);
    eq(g.state().phase, count < 5 ? 'challengeFailed' : 'challengeClear');
    eq(g.state().progress.challenges.counter.clears, count < 5 ? 0 : 1);
    assert(g.nodes.get('result-details').textContent.includes(`反弹敌弹 ${count} / 5`));
  }
});

test('a reflected projectile counts once, normal invulnerability does not count, and respawn retains mission totals', () => {
  const g = operation('counter'); reflectShots(g, 5);
  g.run('bullets.forEach(b=>{b.vx=0;b.vy=0;});'); tick(g, 5);
  eq(g.state().challengeReflections, 5, 'Converted player bullets overlapping the dash cannot count twice');
  g.run("player.dashTime=0;player.inv=2;projectile(player.x+12,player.y+20,0,0,'e');"); tick(g);
  eq(g.state().challengeReflections, 5); eq(g.state().hp, 5);
  g.run('player.inv=0;player.checkpoint=1170;hurt(player.hp);');
  eq(g.state().lives, 2); eq(g.state().x, 1170); eq(g.state().challengeReflections, 5);
  eq(g.state().reflections, 5); eq(g.state().stageDeaths, 1);
  finishOperation(g); eq(g.state().phase, 'challengeClear');
  g.click('start'); eq(g.state().challengeReflections, 0); eq(g.state().reflections, 0);
});

test('gauntlet uses three ordered 960px arenas with no campaign routes, pickups or patrols', () => {
  const g = operation('bosses'), campaign = createGame();
  for (let index = 0; index < 3; index++) {
    const shape = g.read('({width:stage.width,gaps:stage.gaps,checkpoints:stage.checkpoints,platforms:stage.platforms,enemies:enemies.length,pickups:pickups.length,intel:intel.length,bossX:boss.x,bossW:boss.w,bossName:stage.bossName,maxHp:boss.maxHp})');
    eq(g.state().stage, index + 1); eq(g.state().bossWins, index); eq(shape.width, 960);
    eq(shape.gaps, []); eq(shape.checkpoints, []); eq(shape.enemies, 0); eq(shape.pickups, 0); eq(shape.intel, 0);
    eq(shape.platforms, [[260, 320, 170], [500, 310, 150]]);
    eq(shape.bossX, 790); assert(shape.bossX + shape.bossW < shape.width);
    eq(shape.maxHp, [66, 94, 121][index]); eq(shape.bossName, g.read(`STAGES[${index}].bossName`));
    near(g.read('boss.shot'), .35);
    campaign.run(`resetStage(${index},null);`);
    eq(campaign.read('boss.maxHp'), [24, 34, 44][index], 'Arena balance must not raise campaign boss health');
    near(campaign.read('boss.shot'), 1.3, 'Arena balance must not shorten campaign opening warnings');
    g.run('player.inv=100;boss.shot=100;'); g.key('a'); tick(g, 30); g.key('a', false); eq(g.state().x, 8);
    g.key('d'); tick(g, 200); g.key('d', false); eq(g.state().x, 749); eq(g.state().cam, 0);
    eq(g.state().hp, 7); eq(g.state().stageDeaths, 0);
    finishArena(g);
    eq(g.state().phase, index === 2 ? 'challengeClear' : 'bossBreak');
    if (index < 2) g.click('start');
  }
  eq(g.state().bossWins, 3); eq(g.state().score, 5275); eq(g.state().progress.challenges.bosses.clears, 1);
});

test('gauntlet bosses activate at the left wall and cannot be disabled by the firing safe-zone exploit', () => {
  const g = operation('bosses');
  for (let index = 0; index < 3; index++) {
    // Real inputs recreate the exploit: walk fully left, then one crouched
    // right step changes facing without entering the old 780px activation area.
    g.key('a'); tick(g, 30); g.key('a', false); eq(g.state().x, 8);
    g.key('s'); g.key('d'); tick(g); g.key('d', false); g.key('s', false);
    near(g.state().x, 8 + 110 / 60); eq(g.read('player.face'), 1);
    assert(g.read('boss.x-player.x>=780'), 'The fixture must remain outside the campaign activation range');
    tickUntil(g, 'boss.attacks>0', 240);
    assert(g.state().bossAttacks > 0); near(g.state().x, 8 + 110 / 60);
    eq(g.state().phase, 'playing'); assert(g.state().hp > 0);
    finishArena(g); if (index < 2) g.click('start');
  }
});

test('arena bosses retain distinct normal, enraged and alternating reactor attack patterns', () => {
  const g = operation('bosses');
  for (let index = 0; index < 3; index++) {
    g.run('player.inv=100;'); tickUntil(g, 'boss.attacks===1');
    eq(g.state().bossLastVolley, [1, 3, 0][index]);
    eq(g.state().bossAttackType, index === 2 ? 'beam' : 'volley');
    if (index === 2) {
      near(g.state().bossBeamY, 413); tickUntil(g, 'boss.attacks===2'); eq(g.state().bossLastVolley, 3);
      tickUntil(g, 'boss.attacks===3'); eq(g.state().bossAttackType, 'beam'); near(g.state().bossBeamY, 389);
    }
    g.run('boss.hp=Math.floor(boss.maxHp*.4);');
    const attacks = g.state().bossAttacks; tickUntil(g, `boss.attacks>${attacks}`);
    eq(g.state().bossLastVolley, index === 0 ? 3 : 5); assert(g.state().bossRage);
    finishArena(g); if (index < 2) g.click('start');
  }
});

test('boss defeat transitions only at the next update boundary and each boundary is awarded once', () => {
  const g = operation('bosses');
  for (let index = 0; index < 3; index++) {
    g.run("boss.hp=1;boss.shot=100;projectile(boss.x+30,boss.y+30,0,0,'p');");
    tick(g); eq(g.state().bossHp, 0); eq(g.state().phase, 'playing'); eq(g.state().bossWins, index);
    eq(g.state().score, 1300 * (index + 1));
    tick(g); eq(g.state().bossWins, index + 1); eq(g.state().phase, index < 2 ? 'bossBreak' : 'challengeClear');
    const terminal = g.state(); tick(g, 30); g.frames(30); eq(g.state(), terminal);
    if (index < 2) { g.click('start'); g.click('start'); eq(g.state().stage, index + 2); eq(g.state().bossWins, index + 1); }
  }
  eq(g.state().score, 5275); eq(g.state().progress.challenges.bosses.clears, 1);
});

test('gauntlet continuation carries totals and capped supplies while clearing transient combat and input', () => {
  const g = operation('bosses');
  g.run(`player.hp=3;player.grenades=6;player.weaponTime=9;player.boost=8;
    player.dashCooldown=1;combo={count:4,timer:4,best:4};challengeReflections=6;reflections=6;
    challengeTime=12;shotsFired=20;points=321;projectile(100,100,0,0,'e');
    bombs.push({x:200,y:200,vx:0,vy:0,timer:5,r:8});combatNotice('pending');`);
  g.key('j'); g.key('k'); g.key('l'); g.key('d'); finishArena(g);
  const carried = g.state(); eq(carried.phase, 'bossBreak'); eq(carried.hp, 3); eq(carried.grenades, 6);
  assert(g.read('bullets.length>0 && bombs.length>0'));
  g.click('start'); const next = g.state();
  eq(next.hp, 5); eq(next.maxHp, 7); eq(next.lives, 1); eq(next.grenades, 7); eq(next.score, carried.score);
  eq(next.shots, 20); near(next.challengeTime, carried.challengeTime); eq(next.challengeReflections, 6); eq(next.bossWins, 1);
  eq(next.upgrades, { rapid: 1, dash: 1, armor: 2 }); eq(next.weaponTime, 0); eq(next.dashCooldown, 0);
  eq(next.combo, 0); eq(next.comboBest, 0); eq(next.reflections, 0); eq(next.combatText, '');
  eq(g.read('({bullets:bullets.length,bombs:bombs.length,sparks:sparks.length,boost:player.boost,shoot:player.shoot,clock})'), { bullets: 0, bombs: 0, sparks: 0, boost: 0, shoot: 0, clock: 0 });
  assert(g.read('held.size===0&&touch.size===0&&!jumpQueued&&!grenadeQueued&&!dashQueued'));
  tick(g, 3); eq(g.state().x, 64); eq(g.state().shots, 20); eq(g.state().grenades, 7);
  g.run('player.hp=6;player.grenades=0;'); finishArena(g); g.click('start');
  eq(g.state().hp, 7); eq(g.state().grenades, 2); eq(g.state().lives, 1);
});

test('operation retry works from playing, pause, confirmation, boss break, success and failure', () => {
  for (const targetPhase of ['playing', 'pause', 'confirmRestart', 'bossBreak', 'challengeClear', 'challengeFailed']) {
    const g = operation('bosses'); g.run('challengeTime=10;challengeReflections=2;points=123;shotsFired=8;player.grenades=1;');
    if (targetPhase === 'pause') g.key('p');
    else if (targetPhase === 'confirmRestart') g.key('r');
    else if (targetPhase === 'bossBreak') finishArena(g);
    else if (targetPhase === 'challengeClear') {
      for (let index = 0; index < 3; index++) { finishArena(g); if (index < 2) g.click('start'); }
    } else if (targetPhase === 'challengeFailed') g.run('player.inv=0;hurt(player.hp);');
    eq(g.state().phase, targetPhase); const records = g.state().progress.challenges;
    if (targetPhase === 'confirmRestart') {
      g.click('restart'); eq(g.state().phase, 'confirmRestart'); g.click('start');
    } else if (['challengeClear', 'challengeFailed'].includes(targetPhase)) g.click('start');
    else { g.click('restart'); eq(g.state().phase, 'confirmRestart'); g.click('start'); }
    const fresh = g.state();
    eq(fresh.phase, 'playing'); eq(fresh.challengeId, 'bosses'); eq(fresh.stage, 1); eq(fresh.bossWins, 0);
    eq(fresh.challengeTime, 0); eq(fresh.challengeReflections, 0); eq(fresh.score, 0); eq(fresh.shots, 0);
    eq(fresh.hp, 7); eq(fresh.lives, 1); eq(fresh.grenades, 5); eq(fresh.bullets, 0);
    eq(fresh.progress.challenges, records); eq(fresh.upgrades, { rapid: 1, dash: 1, armor: 2 });
  }
});

test('canceling restart or home preserves boss breaks and paused missions without stale menu input', () => {
  for (const sourcePhase of ['playing', 'pause', 'bossBreak']) for (const action of ['restart', 'home']) {
    const g = operation('bosses'); tick(g, 6);
    if (sourcePhase === 'pause') g.key('p');
    if (sourcePhase === 'bossBreak') finishArena(g);
    const before = g.state();
    g.click(action === 'home' ? 'menu-home' : 'restart'); eq(g.state().phase, 'confirmRestart');
    for (const key of ['j', 'k', 'l', 'w', 'd']) g.key(key);
    g.frames(90); g.click('cancel-restart');
    const restored = g.state();
    eq(restored.phase, sourcePhase); eq(restored.challengeTime, before.challengeTime); eq(restored.bossWins, before.bossWins);
    eq(restored.hp, before.hp); eq(restored.grenades, before.grenades); eq(restored.score, before.score);
    if (sourcePhase === 'pause') g.click('start');
    if (sourcePhase === 'bossBreak') g.click('start');
    const resumed = g.state(); tick(g, 3);
    eq(g.state().x, resumed.x); eq(g.state().shots, resumed.shots); eq(g.state().grenades, resumed.grenades);
    eq(g.state().dashTime, 0); assert(g.state().ground);
  }
});

test('same-frame player and boss lethal bullets have a stable failure result without dual completion', () => {
  for (const playerShotFirst of [false, true]) {
    const g = operation('bosses'); finishArena(g); g.click('start'); finishArena(g); g.click('start');
    // Projectile iteration is reverse insertion order. Exercise both orders so
    // a boss killed earlier in this update cannot also grant a posthumous win.
    const hitPlayer = "projectile(player.x+12,player.y+20,0,0,'e');";
    const hitBoss = "projectile(boss.x+30,boss.y+30,0,0,'p');";
    g.run(`boss.hp=1;boss.shot=100;player.hp=1;player.inv=0;bullets=[];${playerShotFirst ? hitPlayer + hitBoss : hitBoss + hitPlayer}`);
    tick(g);
    eq(g.state().phase, 'challengeFailed'); eq(g.state().lives, 0); eq(g.state().bossWins, 2);
    eq(g.state().bossHp, playerShotFirst ? 0 : 1); eq(g.state().score, playerShotFirst ? 3900 : 2600);
    eq(g.state().progress.challenges.bosses, emptyOperationRecord());
    const terminal = g.state(); tick(g, 120); g.frames(60); eq(g.state(), terminal);
  }
});

test('same-frame grenade kills finish next update while lethal fire stops pending grenade awards', () => {
  for (const lethal of [false, true]) {
    const g = operation('bosses');
    g.run(`boss.hp=7;boss.shot=100;player.hp=1;player.inv=${lethal ? 0 : 100};
      bombs.push({x:boss.x+50,y:boss.y+52,vx:0,vy:0,timer:0,r:8});
      projectile(player.x+12,player.y+20,0,0,'e');`);
    tick(g);
    if (lethal) {
      eq(g.state().phase, 'challengeFailed'); eq(g.state().bossHp, 7); eq(g.state().score, 0); eq(g.state().bossWins, 0);
      tick(g, 30); eq(g.state().score, 0); eq(g.state().progress.challenges.bosses, emptyOperationRecord());
    } else {
      eq(g.state().phase, 'playing'); eq(g.state().bossHp, 0); eq(g.state().score, 1300); eq(g.state().bossWins, 0);
      eq(g.read('bombs.length'), 0); tick(g); eq(g.state().phase, 'bossBreak'); eq(g.state().bossWins, 1);
    }
  }
});

test('blocked storage supports challenge completion, retry and independent in-memory records', () => {
  for (const id of operationIds) {
    const g = operation(id, { blocked: true }); eq(g.state().storageAvailable, false);
    const otherModes = savedOtherModes(g);
    if (id === 'counter') reflectShots(g, 5);
    if (id === 'bosses') {
      for (let index = 0; index < 3; index++) { finishArena(g); if (index < 2) g.click('start'); }
    } else finishOperation(g);
    eq(g.state().phase, 'challengeClear'); eq(g.state().progress.challenges[id].clears, 1); eq(g.values.size, 0);
    eq(savedOtherModes(g), otherModes); const record = g.state().progress.challenges[id];
    g.click('start'); g.run('player.inv=0;player.lives=1;hurt(player.hp);');
    eq(g.state().phase, 'challengeFailed'); eq(g.state().progress.challenges[id], record); eq(g.values.size, 0);
    g.click('start'); eq(g.state().phase, 'playing'); eq(g.state().challengeId, id);
  }
});

test('stationary held fire alone cannot complete the unmodified three-boss gauntlet', () => {
  const g = operation('bosses');
  for (let index = 0; index < 3; index++) {
    eq(g.state().bossHp, [66, 94, 121][index]);
    g.key('j'); until(g, () => g.state().phase !== 'playing', 1800); g.key('j', false);
    if (g.state().phase !== 'bossBreak') break;
    g.click('start');
  }
  eq(g.state().phase, 'challengeFailed'); eq(g.state().lives, 0);
  eq(g.state().stage, 3); eq(g.state().bossWins, 2); eq(g.state().stageDeaths, 1);
  eq(g.state().progress.challenges.bosses, emptyOperationRecord());
});

test('active movement, reflected fire and beam dodges win the full gauntlet at human-scale input cadences', () => {
  for (const cadence of [6, 12, 18]) for (const offset of [0, 3, 5]) {
    const g = operation('bosses');
    let polls = 0;
    const tap = key => { g.key(key); g.key(key, false); };
    // Read-only observations and genuine key events only. The bot cannot alter
    // HP, positions, projectiles, cooldowns, timers, boss state or randomness.
    for (let index = 0; index < 3; index++) {
      eq(g.state().bossHp, [66, 94, 121][index]);
      let frame = 0, dodgedThisBeam = false;
      g.key('j');
      while (g.state().phase === 'playing' && frame < 2400) {
        if ((frame + offset) % cadence === 0) {
          const s = g.state(); polls++;
          g.key('d', s.x < 680);
          const threatened = s.hostiles.some(b => b.x > s.x && b.x < s.x + 27 + 100 &&
            b.y > s.y - 15 && b.y < s.y + s.playerHeight + 15);
          if (s.dashCooldown === 0 && threatened) tap('l');
          if (s.bossAttackType === 'beam' && s.bossCharge > 0 && s.bossCharge <= .38 && !dodgedThisBeam) {
            if (s.bossBeamY > 405) tap('w'); else g.key('s');
            dodgedThisBeam = true;
          }
          if (s.bossCharge === 0 && s.bossBeamTime === 0) { g.key('s', false); dodgedThisBeam = false; }
        }
        tick(g); frame++;
      }
      for (const key of ['j', 'd', 's']) g.key(key, false);
      const s = g.state(), context = `${cadence * 1000 / 60}ms cadence, offset ${offset}, boss ${index + 1}`;
      eq(s.phase, index < 2 ? 'bossBreak' : 'challengeClear', context);
      eq(s.bossWins, index + 1, context); assert(s.hp > 0, context); eq(s.lives, 1, context);
      eq(s.stageDeaths, 0, context);
      if (index < 2) g.click('start');
    }
    const s = g.state();
    eq(s.score, 4400 + s.hp * 100 + s.grenades * 25); eq(s.progress.challenges.bosses.clears, 1);
    assert(s.challengeReflections > 0 && polls > 10);
    assert(s.challengeTime > 20 && s.challengeTime < 60);
  }
});

console.log(`\nOK  Pixel Raid: ${passed} deterministic expedition, combat and operation contracts passed`);
