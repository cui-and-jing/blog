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
import { survivalTactics } from './lib/raid-survival-tactics.mjs';
import { recoveryTactics } from './lib/raid-recovery-tactics.mjs';
import { beaconTactics } from './lib/raid-beacon-tactics.mjs';
import { captureRaidCombatProof, validRaidCombatProof } from './lib/raid-combat-proof.mjs';

const source = fs.readFileSync(new URL('../public/games/pixelraid.html', import.meta.url), 'utf8');
const inline = source.match(/<script>\s*([\s\S]*?)<\/script>/i)?.[1];
assert(inline, 'Pixel Raid must contain an inline game script');
const entry = "resetStage(0,null);phase='title';hud();draw();window.__raidReady=true;requestAnimationFrame(loop);";
assert.equal(inline.split(entry).length, 2, 'Exact game initialization anchor changed');
assert(!source.includes('__raidQA'), 'Mutable test hooks must never be published');
const injected = inline.replace(entry, 'window.__raidQA = code => eval(code);' + entry);
const STORE = 'pixel-raid.progress.v1';

function createGame({ storage = {}, blocked = false, reducedMotion = false, randomSeed = 16437 } = {}) {
  const nodes = new Map(), events = new Map(), documentEvents = new Map();
  const values = new Map(Object.entries(storage));
  let queued = null, now = 0, seed = randomSeed, gamepads = [];
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const attrsFrom = (text) => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)]
    .map((match) => [match[1], match[2] ?? '']));
  const matches = (element, selector) => {
    if (selector.includes(',')) return selector.split(',').some(part => matches(element, part.trim()));
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
        id, tagName: tag.toUpperCase(), parentElement: null, children: [], open: Object.hasOwn(attrs, 'open'), hidden: Object.hasOwn(attrs, 'hidden'),
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
        hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
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
        click() { this.dispatch('click',{detail:0}); if (this.tagName === 'SUMMARY') this.parentElement.open = !this.parentElement.open; },
        blur() { if (document.activeElement === this) document.activeElement = null; },
        focus() { document.activeElement = this; },
        setPointerCapture() {}, releasePointerCapture() {},
        contains(candidate) { for (let current = candidate; current; current = current.parentElement) if (current === this) return true; return false; },
        closest(selector) { for (let current = this; current; current = current.parentElement) if (matches(current, selector)) return current; return null; },
        querySelectorAll(selector) { return [...nodes.values()].filter(candidate => candidate !== this && this.contains(candidate) && matches(candidate, selector)); },
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
        scrollIntoView() {},
        getClientRects() {
          for (let current = this; current; current = current.parentElement) if (current.hidden) return [];
          return nodes.get('game-page')?.classList.contains('title-screen') && ['pause', 'restart'].includes(this.id) ? [] : [{}];
        },
        // Semantic visibility only. Actual CSS, clipping and scroll behavior are
        // verified by the separate published-page controller browser contract.
        checkVisibility() {
          for (let current = this; current; current = current.parentElement) {
            if (current.hidden) return false;
            if (current.parentElement?.tagName === 'DETAILS' && !current.parentElement.open && current.tagName !== 'SUMMARY') return false;
          }
          return !(nodes.get('game-page')?.classList.contains('title-screen') && ['pause', 'restart'].includes(this.id));
        },
      };
      for (const [name, value] of Object.entries(attrs)) {
        if (name.startsWith('data-')) item.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
      for (const name of (attrs.class ?? '').split(/\s+/).filter(Boolean)) classes.add(name);
      nodes.set(id, item);
    }
    return nodes.get(id);
  }
  // Preserve the source hierarchy for menu candidates and native details.
  // The real browser suite remains responsible for rendered visibility/layout.
  const stack = [], voids = new Set(['meta', 'link', 'br', 'hr', 'img', 'input']);
  for (const [_, closing, tag, text] of source.split('<script>')[0].matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)) {
    if (closing) { if (stack.at(-1)?.tagName === tag.toUpperCase()) stack.pop(); continue; }
    const attrs = attrsFrom(text), item = node(attrs.id ?? `${tag}-${nodes.size}`, attrs, tag);
    item.parentElement = stack.at(-1) ?? null;
    item.parentElement?.children.push(item);
    if (!voids.has(tag.toLowerCase())) stack.push(item);
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
  const win = { scrollY: 0, scrollTo(_x, y) { this.scrollY = y; }, addEventListener(name, callback) { events.set(name, callback); }, matchMedia: () => ({ matches: reducedMotion }) };
  const math = Object.create(Math);
  math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const localStorage = {
    getItem(key) { if (blocked) throw new Error('Storage denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage denied'); values.set(key, String(value)); },
    removeItem(key) { if (blocked) throw new Error('Storage denied'); values.delete(key); },
  };
  const context = {
    window: win, document, Math: math, localStorage, getComputedStyle: element => ({ visibility: element.style.visibility ?? 'visible' }),
    performance: { now: () => now }, requestAnimationFrame: (callback) => { queued = callback; },
    navigator: { getGamepads: () => gamepads },
    setTimeout: (fn) => fn(), clearTimeout() {}, console,
  };
  vm.runInNewContext(injected, context, { timeout: 5000 });
  assert(win.__raidReady && win.__raidQA, 'Game failed to initialize');
  const game = {
    win, nodes, values, document, graphics,
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
    key(key, down = true, repeat = false, options = {}) {
      events.get(down ? 'keydown' : 'keyup')?.({ key, repeat, target: document.activeElement, preventDefault() {}, ...options });
    },
    click(id) { assert(nodes.has(id), 'Missing DOM node #' + id); node(id).click(); },
    event(name) { events.get(name)?.(); },
    visibility(hidden) { document.hidden = hidden; documentEvents.get('visibilitychange')?.(); },
    pad(buttons = [], axes = [0, 0], id = 'test-controller') {
      gamepads = [{ connected: true, index: 0, id, axes, buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: buttons.includes(index) })) }];
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
test('returning to the command room restores page scroll without disturbing choices', () => {
  const g = createGame();
  g.win.scrollY = 120; g.click('mode-survival'); g.click('loadout-counter');
  eq(g.win.scrollY, 120, 'Choosing a mode or loadout must not reset page scroll');
  g.start(); g.key('p'); g.click('menu-home');
  eq(g.state().phase, 'confirmRestart');
  g.win.scrollY = 400; g.click('start');
  eq(g.state().phase, 'title'); eq(g.win.scrollY, 0);
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

// Survival uses the same production script. Private setup below arranges exact
// collision/storage boundaries; menus, rewards and simulation use real code.
const defenseModules = ['rapid', 'dash', 'armor', 'pierce', 'reflect', 'blast'];
function defense(options) {
  const g = createGame(options);
  g.click('mode-survival');
  if(options?.loadout)g.click('loadout-'+options.loadout);
  g.click('start');
  eq(g.state().mode, 'survival'); eq(g.state().phase, 'playing');
  return g;
}
function finishDefenseWave(g) {
  g.run('spawnTime=0; enemies.forEach(e=>e.dead=true);boss.dead=true;boss.hp=0;'); tick(g);
  eq(g.state().phase, 'waveClear');
}
function supplyModule(g, key) {
  finishDefenseWave(g);
  // Arrange the offered card, not its effect. Selection/confirmation still run
  // through the exact public buttons and production nextWave implementation.
  g.run(`supplyOffers=[${JSON.stringify(key)},'heal','ammo'];selectedSupply=null;`);
  g.click('supply-0'); g.click('start');
}
function nonDefenseRecords(g) {
  const { survival, ...other } = g.state().progress;
  return other;
}

test('survival title tab and start use an independent fixed standard loadout', () => {
  const g = createGame(); g.click('difficulty-relaxed');
  const other = nonDefenseRecords(g);
  g.click('mode-survival');
  eq(g.state().phase, 'title'); eq(g.state().titleView, 'survival');
  eq(g.nodes.get('mode-survival').getAttribute('aria-pressed'), 'true');
  assert(!g.nodes.get('survival-menu').hidden && !g.nodes.get('start').hidden);
  for (const id of ['challenge-menu', 'difficulty-options', 'stage-menu', 'survival-options']) {
    assert(g.nodes.get(id).hidden, id + ' must not leak into survival title');
  }
  g.click('start'); const s = g.state();
  eq(s.mode, 'survival'); eq(s.difficulty, 'standard'); eq(s.survivalWave, 1);
  eq(s.hp, 6); eq(s.maxHp, 6); eq(s.lives, 1); eq(s.grenades, 3);
  eq(s.upgrades, Object.fromEntries(defenseModules.map(key => [key, 0])));
  eq(s.worldWidth, 960); eq(s.cam, 0); eq(s.intelTotal, 0); eq(s.bossHp, 0);
  eq(g.read('stage.gaps'), []); eq(g.read('stage.checkpoints'), []);
  eq(nonDefenseRecords(g), other); assert(!g.nodes.get('mission-hud').hidden);
  g.key('p'); g.click('menu-home'); g.click('start');
  eq(g.state().phase, 'title'); eq(g.state().difficulty, 'relaxed'); eq(nonDefenseRecords(g), other);
});

test('survival telegraphs prevent damage, contact, shots and premature empty-wave clears', () => {
  const g = defense();
  g.run(`player.x=enemies[0].x;player.y=G-player.h;player.inv=0;
    enemies.forEach(e=>e.shot=0);projectile(enemies[0].x+15,enemies[0].y+18,0,0,'p',99);
    boom(enemies[0].x+15,enemies[0].y+18);`);
  const original = g.read('enemies.map(e=>({x:e.x,y:e.y,hp:e.hp}))');
  tick(g, 60);
  eq(g.state().hp, 6); eq(g.state().score, 0); assert(g.state().spawnTime > 1);
  eq(g.read('enemies.map(e=>({x:e.x,y:e.y,hp:e.hp}))'), original);
  eq(g.state().hostiles, []); eq(g.state().survivalCleared, 0);
  g.run('enemies=[];finishWave();'); eq(g.state().phase, 'playing');
  tick(g, 10); eq(g.state().phase, 'playing'); eq(g.state().progress.survival.wave, 0);
});

test('survival occupied spawns relocate once with a bounded invulnerable arrival warning', () => {
  for (const side of ['left', 'right']) {
    const g = defense(), origin = side === 'left' ? 140 : 790, destination = side === 'left' ? 820 : 100;
    g.run(`enemies=[makeEnemy(${origin},'walker')];player.x=${origin};player.inv=0;spawnTime=DT/2;`);
    tick(g); eq(g.read('enemies[0].x'), destination); eq(g.read('enemies[0].home'), destination);
    assert(g.state().enemies[0].arrival > .5 && g.state().enemies[0].arrival <= .6);
    eq(g.state().hp, 6); eq(g.state().hostiles, []); eq(g.state().phase, 'playing');
    g.run(`player.x=${destination};projectile(enemies[0].x+15,enemies[0].y+18,0,0,'p',99);
      boom(enemies[0].x+15,enemies[0].y+18);`);
    tick(g, 12); eq(g.state().hp, 6); eq(g.read('enemies[0].hp'), 3); eq(g.state().hostiles, []);
    eq(g.read('enemies[0].x'), destination, 'Arrival must not chase or repeatedly relocate');
    g.run('player.x=480;bullets=[];'); tick(g, 30);
    eq(g.state().enemies[0].arrival, 0); assert(g.read('enemies[0].x') !== destination);
    eq(g.state().phase, 'playing'); eq(g.state().survivalCleared, 0);
  }
});

test('survival distant enemies stay active and shields leave a real flank window', () => {
  for (const type of ['walker', 'turret']) {
    const g = defense();
    g.run(`spawnTime=0;player.x=8;player.inv=100;enemies=[makeEnemy(820,${JSON.stringify(type)})];enemies[0].shot=0;`);
    tick(g);
    assert(g.read('enemies[0].x-player.x') > 570);
    if (type === 'walker') {
      assert(g.read('enemies[0].x') < 820); eq(g.state().hostiles.length, 1);
      near(g.read('Math.hypot(bullets[0].vx,bullets[0].vy)'), 235);
    } else {
      near(g.state().turretCharge, .8); eq(g.state().hostiles.length, 0);
      tickUntil(g, 'bullets.length>0', 60); near(g.read('Math.hypot(bullets[0].vx,bullets[0].vy)'), 315);
    }
  }
  const g = defense();
  g.run(`spawnTime=0;player.x=450;player.inv=100;enemies=[{...makeEnemy(300,'shield'),shot:100,face:-1}];
    projectile(324,G-18,-650,0,'p');`);
  tick(g); eq(g.read('enemies[0].face'), -1); eq(g.read('enemies[0].hp'), 4);
  tick(g, 24); eq(g.read('enemies[0].face'), -1, 'A newly flanked shield must not instantly rotate');
  tick(g, 18); eq(g.read('enemies[0].face'), 1, 'The flank window must also end');
});

test('survival arena boundaries do not trigger a campaign exit or change the camera', () => {
  const g = defense(); g.run('player.inv=100;spawnTime=100;');
  for (const [key, target] of [['a', 8], ['d', 927]]) {
    g.key(key); tick(g, 250); g.key(key, false);
    eq(g.state().x, target); eq(g.state().cam, 0); eq(g.state().phase, 'playing');
    eq(g.state().survivalCleared, 0); eq(g.state().stageStars, 0);
  }
  eq(g.state().progress.survival, { wave: 0, best: 0 }); eq(g.state().unlocked, 1);
});

test('survival clear saves once, removes hazards and requires exactly one confirmed supply', () => {
  const g = defense(); const other = nonDefenseRecords(g);
  g.run(`spawnTime=0;enemies.forEach(e=>e.dead=true);player.hp=2;player.grenades=6;points=100;
    projectile(850,100,0,0,'e');bombs.push({x:850,y:100,vx:0,vy:0,timer:10,r:8});`);
  tick(g);
  eq(g.state().phase, 'waveClear'); eq(g.state().survivalCleared, 1); eq(g.state().score, 350);
  eq(g.state().hp, 3); eq(g.state().grenades, 7); eq(g.state().progress.survival, { wave: 1, best: 350 });
  eq(g.state().bullets, 0); eq(g.read('bombs.length'), 0); eq(nonDefenseRecords(g), other);
  const offers = g.state().supplyOffers;
  eq(offers.length, 3); eq(new Set(offers).size, 3); eq(offers[2], 'heal');
  assert(offers.slice(0, 2).every(key => defenseModules.includes(key)));
  const cleared = g.state(); g.run('finishWave();finishWave();'); tick(g, 240); eq(g.state(), cleared);
  g.click('start'); eq(g.state(), cleared, 'Unselected Continue must be inert');
  for (const invalid of [-1, 3, 1.5, '0', null]) g.run(`chooseSupply(${JSON.stringify(invalid)})`);
  eq(g.state().selectedSupply, null);
  g.click('supply-0'); g.click('supply-0');
  eq(g.state().upgrades[offers[0]], 0, 'Selecting a card must not apply it');
  g.click('start'); g.click('start');
  eq(g.state().survivalWave, 2); eq(g.state().phase, 'playing'); eq(g.state().upgrades[offers[0]], 1);
  eq(g.state().score, 350); eq(g.state().progress.survival, { wave: 1, best: 350 });
});

test('survival confirmation cancellation preserves the exact offers and selected reward', () => {
  for (const selected of [false, true]) for (const action of ['restart', 'menu-home']) {
    const g = defense(); finishDefenseWave(g);
    if (selected) g.click('supply-1');
    const before = g.state();
    for (let repeat = 0; repeat < 3; repeat++) {
      g.click(action); eq(g.state().phase, 'confirmRestart');
      tick(g, 90); g.click('cancel-restart');
      eq(g.state(), before); eq(g.nodes.get('start').disabled, !selected);
      eq(g.nodes.get('supply-1').getAttribute('aria-pressed'), String(selected));
    }
  }
});

test('survival last-enemy kill never saves a posthumous clear in either projectile order', () => {
  for (const killFirst of [false, true]) {
    const g = defense();
    const hitPlayer = "projectile(player.x+12,player.y+20,0,0,'e');";
    const killEnemy = "projectile(enemies[0].x+15,enemies[0].y+18,0,0,'p');";
    g.run(`spawnTime=0;player.hp=1;player.inv=0;player.x=500;bullets=[];
      enemies=[makeEnemy(150,'turret')];enemies[0].hp=1;enemies[0].shot=100;
      ${killFirst ? hitPlayer + killEnemy : killEnemy + hitPlayer}`);
    tick(g); eq(g.state().phase, 'survivalOver'); eq(g.state().lives, 0);
    eq(g.state().survivalCleared, 0); eq(g.state().progress.survival, { wave: 0, best: 0 });
    eq(g.state().score, killFirst ? 160 : 0);
    const terminal = g.state(); tick(g, 120); g.frames(30); eq(g.state(), terminal);
  }
  const grenade = defense();
  grenade.run(`spawnTime=0;player.hp=1;player.inv=0;player.x=500;
    enemies=[makeEnemy(150,'turret')];enemies[0].shot=100;
    bombs.push({x:165,y:G-17,vx:0,vy:0,timer:0,r:8});projectile(player.x+12,player.y+20,0,0,'e');`);
  tick(grenade); eq(grenade.state().phase, 'survivalOver'); eq(grenade.state().score, 0);
  eq(grenade.state().progress.survival, { wave: 0, best: 0 });
});

test('survival modules apply once, stop at rank two and are omitted from capped offers', () => {
  for (const key of defenseModules) {
    const g = defense();
    for (let rank = 1; rank <= 3; rank++) {
      g.run('player.hp=1;'); supplyModule(g, key);
      eq(g.state().upgrades[key], Math.min(2, rank));
      if (key === 'armor') {
        eq(g.state().maxHp, 6 + Math.min(2, rank)); eq(g.state().hp, g.state().maxHp);
      }
    }
    finishDefenseWave(g); assert(!g.state().supplyOffers.includes(key), key + ' must not be offered at cap');
  }
});

test('survival rapid and dash ranks change actual cooldowns without reaching zero', () => {
  for (const rank of [0, 1, 2]) {
    const g = defense();
    for (let level = 0; level < rank; level++) supplyModule(g, 'rapid');
    g.run('fire();'); near(g.read('player.shoot'), .15 * .8 ** rank);
    g.run(`upgrades.dash=${rank};dash();`); near(g.state().dashCooldown, 2.4 - .6 * rank);
    eq(g.read('player.dashTime'), .18);
  }
  const g = defense(); g.run('upgrades.dash=999;dash();'); near(g.state().dashCooldown, 1.2);
});

test('survival piercing has a finite target budget and never hits the same enemy twice', () => {
  for (const rank of [0, 1, 2]) {
    const g = defense();
    g.run(`spawnTime=0;player.inv=100;player.x=600;upgrades.pierce=${rank};
      enemies=Array.from({length:4},()=>({...makeEnemy(300,'turret'),hp:20,maxHp:20,shot:100}));
      projectile(310,G-17,0,0,'p');`);
    tick(g); eq(g.read('enemies.map(e=>e.hp)'), Array.from({ length: 4 }, (_, i) => i <= rank ? 19 : 20));
    eq(g.state().bullets, 0);
  }
  const g = defense();
  g.run(`spawnTime=0;player.inv=100;player.x=600;upgrades.pierce=2;
    enemies=[{...makeEnemy(300,'turret'),hp:20,maxHp:20,shot:100}];projectile(310,G-17,0,0,'p');`);
  tick(g, 30); eq(g.read('enemies[0].hp'), 19); eq(g.read('bullets[0].pierce'), 1);
  eq(g.read('bullets[0].hitEnemies.length'), 1);
});

test('survival piercing is stopped by a frontal shield while reflected damage bypasses it', () => {
  for (const rank of [0, 1, 2]) {
    const g = defense();
    g.run(`spawnTime=0;player.inv=100;player.x=100;upgrades.pierce=2;upgrades.reflect=${rank};
      enemies=[{...makeEnemy(300,'shield'),shot:100},{...makeEnemy(325,'turret'),shot:100}];
      projectile(296,G-18,650,0,'p');`);
    tick(g); eq(g.read('enemies[0].hp'), 5); eq(g.read('enemies[1].hp'), 4); eq(g.state().bullets, 0);
    g.run(`projectile(296,G-18,0,0,'e');bullets[0].sourceX=600;reflectBullet(bullets[0]);`);
    eq(g.read('bullets[0].damage'), 2 + rank); eq(g.read('bullets[0].pierce'), 0);
    tick(g); eq(g.read('enemies[0].hp'), 3 - rank); eq(g.state().reflections, 1);
    eq(g.state().challengeReflections, 0); eq(g.state().bullets, 0);
  }
});

test('survival blast ranks extend radius and damage, removing only nearby hostile shots', () => {
  for (const rank of [0, 1, 2]) {
    const g = defense(), radius = 112 + 24 * rank;
    g.run(`spawnTime=0;upgrades.blast=${rank};
      enemies=[0,${radius - 1},${radius + 1}].map(dx=>({...makeEnemy(100+dx-15,'turret'),y:200,hp:50,maxHp:50,shot:100}));
      bullets=[];projectile(100,218,0,0,'p');projectile(100,218,0,0,'e');projectile(${100 + radius + 1},218,0,0,'e');
      boom(100,218);`);
    eq(g.read('enemies.map(e=>e.hp)'), [44 - 2 * rank, 44 - 2 * rank, 50]);
    eq(g.read("bullets.filter(b=>b.owner==='p').length"), 1);
    eq(g.read("bullets.filter(b=>b.owner==='e').length"), rank ? 1 : 2);
  }
});

test('survival capped builds still offer three distinct usable recovery choices', () => {
  for (const lastUncapped of [null, 'blast']) for (const choice of ['heal', 'ammo', 'boost']) {
    const g = defense();
    g.run(`for(const key of MODULES)upgrades[key]=2;${lastUncapped ? "upgrades.blast=1;" : ''}
      player.hp=1;player.grenades=0;`);
    finishDefenseWave(g);
    const expected = lastUncapped ? ['blast', 'heal', 'ammo'] : ['heal', 'ammo', 'boost'];
    eq(g.state().supplyOffers, expected); eq(new Set(g.state().supplyOffers).size, 3);
    if (!expected.includes(choice)) continue;
    g.click('supply-' + expected.indexOf(choice)); g.click('start');
    eq(g.state().phase, 'playing'); eq(g.state().survivalWave, 2);
    if (choice === 'heal') eq(g.state().hp, 8);
    if (choice === 'ammo') { eq(g.state().grenades, 4); eq(g.state().weaponTime, 20); }
    if (choice === 'boost') { eq(g.read('player.boost'), 20); eq(g.state().weaponTime, 20); }
  }
  const full = defense(); full.run('for(const key of MODULES)upgrades[key]=2;player.hp=8;player.grenades=7;');
  finishDefenseWave(full); full.click('supply-2'); full.click('start');
  eq(full.read('player.boost'), 20); eq(full.state().hp, 8); eq(full.state().grenades, 7);
});

test('survival pause, background and confirmation freeze gameplay and clear held inputs', () => {
  for (const interrupt of ['pause', 'blur', 'visibility', 'confirm']) {
    const g = defense(); g.key('j'); g.key('d'); g.key('l'); tick(g, 12);
    if (interrupt === 'pause') g.key('p');
    else if (interrupt === 'blur') g.event('blur');
    else if (interrupt === 'visibility') g.visibility(true);
    else g.click('restart');
    const paused = g.state(); tick(g, 300); g.frames(120); eq(g.state(), paused);
    eq(g.read('held.size'), 0); eq(g.read('padHeld.size'), 0); eq(g.state().touchCount, 0);
    if (interrupt === 'visibility') g.visibility(false);
    g.click(interrupt === 'confirm' ? 'cancel-restart' : 'start');
    const shots = g.state().shots; tick(g); eq(g.state().shots, shots); eq(g.state().phase, 'playing');
    assert(g.state().spawnTime < paused.spawnTime && g.state().survivalTime > paused.survivalTime);
  }
});

test('survival records persist completed waves only and leave every other mode unchanged', () => {
  const seeded = {
    version: 1, unlocked: 3, selectedDifficulty: 'relaxed', survival: { wave: 1, best: 100 },
    campaign: { standard: { best: 321, stars: [7, 5, 1] }, relaxed: { best: 654, stars: [5, 7, 7] } },
    practice: { standard: { best: 222, stars: [1, 5, 7] }, relaxed: { best: 333, stars: [7, 1, 5] } },
    challenges: Object.fromEntries(operationIds.map((id, i) => [id, { clears: i + 1, best: 500 + i, bestTime: 1000 + i }])),
  };
  const g = defense({ storage: { [STORE]: JSON.stringify(seeded) } }); const other = nonDefenseRecords(g);
  g.run('addPoints(600);'); eq(g.state().progress.survival, seeded.survival);
  finishDefenseWave(g); const saved = g.state().progress.survival;
  eq(saved, { wave: 1, best: 850 }); eq(JSON.parse(g.values.get(STORE)).survival, saved);
  g.click('supply-2'); g.click('start'); g.run('addPoints(5000);player.inv=0;hurt(player.hp);');
  eq(g.state().phase, 'survivalOver'); eq(g.state().progress.survival, saved); eq(nonDefenseRecords(g), other);
  eq(JSON.parse(g.values.get(STORE)).survival, saved);
  const reloaded = createGame({ storage: Object.fromEntries(g.values) });
  eq(reloaded.state().phase, 'title'); eq(reloaded.state().progress.survival, saved); eq(nonDefenseRecords(reloaded), other);
  g.click('start'); eq(g.state().survivalWave, 1); eq(g.state().score, 0); eq(g.state().hp, 6);
  eq(g.state().upgrades, Object.fromEntries(defenseModules.map(key => [key, 0])));
});

test('survival malformed and blocked storage never prevent starting or clearing a wave', () => {
  const cases = [
    ['{broken', { wave: 0, best: 0 }],
    [JSON.stringify({ version: 1 }), { wave: 0, best: 0 }],
    [JSON.stringify({ version: 1, survival: { wave: -2, best: '900', extra: true } }), { wave: 0, best: 0 }],
    [JSON.stringify({ version: 1, survival: { wave: 3.9, best: 222.9 } }), { wave: 3, best: 222 }],
    [JSON.stringify({ version: 1, survival: { wave: 1e9, best: 1e20 } }), { wave: 9999, best: 9999999 }],
    [JSON.stringify({ version: 5, survival: { wave: 50, best: 9000 } }), { wave: 0, best: 0 }],
    [' '.repeat(12001), { wave: 0, best: 0 }],
  ];
  for (const [raw, expected] of cases) {
    const g = defense({ storage: { [STORE]: raw } }); eq(g.state().progress.survival, expected);
    finishDefenseWave(g); eq(g.state().phase, 'waveClear');
    eq(Object.keys(g.state().progress.survival).sort(), ['best', 'wave']);
  }
  const blocked = defense({ blocked: true }); const other = nonDefenseRecords(blocked);
  finishDefenseWave(blocked); eq(blocked.state().storageAvailable, false); eq(blocked.values.size, 0);
  eq(blocked.state().progress.survival, { wave: 1, best: 250 }); eq(nonDefenseRecords(blocked), other);
  blocked.click('supply-2'); blocked.click('start'); blocked.run('player.inv=0;hurt(player.hp);');
  blocked.click('start'); eq(blocked.state().phase, 'playing'); eq(blocked.state().survivalWave, 1);
  eq(blocked.state().progress.survival, { wave: 1, best: 250 }); eq(blocked.values.size, 0);
});

test('survival long runs keep enemy and offer arrays bounded and introduce every enemy type', () => {
  const g = defense();
  for (let wave = 1; wave <= 60; wave++) {
    eq(g.state().survivalWave, wave); const enemies = g.state().enemies;
    eq(enemies.length, wave%3===0?0:Math.min(8, 3 + Math.floor(wave / 2)));
    eq(g.state().bossWave,wave%3===0);
    if(wave%3===0){assert(g.state().bossHp>=32&&g.state().bossHp<=104);eq(g.state().bossAttacks,0);eq(g.state().bossBeamTime,0);}
    if (wave === 1) assert(enemies.every(e => e.type === 'walker'));
    if (wave === 2) assert(enemies.some(e => e.type === 'drone'));
    if (wave === 4) for (const type of ['turret', 'shield']) assert(enemies.some(e => e.type === type));
    assert(enemies.every(e => e.x >= 60 && e.x + e.w <= 900 && e.hp <= 11));
    eq(g.state().bullets, 0); eq(g.read('bombs.length'), 0);
    eq(g.read('pickups.length'), 2); eq(g.read('sparks.length'), 0);
    finishDefenseWave(g);
    eq(g.state().supplyOffers.length, 3); eq(new Set(g.state().supplyOffers).size, 3);
    g.click('supply-0'); g.click('start');
    assert(Object.values(g.state().upgrades).every(rank => rank >= 0 && rank <= 2));
  }
  eq(g.state().progress.survival.wave, 60); eq(g.state().survivalWave, 61);
});

test('survival input controller escapes overlapping ground threats without oscillating or editing snapshots', () => {
  const decide = survivalTactics();
  const state = { x: 400, y: 381, playerHeight: 44, enemies: [
    { x: 390, y: 389, w: 30, h: 36, type: 'walker' },
    { x: 400, y: 240, w: 38, h: 26, type: 'drone' },
  ], hostiles: [], bossWave: false, dashTime: 0, dashCooldown: 0,
  spawnTime: 0, survivalTime: 3, grenades: 3 };
  const before = JSON.stringify(state), first = decide(state);
  eq(first.move, 'd'); eq(first.jump, false); eq(first.dash, true); eq(first.grenade, false);
  eq(JSON.stringify(state), before);
  // Keep the escape direction even if the nearest center crosses sides.
  state.enemies[0].x = 420;
  eq(decide(state).move, 'd');
  state.enemies[0].x = 190; state.enemies[0].type = 'shield'; state.enemies.pop();
  const safe = decide(state);
  eq(safe.move, 'a'); eq(safe.grenade, true);
  eq(decide(state).move, ''); eq(decide(state).grenade, false);
  // Near the edge, escape across the threat instead of running into the wall.
  const edge = survivalTactics();
  eq(edge({ ...state, x: 20, enemies: [{ ...state.enemies[0], x: 35 }] }).move, 'd');
  const orient = survivalTactics(), right = { ...state, enemies: [{ ...state.enemies[0], x: 600 }] };
  eq(orient(right).move, 'd'); eq(orient(right).move, '');
  const ledge = survivalTactics(), below = { ...state, x: 500, y: 241, enemies: [{ ...state.enemies[0], x: 500 }] };
  eq(ledge(below).move, 'd');
  eq(ledge({ ...below, x: 600 }).move, 'd');
  eq(ledge({ ...below, x: 800, y: 381 }).move, 'a');
});

test('all three loadouts clear four waves across varied timing and seeds using only genuine inputs', () => {
  let totalReflections = 0;
  for (const randomSeed of [1, 42, 16437, 71901]) for (const loadout of ['assault', 'counter', 'demolition']) {
    for (const cadence of [5, 12]) {
      const g = defense({ randomSeed, loadout }), tap = key => { g.key(key); g.key(key, false); };
      const encountered = new Set(); let frame = 0, decisions = 0, reflected = 0;
      // Seed only the VM fixture before initialization. Thereafter this is the
      // same read-only controller used by Chromium: real keys and menu clicks.
      for (let wave = 1; wave <= 4; wave++) {
        const decide = survivalTactics();
        eq(g.state().survivalWave, wave); g.key('j');
        let duration = 0;
        while (g.state().phase === 'playing' && duration < 3600) {
          if (frame % cadence === 0) {
            decisions++;
            const s = g.state(); s.enemies.forEach(enemy => encountered.add(enemy.type));
            const input = decide(s);
            g.key('a', input.move === 'a'); g.key('d', input.move === 'd');
            if (input.jump && s.ground) { g.key('w', false); g.key('w'); }
            else if (!input.jump) g.key('w', false);
            if (input.dash) tap('l');
            if (input.grenade) tap('k');
          }
          tick(g); duration++; frame++;
        }
        for (const key of ['a', 'd', 'w', 'j']) g.key(key, false);
        const s = g.state();
        eq(s.phase, 'waveClear', `Loadout ${loadout}, seed ${randomSeed}, cadence ${cadence}, wave ${wave}: ` + JSON.stringify(s));
        eq(s.survivalCleared, wave); eq(s.lives, 1); assert(s.hp > 0); eq(s.stageDeaths, 0); reflected += s.reflections;
        assert(duration > 132 && duration < 3600, 'Opening waves must resolve in under one active minute');
        if (wave < 4) {
          let choice = s.supplyOffers.indexOf('armor');
          if (choice < 0) choice = s.hp < 4 ? s.supplyOffers.indexOf('heal') : 0;
          g.click('supply-' + Math.max(0, choice)); g.click('start');
        }
      }
      eq([...encountered].sort(), ['charger', 'drone', 'shield', 'turret', 'walker']);
      // Explosive devices can clear a route before a reflection opportunity.
      totalReflections += reflected; assert(decisions > 20); eq(g.state().progress.survival.wave, 4);
      eq(g.state().progress.survival.best, g.state().score);
    }
  }
  assert(totalReflections > 0, 'The replay set must still exercise live reflections');
});


function defenseBoss(wave = 3, options) {
  const g = defense(options);
  g.run(`survivalWave=${wave-1};startWave();`);
  return g;
}

test('survival boss waves rotate archetypes with bounded strength and reset all transient attacks', () => {
  const g = defense();
  for (const wave of [3, 6, 9, 12, 15, 18, 48, 9999]) {
    g.run(`boss.attacks=9;boss.beamTime=1;boss.windup=1;survivalWave=${wave-1};startWave();`);
    const s = g.state();
    eq(s.bossWave,true); eq(s.enemies,[]); eq(s.stage,Math.floor((wave-1)/3)%3+1);
    eq(s.bossHp,[32,44,56][s.stage-1]+Math.min(48,Math.floor((wave-1)/9)*12));
    eq(s.bossMaxHp,s.bossHp);eq(s.bossAttacks,0);eq(s.bossBeamTime,0);eq(s.bossCharge,0);
    eq(s.spawnTime,2.2);eq(s.worldWidth,960);eq(g.read('stage.gaps'),[]);
    assert(g.read('pickups.every(p=>p.x<boss.x-player.w-14)'), 'No supply behind a solid boss boundary');
    assert(g.nodes.get('mission-name').textContent.includes('首领战'));
    g.run('draw();');
  }
});

test('boss ingress blocks all damage and never clears merely because there are no minions', () => {
  const g = defenseBoss();
  g.run(`boss.shot=0;player.inv=0;player.x=boss.x;damageBoss(999);boom(boss.x+50,boss.y+52);
    projectile(boss.x+50,boss.y+52,0,0,'p',999);finishWave();`);
  tick(g,60);
  eq(g.state().bossHp,32);eq(g.state().hp,6);eq(g.state().score,0);eq(g.state().hostiles,[]);
  eq(g.state().phase,'playing');eq(g.state().survivalCleared,0);eq(g.state().x,749);
  g.key('p');const paused=g.state();tick(g,60);eq(g.state().spawnTime,paused.spawnTime);
  g.click('restart');g.click('cancel-restart');eq(g.state().phase,'pause');
  g.click('start');g.run('bullets=[];');tick(g,80);
  eq(g.state().spawnTime,0);eq(g.state().phase,'playing');eq(g.state().survivalCleared,0);
  g.run('damageBoss(1);');eq(g.state().bossHp,31);
});

test('survival boss arena retains leftward and rightward boundaries without triggering exit', () => {
  const g = defenseBoss();g.run('player.inv=100;');
  g.key('d');tick(g,180);g.key('d',false);eq(g.state().x,749);eq(g.state().cam,0);
  g.key('a');tick(g,220);g.key('a',false);eq(g.state().x,8);eq(g.state().cam,0);
  eq(g.state().phase,'playing');eq(g.state().survivalCleared,0);
});

test('all survival boss patterns remain active across the whole arena, including low and high beams', () => {
  for(const wave of [3,6,9]) {
    const g=defenseBoss(wave);g.run('spawnTime=0;player.x=8;player.inv=100;boss.shot=0;');
    tick(g);assert(g.state().bossCharge>0, 'Boss cannot sleep at the left edge');
    if(wave<9){
      tick(g,44);eq(g.state().bossAttacks,1);eq(g.state().bossLastVolley,wave===3?1:3);
      g.run('boss.hp=boss.maxHp/2;boss.shot=0;');tick(g,45);
      eq(g.state().bossLastVolley,wave===3?3:5);
    }else{
      eq(g.state().bossAttackType,'beam');eq(g.state().bossBeamY,413);
      tick(g,64);assert(g.state().bossBeamTime>0);g.run('boss.beamTime=0;boss.attacks=2;boss.shot=0;');
      tick(g);eq(g.state().bossAttackType,'beam');eq(g.state().bossBeamY,389);
    }
  }
});

test('boss victory gives exactly one enhanced clear reward and previews the next ordinary wave', () => {
  const g=defenseBoss();const other=nonDefenseRecords(g);
  g.run('spawnTime=0;player.hp=2;player.grenades=3;damageBoss(boss.hp);');tick(g);
  eq(g.state().phase,'waveClear');eq(g.state().survivalCleared,3);eq(g.state().score,2150);
  eq(g.state().hp,4);eq(g.state().grenades,5);eq(g.state().progress.survival,{wave:3,best:2150});
  eq(nonDefenseRecords(g),other);assert(g.nodes.get('overlay-text').textContent.includes('第 4 波'));
  const score=g.state().score;g.run('finishWave();damageBoss(999);');tick(g,60);eq(g.state().score,score);
  g.click('supply-0');const selected=g.state().selectedSupply;
  g.click('restart');g.click('cancel-restart');eq(g.state().selectedSupply,selected);eq(g.state().score,score);
  g.click('start');eq(g.state().survivalWave,4);eq(g.state().bossWave,false);eq(g.state().bossHp,0);
  assert(g.state().enemies.length>0);
});

test('a simultaneous lethal boss trade never saves a completed wave in either bullet order', () => {
  for(const reverse of [false,true]) {
    const g=defenseBoss();
    g.run(`spawnTime=0;player.hp=1;player.inv=0;boss.hp=1;boss.shot=100;
      projectile(player.x+12,player.y+20,0,0,'e');projectile(boss.x+50,boss.y+52,0,0,'p');
      ${reverse?'bullets.reverse();':''}`);
    tick(g);eq(g.state().phase,'survivalOver');eq(g.state().survivalCleared,0);
    eq(g.state().progress.survival,{wave:0,best:0});tick(g,30);eq(g.state().phase,'survivalOver');
  }
});

test('synergy recipes require both modules, are derived, and do not leak into other modes', () => {
  const g=defense();eq(g.state().synergies,[]);assert(!g.nodes.get('build-panel').hidden);
  for(const [key,pair] of Object.entries(g.read('SYNERGIES')).map(([key,v])=>[key,v.pair])) {
    g.run(`upgrades=Object.fromEntries(MODULES.map(key=>[key,0]));upgrades.${pair[0]}=1;hud();`);
    eq(g.state().synergies,[]);assert(g.read(`supplyDescription('${pair[1]}')`).includes('选择后点亮'));
    g.run(`upgrades.${pair[1]}=1;hud();`);eq(g.state().synergies,[key]);
    eq(g.nodes.get('synergy-'+key).getAttribute('data-active'),'true');
    assert(!g.read(`supplyDescription('${pair[1]}')`).includes('选择后点亮'));
  }
  g.run('saveProgress();');assert(!JSON.stringify(g.state().progress).includes('synergies'));
  g.key('p');g.click('menu-home');g.click('start');eq(g.state().synergies,[]);assert(g.nodes.get('build-panel').hidden);
  g.click('mode-campaign');g.click('start');eq(g.state().synergies,[]);assert(g.nodes.get('build-panel').hidden);
});

test('piercing fire increases real rifle damage without buffing spread or bypassing shield rules', () => {
  const g=defense();
  g.run(`spawnTime=0;upgrades.rapid=1;upgrades.pierce=1;player.inv=100;player.x=100;player.face=1;
    enemies=[{...makeEnemy(150,'walker'),shot:100,hp:10,maxHp:10}];fire();`);
  eq(g.read('bullets[0].damage'),2);eq(g.read('bullets[0].pierce'),1);tick(g,5);
  eq(g.read('enemies[0].hp'),8);
  g.run("bullets=[];player.shoot=0;player.weaponTime=5;fire();");eq(g.read('bullets.map(b=>b.damage)'),[1,1,1]);
  g.run("bullets=[];player.shoot=0;player.weaponTime=0;enemies=[{...makeEnemy(150,'shield'),shot:100}];fire();");
  tick(g,5);eq(g.read('enemies[0].hp'),5);eq(g.state().bullets,0);
});

test('reflux heals once per cooldown, never consumes full-health recovery, and freezes in menus', () => {
  const g=defense();
  g.run(`upgrades.dash=1;upgrades.reflect=1;player.hp=3;
    projectile(400,350,0,0,'e');reflectBullet(bullets[0]);`);
  eq(g.state().hp,4);eq(g.state().refluxCooldown,8);eq(g.read('bullets[0].damage'),3);
  g.run("projectile(410,350,0,0,'e');reflectBullet(bullets[1]);");eq(g.state().hp,4);
  g.key('p');tick(g,180);eq(g.state().refluxCooldown,8);
  g.nodes.get('build-summary').focus();g.key('Enter');eq(g.state().phase,'pause');
  g.click('start');g.run('player.inv=100;spawnTime=100;bullets=[];');tick(g,481);eq(g.state().refluxCooldown,0);
  g.run('player.hp=maxHealth();projectile(400,350,0,0,"e");reflectBullet(bullets[0]);');
  eq(g.state().hp,6);eq(g.state().refluxCooldown,0);
  g.run('player.hp=5;projectile(410,350,0,0,"e");reflectBullet(bullets[1]);');
  eq(g.state().hp,6);eq(g.state().refluxCooldown,8);
  finishDefenseWave(g);const saved=g.state().refluxCooldown;tick(g,180);eq(g.state().refluxCooldown,saved);
  g.click('supply-0');g.click('start');eq(g.state().refluxCooldown,saved);
  g.click('restart');g.click('start');eq(g.state().refluxCooldown,0);eq(g.state().synergies,[]);
});

test('grenade recycling refunds at most once per explosion, needs a kill, and respects ammo cap', () => {
  for(const ranks of [[0,1],[1,0],[1,1],[2,2]]) {
    const g=defense();
    g.run(`spawnTime=0;upgrades.armor=${ranks[0]};upgrades.blast=${ranks[1]};player.grenades=2;
      enemies=[makeEnemy(100,'walker'),makeEnemy(125,'turret')];boom(120,G-18);`);
    eq(g.state().grenades,ranks.every(Boolean)?3:2);eq(g.state().enemies,[]);
    g.run('boom(120,G-18);');eq(g.state().grenades,ranks.every(Boolean)?3:2);
  }
  const g=defense();
  g.run(`spawnTime=0;upgrades.armor=1;upgrades.blast=1;player.grenades=7;
    enemies=[makeEnemy(100,'walker')];boom(115,G-18);`);eq(g.state().grenades,7);
  g.run(`player.grenades=0;enemies=[{...makeEnemy(100,'walker'),hp:99}];boom(115,G-18);`);eq(g.state().grenades,0);
  g.run('spawnTime=1;enemies=[makeEnemy(100,"walker")];boom(115,G-18);');eq(g.state().grenades,0);
});

test('blast upgrades extend boss damage and range, recycling a boss kill exactly once', () => {
  for(const rank of [0,1,2]) {
    const g=defenseBoss();g.run(`spawnTime=0;upgrades.blast=${rank};boom(boss.x+50,boss.y+52);`);
    eq(g.state().bossHp,32-7-2*rank);
    g.run(`boom(boss.x+50-(135+24*${rank})-1,boss.y+52);`);eq(g.state().bossHp,32-7-2*rank);
  }
  const g=defenseBoss();g.run('spawnTime=0;upgrades.armor=1;upgrades.blast=1;player.grenades=0;boss.hp=9;boom(boss.x+50,boss.y+52);');
  eq(g.state().bossHp,0);eq(g.state().grenades,1);g.run('boom(boss.x+50,boss.y+52);');eq(g.state().grenades,1);
});

test('build summary native Space and Enter never jump, resume or accept a selected supply', () => {
  const g=defense();g.nodes.get('build-summary').focus();g.key(' ');g.key(' ',false);tick(g);
  eq(g.state().ground,true);eq(g.state().jumpBuffer,0);eq(g.state().phase,'playing');
  g.key('p');g.nodes.get('build-summary').focus();g.key('Enter');eq(g.state().phase,'pause');
  g.click('start');finishDefenseWave(g);g.click('supply-0');g.nodes.get('build-summary').focus();g.key('Enter');
  eq(g.state().phase,'waveClear');eq(g.state().survivalWave,1);
});

test('point-blank rifle covers the forward body-to-muzzle interval on both facings', () => {
  for (const face of [-1, 1]) {
    const g = defense();
    g.run(`spawnTime=0;player.x=400;player.face=${face};player.inv=100;
      enemies=[{...makeEnemy(400,'turret'),w:20,shot:100,hp:20,maxHp:20}];fire();`);
    tick(g); eq(g.read('enemies[0].hp'), 19, 'Overlapping forward target must not be skipped by muzzle offset');
  }
});

test('point-blank standing, crouched and scatter shots hit forward targets without shooting behind', () => {
  for (const face of [-1, 1]) for (const crouch of [false, true]) for (const scatter of [false, true]) {
    const g = defense();
    g.run(`spawnTime=0;player.x=400;player.face=${face};player.inv=100;player.crouch=${crouch};
      player.h=${crouch ? 28 : 44};player.y=G-player.h;player.weaponTime=${scatter ? 20 : 0};
      enemies=[{...makeEnemy(400,'turret'),w:20,shot:100,hp:20,maxHp:20},
        {...makeEnemy(${face > 0 ? 370 : 437},'turret'),w:12,shot:100,hp:20,maxHp:20}];fire();`);
    if (crouch) g.key('s');
    tick(g); eq(g.read('enemies.map(e=>e.hp)'), [20 - (scatter ? 3 : 1), 20]);
    eq(g.state().lastVolley, scatter ? 3 : 1);
  }
});

test('point-blank frontal shields remain closed and a real flank still works', () => {
  for (const face of [-1, 1]) for (const front of [false, true]) {
    const g = defense();
    g.run(`spawnTime=0;player.x=400;player.face=${face};player.inv=100;upgrades.pierce=2;
      enemies=[{...makeEnemy(400,'shield'),shot:100,face:${front ? -face : face},turnTime:1}];fire();`);
    tick(g); eq(g.read('enemies[0].hp'), front ? 5 : 4);
    if (front) { eq(g.state().bullets, 0); assert(g.state().combatText.includes('盾牌格挡')); }
  }
});

test('swept rounds cannot tunnel and hit nearest targets rather than spawn-array order', () => {
  // Isolate the original enemy/boss ordering contract; mixed device contacts are covered below.
  for (const face of [-1, 1]) for (const rank of [0, 1, 2]) {
    const g = defense(), nearX = face > 0 ? 310 : 490, farX = face > 0 ? 490 : 310;
    g.run(`devices=[];spawnTime=0;player.inv=100;player.x=700;upgrades.pierce=${rank};
      enemies=[${farX},${nearX}].map(x=>({...makeEnemy(x,'turret'),w:10,shot:100,hp:20,maxHp:20}));
      projectile(${face > 0 ? 280 : 530},G-17,${face * 18000},0,'p');`);
    tick(g); eq(g.read('enemies.map(e=>e.hp)'), [rank ? 19 : 20, 19]);
  }
});

test('a swept shield stops piercing before rear targets and boss contacts obey distance order', () => {
  const g = defense();
  g.run(`devices=[];spawnTime=0;player.inv=100;player.x=700;upgrades.pierce=2;
    enemies=[{...makeEnemy(480,'turret'),shot:100},{...makeEnemy(320,'shield'),shot:100,face:-1}];
    projectile(280,G-17,18000,0,'p');`);
  tick(g); eq(g.read('enemies.map(e=>e.hp)'), [4, 5]); eq(g.state().bullets, 0);
  for (const bossFirst of [false, true]) {
    g.run(`enemies=[{...makeEnemy(${bossFirst ? 480 : 320},'turret'),shot:100,hp:20,maxHp:20}];
      boss=makeBoss(20,${bossFirst ? 320 : 480});boss.shot=100;upgrades.pierce=0;
      projectile(280,G-17,18000,0,'p');`);
    tick(g); eq(g.read('enemies[0].hp'), bossFirst ? 20 : 19); eq(g.state().bossHp, bossFirst ? 19 : 20);
  }
});

test('swept circle geometry preserves misses beside rounded corners and supports stationary shots', () => {
  const g = createGame();
  g.run('globalThis.target={x:100,y:100,w:20,h:20};');
  eq(g.read('shotImpact(90,95.1,97,95.1,5,target)===Infinity'), true, 'Expanded-square corner is not a circular hit');
  near(g.read('shotImpact(80,110,140,110,5,target)'), .25);
  near(g.read('shotImpact(140,110,80,110,5,target)'), .25);
  near(g.read('shotImpact(110,80,110,140,5,target)'), .25);
  near(g.read('shotImpact(110,140,110,80,5,target)'), .25);
  eq(g.read('shotImpact(110,110,110,110,5,target)'), 0);
  eq(g.read('shotImpact(90,90,90,90,5,target)===Infinity'), true);
  assert(g.read('shotImpact(90,90,110,110,5,target)') > 0);
});

test('fast hostile shots respect crouch, invulnerability and dash reflection across a whole tick', () => {
  for (const state of ['standing', 'crouched', 'invulnerable', 'dashing']) {
    const g = defense();
    g.run(`spawnTime=0;player.x=400;player.inv=${state === 'invulnerable' ? 10 : 0};
      player.dashTime=${state === 'dashing' ? .18 : 0};player.dashDir=1;
      enemies=[{...makeEnemy(800,'turret'),shot:100}];projectile(350,G-35,6000,0,'e');`);
    if (state === 'crouched') g.key('s');
    tick(g); eq(g.state().hp, state === 'standing' ? 5 : 6);
    eq(g.state().reflections, state === 'dashing' ? 1 : 0);
  }
});

test('muzzle traces and fast rounds cannot damage enemies or bosses during ingress', () => {
  const g = defense();
  g.run(`player.x=400;enemies=[{...makeEnemy(400,'turret'),shot:100,hp:20,maxHp:20}];fire();`);
  tick(g); eq(g.read('enemies[0].hp'), 20);
  g.run(`spawnTime=0;enemies[0].arrival=1;player.shoot=0;fire();`);
  tick(g); eq(g.read('enemies[0].hp'), 20);
  g.run(`survivalWave=2;startWave();player.x=749;player.face=1;fire();projectile(600,G-20,18000,0,'p',99);`);
  tick(g); eq(g.state().bossHp, 32); eq(g.state().phase, 'playing');
});

function kitDefense(key) {
  const g=createGame();g.click('mode-survival');g.click('loadout-'+key);g.click('start');return g;
}
test('loadout choices are title-only, explicit and do not grant module ranks or write records', () => {
  for (const [key,hp,ammo,name] of [['assault',6,3,'机动突击'],['counter',5,3,'反击先锋'],['demolition',6,5,'爆破专家']]) {
    const g=createGame(), before=g.state().progress;
    g.click('loadout-'+key);eq(g.state().selectedLoadout,'assault');
    g.click('mode-survival');g.click('loadout-'+key);g.click('loadout-'+key);
    eq(g.state().phase,'title');eq(g.state().selectedLoadout,key);eq(g.state().loadout,'assault');
    eq(g.nodes.get('loadout-'+key).getAttribute('aria-pressed'),'true');assert(g.nodes.get('loadout-status').textContent.includes(name));
    g.click('start');eq(g.state().loadout,key);eq(g.state().maxHp,hp);eq(g.state().hp,hp);eq(g.state().grenades,ammo);
    eq(g.state().upgrades,Object.fromEntries(defenseModules.map(k=>[k,0])));eq(g.state().synergies,[]);
    eq(g.state().progress,before);assert(g.nodes.get('run-label').textContent.includes(name));assert(g.nodes.get('build-summary').textContent.includes(name));
    g.click('loadout-counter');g.click('loadout-demolition');eq(g.state().loadout,key);eq(g.state().selectedLoadout,key);
    g.key('p');g.click('loadout-counter');eq(g.state().selectedLoadout,key);
    g.click('restart');g.click('cancel-restart');eq(g.state().loadout,key);eq(g.state().phase,'pause');
    g.click('restart');g.click('start');eq(g.state().loadout,key);eq(g.state().hp,hp);eq(g.state().grenades,ammo);eq(g.state().survivalWave,1);
  }
});

test('counter loadout trades health for real dash and reflected damage without bypassing floor', () => {
  const g=kitDefense('counter');
  for(const rank of [0,1,2]){
    g.run(`upgrades.dash=${rank};player.dashCooldown=0;dash();`);near(g.state().dashCooldown,Math.max(1.2,2-.6*rank));
    g.run(`upgrades.reflect=${rank};bullets=[];projectile(100,100,0,0,'e');reflectBullet(bullets[0]);`);
    eq(g.read('bullets[0].damage'),3+rank);
  }
  supplyModule(g,'armor');eq(g.state().maxHp,6);eq(g.state().hp,6);
  eq(g.state().loadout,'counter');eq(g.state().grenades,4);
});

test('demolition loadout changes real blast radius, damage and gun interval with bounded module stacking', () => {
  for(const rank of [0,1,2]){
    const g=kitDefense('demolition'),radius=112+24*(rank+1);
    g.run(`spawnTime=0;upgrades.blast=${rank};player.x=600;player.inv=100;
      enemies=[0,${radius-1},${radius+1}].map(dx=>({...makeEnemy(100+dx-15,'turret'),y:200,hp:50,maxHp:50,shot:100}));
      projectile(100,218,0,0,'e');boom(100,218);`);
    eq(g.read('enemies.map(e=>e.hp)'),[42-2*rank,42-2*rank,50]);eq(g.state().hostiles,[]);
    for(const scatter of [false,true]){
      g.run(`player.shoot=0;player.weaponTime=${scatter?20:0};upgrades.rapid=${rank};fire();`);
      near(g.read('player.shoot'),(scatter?.33:.15)*.8**rank*1.25);
    }
  }
});

test('loadouts never leak into campaign or operations and reload returns to default kit', () => {
  for(const key of ['counter','demolition']){
    const g=kitDefense(key);g.key('p');g.click('menu-home');g.click('start');
    eq(g.state().selectedLoadout,key);g.click('mode-campaign');g.click('start');eq(g.state().maxHp,5);eq(g.state().grenades,3);
    g.run('fire();dash();');near(g.read('player.shoot'),.15);near(g.state().dashCooldown,2.4);
    g.run("projectile(100,100,0,0,'e');reflectBullet(bullets[bullets.length-1]);");eq(g.read('bullets[bullets.length-1].damage'),2);
    g.key('p');g.click('menu-home');g.click('start');g.click('mode-challenges');g.click('challenge-counter');
    eq(g.state().maxHp,5);near(g.read('dashDelay()'),1.2);g.run('saveProgress();');
    assert(!JSON.stringify(g.state().progress).includes('loadout'));
    const reloaded=createGame({storage:Object.fromEntries(g.values)});eq(reloaded.state().selectedLoadout,'assault');
  }
});

test('supply draws always offer a missing recipe partner without duplicates or capped modules', () => {
  for(const key of defenseModules)for(const randomSeed of [1,2,7,2026,98765]){
    const g=defense({randomSeed});g.run(`upgrades.${key}=1;`);finishDefenseWave(g);
    const missing=g.read(`Object.values(SYNERGIES).find(s=>s.pair.includes('${key}')).pair.find(k=>k!=='${key}')`);
    assert(g.state().supplyOffers.includes(missing));eq(new Set(g.state().supplyOffers).size,3);
    g.click('supply-reroll');assert(g.state().supplyOffers.includes(missing));eq(new Set(g.state().supplyOffers).size,3);
  }
  const g=defense();g.run('upgrades.rapid=2;upgrades.dash=1;upgrades.armor=1;');finishDefenseWave(g);
  assert(!g.state().supplyOffers.includes('rapid'));assert(g.state().supplyOffers.some(k=>['pierce','reflect','blast'].includes(k)));
});

test('reroll is once per intermission, changes offers, clears selection and preserves resources and time', () => {
  for(const randomSeed of [1,2,3,2026,98765]){
    const g=defense({randomSeed});g.click('supply-reroll');eq(g.state().supplyRerolls,0);
    finishDefenseWave(g);g.click('supply-1');const before=g.state();eq(before.supplyRerolls,1);
    g.click('supply-reroll');const after=g.state();eq(after.supplyRerolls,0);eq(after.selectedSupply,null);
    assert(after.supplyOffers.some(key=>!before.supplyOffers.includes(key)),'Reroll must give at least one new offer when alternatives exist');
    for(const key of Object.keys(before))if(!['supplyOffers','selectedSupply','supplyRerolls'].includes(key))eq(after[key],before[key],key+' changed during reroll');
    assert(g.nodes.get('start').disabled);assert(g.nodes.get('supply-reroll').disabled);eq(g.nodes.get('supply-reroll').getAttribute('aria-disabled'),'true');
    for(let i=0;i<3;i++)eq(g.nodes.get('supply-'+i).getAttribute('aria-pressed'),'false');
    g.run('rerollSupplies();');g.click('start');tick(g,60);eq(g.state(),after);
    for(const action of ['restart','menu-home']){g.click(action);g.click('cancel-restart');eq(g.state(),after);}
    g.click('supply-0');g.click('start');eq(g.state().survivalWave,2);eq(g.state().upgrades[after.supplyOffers[0]],1);
    assert(g.nodes.get('supply-reroll').hidden);finishDefenseWave(g);eq(g.state().supplyRerolls,1);assert(!g.nodes.get('supply-reroll').hidden);
  }
});

test('nearly capped rerolls change recovery options and fully capped builds disable empty rerolls', () => {
  for(const remaining of [1,2]){
    const g=defense();g.run(`for(const key of MODULES)upgrades[key]=2;upgrades.blast=1;${remaining===2?'upgrades.reflect=1;':''}`);
    finishDefenseWave(g);const before=g.state().supplyOffers;eq(g.state().supplyRerolls,1);
    g.click('supply-reroll');const after=g.state().supplyOffers;assert(after.includes('blast'));eq(new Set(after).size,3);
    assert(after.some(key=>!before.includes(key)));assert(after.every(key=>!defenseModules.includes(key)||['blast','reflect'].includes(key)));
  }
  const g=defense();g.run('for(const key of MODULES)upgrades[key]=2;');finishDefenseWave(g);
  eq(g.state().supplyOffers,['heal','ammo','boost']);eq(g.state().supplyRerolls,0);assert(g.nodes.get('supply-reroll').disabled);
  eq(g.nodes.get('supply-reroll').textContent,'已展示全部补给');const before=g.state();g.run('rerollSupplies();');eq(g.state(),before);
});

// Tactical recovery fixtures arrange collision boundaries only. Accepting a
// commission, starting its wave and touching nodes still use production code.
function recoveryDefense({ wave = 2, ...options } = {}) {
  assert(wave > 1 && wave % 3 !== 0, 'Recovery fixture needs an eligible ordinary wave');
  const g = defense(options);
  if (wave !== 2) g.run(`survivalWave=${wave - 2};startWave();`);
  finishDefenseWave(g);
  g.click('contract-recovery'); g.click('supply-0'); g.click('start');
  eq(g.state().survivalWave, wave); eq(g.state().fieldContract?.status, 'active');
  return g;
}
function isolateRecoveryCombat(g) {
  // Keep one harmless but living enemy so collection itself cannot clear.
  g.run(`spawnTime=0;pickups=[];bullets=[];bombs=[];player.inv=100;clearInput();
    enemies=[{...makeEnemy(480,'turret'),y:50,hp:999,maxHp:999,shot:100000}];`);
}
function touchRecoveryNode(g, index) {
  const node = g.state().fieldContract.nodes[index];
  g.run(`player.x=${node.x - 13.5};player.y=${node.y - 22};player.h=44;
    player.crouch=false;player.vx=0;player.vy=0;player.ground=false;player.dashTime=0;`);
  tick(g);
}
const collectedRecovery = g => g.state().fieldContract.nodes.filter(node => node.done).length;

test('recovery is opt-in only at eligible intermissions and never replaces required supply selection', () => {
  const g = createGame(), original = g.state().progress;
  g.click('contract-recovery'); eq(g.state().selectedContract, 'hold'); eq(g.state().fieldContract, null);
  g.click('mode-survival'); g.click('contract-recovery'); g.click('start');
  eq(g.state().survivalWave, 1); eq(g.state().fieldContract, null);
  assert(g.nodes.get('contract-hud').hidden); g.click('contract-recovery'); eq(g.state().selectedContract, 'hold');
  finishDefenseWave(g);
  eq(g.state().selectedContract, 'hold'); eq(g.nodes.get('contract-hold').getAttribute('aria-pressed'), 'true');
  assert(!g.nodes.get('contract-choices').hidden && !g.nodes.get('contract-recovery').disabled);
  const before = g.state();
  for (let i = 0; i < 4; i++) g.click('contract-recovery');
  const chosen = g.state();
  for (const key of Object.keys(before)) if (key !== 'selectedContract') eq(chosen[key], before[key], key + ' changed on selection');
  eq(chosen.selectedContract, 'recovery'); assert(g.nodes.get('start').disabled);
  eq(g.nodes.get('contract-recovery').getAttribute('aria-pressed'), 'true');
  eq(g.nodes.get('contract-hold').getAttribute('aria-pressed'), 'false');
  assert(g.nodes.get('contract-selection').textContent.includes('已接取'));
  g.click('start'); eq(g.state().phase, 'waveClear'); eq(g.state().fieldContract, null);
  g.click('contract-hold'); eq(g.state(), before);
  g.run("chooseContract('unknown');chooseContract(null);"); eq(g.state(), before);
  g.click('supply-0'); const supply = g.state().selectedSupply;
  g.click('contract-recovery'); eq(g.state().selectedSupply, supply); assert(!g.nodes.get('start').disabled);
  g.click('start'); eq(g.state().survivalWave, 2); eq(g.state().selectedContract, 'hold');
  eq(g.state().fieldContract.status, 'active'); assert(!g.nodes.get('contract-hud').hidden);
  assert(g.nodes.get('contract-objective').textContent.includes('尚未启用'));
  const started = g.state();
  g.click('contract-hold'); g.click('contract-recovery'); g.click('start'); eq(g.state(), started);
  eq(nonDefenseRecords(g), (({ survival, ...rest }) => rest)(original));
});

test('default hold waves and boss transitions have no nodes, hidden HUD and no inherited commission', () => {
  const g = defense(); finishDefenseWave(g); g.click('supply-0'); g.click('start');
  eq(g.state().survivalWave, 2); eq(g.state().fieldContract, null); assert(g.nodes.get('contract-hud').hidden);
  finishDefenseWave(g);
  eq(g.state().selectedContract, 'hold'); assert(g.nodes.get('contract-choices').hidden);
  assert(g.nodes.get('contract-hold').disabled && g.nodes.get('contract-recovery').disabled);
  assert(g.nodes.get('contract-summary').textContent.includes('首领战'));
  const before = g.state(); g.click('contract-recovery'); g.run("chooseContract('recovery');"); eq(g.state(), before);
  g.click('supply-0'); g.click('start'); eq(g.state().bossWave, true); eq(g.state().fieldContract, null);
  finishDefenseWave(g); assert(!g.nodes.get('contract-choices').hidden);
  eq(g.state().selectedContract, 'hold'); g.click('supply-0'); g.click('start');
  eq(g.state().survivalWave, 4); eq(g.state().fieldContract, null);
});

test('recovery selection survives rerolls and repeated restart or home cancellation without granting resources', () => {
  const g = defense(); finishDefenseWave(g); g.click('contract-recovery'); g.click('supply-1');
  const before = g.state(); g.click('supply-reroll'); const rolled = g.state();
  eq(rolled.selectedContract, 'recovery'); eq(rolled.selectedSupply, null); eq(rolled.fieldContract, null);
  for (const key of Object.keys(before)) if (!['selectedSupply', 'supplyOffers', 'supplyRerolls'].includes(key)) eq(rolled[key], before[key]);
  assert(g.nodes.get('start').disabled); eq(g.nodes.get('contract-recovery').getAttribute('aria-pressed'), 'true');
  for (const selected of [false, true]) {
    if (selected) g.click('supply-0');
    const saved = g.state();
    for (const action of ['restart', 'menu-home', 'restart']) {
      g.click(action); eq(g.state().phase, 'confirmRestart');
      g.click('contract-hold'); tick(g, 60); g.click('cancel-restart'); eq(g.state(), saved);
      eq(g.nodes.get('contract-recovery').getAttribute('aria-pressed'), 'true');
      eq(g.nodes.get('start').disabled, !selected);
    }
  }
  g.click('start'); eq(g.state().fieldContract.status, 'active'); eq(g.state().supplyRerolls, 0);
});

test('recovery details keyboard controls cannot start a selected wave or inject gameplay input', () => {
  const g = defense(); finishDefenseWave(g); g.click('supply-0'); g.click('contract-recovery');
  const before = g.state();
  for (const id of ['contract-summary', 'contract-hold', 'contract-recovery']) {
    g.nodes.get(id).focus();
    for (const key of ['Enter', ' ', 'a', 'w']) { g.key(key); g.key(key, false); }
    tick(g, 30); eq(g.state(), before);
  }
  g.click('start'); eq(g.state().survivalWave, 2); eq(g.state().jumpBuffer, 0); eq(g.state().ground, true);
});

test('recovery geometry has two reachable ground nodes and a layout-supported high node', () => {
  for (const wave of [2, 4, 5, 7, 8, 11]) {
    const g = recoveryDefense({ wave }), nodes = g.state().fieldContract.nodes;
    eq(nodes.length, 3); eq(new Set(nodes.map(node => `${node.x},${node.y}`)).size, 3);
    assert(nodes.every(node => !node.done && Number.isFinite(node.x) && Number.isFinite(node.y)));
    assert(nodes[0].x >= 30 && nodes[0].x < 160 && nodes[1].x > 800 && nodes[1].x <= 930);
    eq(nodes[0].y, 401); eq(nodes[1].y, 401);
    const top = nodes[2]; assert(top.y >= 301 && top.y <= 311);
    const platforms = g.read('stage.platforms');
    assert(platforms.some(([x, y, w]) => top.x > x + 20 && top.x < x + w - 20 && y - top.y === 24));
    for (const node of nodes) for (const pickup of g.read('pickups')) {
      assert(Math.hypot(node.x - pickup.x, node.y - pickup.y) > 33, 'Data marker must not overlap a medical or weapon pickup');
    }
    assert(top.y + 17 < 381, 'Ground standing body must not collect the high node');
    isolateRecoveryCombat(g); g.run(`player.x=${top.x - 13.5};player.y=G-44;player.vy=0;`); tick(g);
    eq(collectedRecovery(g), 0);
    for (let index = 0; index < 3; index++) { touchRecoveryNode(g, index); eq(collectedRecovery(g), index + 1); }
    eq(g.state().phase, 'playing');
  }
});

test('recovery uses actual circular body contact including misses, high ledges and crouching', () => {
  for (const crouch of [false, true]) {
    const g = recoveryDefense(); isolateRecoveryCombat(g);
    const node = g.state().fieldContract.nodes[0];
    g.run(`player.x=${node.x - 27 - 17 - .1};player.y=G-44;player.vy=0;player.ground=true;`);
    if (crouch) g.key('s');
    tick(g); eq(collectedRecovery(g), 0, 'Body outside circular pickup radius must miss');
    g.run('player.x+=.2;'); tick(g); eq(collectedRecovery(g), 1, 'Body entering circular pickup radius must collect');
    eq(g.state().crouch, crouch); g.key('s', false);
    touchRecoveryNode(g, 2); eq(collectedRecovery(g), 2);
  }
});

test('recovery nodes cannot be taken during ingress and activate on the first live simulation tick', () => {
  for (const index of [0, 1, 2]) {
    const g = recoveryDefense(); isolateRecoveryCombat(g); g.run('spawnTime=.25;');
    touchRecoveryNode(g, index); eq(collectedRecovery(g), 0);
    assert(g.nodes.get('contract-objective').textContent.includes('尚未启用'));
    const before = g.state();
    g.key('p'); tick(g, 90); near(g.state().spawnTime, before.spawnTime); eq(collectedRecovery(g), 0);
    g.click('start'); g.run('spawnTime=DT/2;'); touchRecoveryNode(g, index);
    eq(g.state().spawnTime, 0); eq(collectedRecovery(g), 1); eq(g.state().fieldContract.status, 'active');
  }
});

test('collection is idempotent, has no timer and grants no health, ammunition, points or records before clear', () => {
  const g = recoveryDefense(); isolateRecoveryCombat(g); g.run('player.hp=2;player.grenades=1;');
  const before = g.state(), stored = g.values.get(STORE);
  for (let index = 0; index < 3; index++) {
    touchRecoveryNode(g, index); touchRecoveryNode(g, index); eq(collectedRecovery(g), index + 1);
    for (const key of ['score', 'hp', 'grenades', 'progress']) eq(g.state()[key], before[key]);
  }
  eq(g.state().fieldContract.status, 'active');
  assert(g.nodes.get('contract-objective').textContent.includes('已收齐 3 / 3'));
  assert(g.nodes.get('contract-objective').textContent.includes('活着清场'));
  tick(g, 2400); eq(collectedRecovery(g), 3); eq(g.state().fieldContract.status, 'active');
  for (const key of ['score', 'hp', 'grenades', 'progress']) eq(g.state()[key], before[key]);
  eq(g.values.get(STORE), stored); eq(g.state().phase, 'playing');
});

test('recovery progress freezes in pause, background and confirmation and cannot be changed by menu buttons', () => {
  const g = recoveryDefense(); isolateRecoveryCombat(g); touchRecoveryNode(g, 0);
  const progress = g.state().fieldContract;
  for (const pause of ['keyboard', 'visibility', 'blur']) {
    if (pause === 'keyboard') g.key('p'); else if (pause === 'visibility') g.visibility(true); else g.event('blur');
    eq(g.state().phase, 'pause'); const before = g.state(); tick(g, 120); g.frames(30);
    g.click('contract-hold'); g.click('contract-recovery'); eq(g.state(), before);
    if (pause === 'visibility') g.visibility(false);
    g.click('start'); eq(g.state().fieldContract, progress);
  }
  for (const action of ['restart', 'menu-home']) {
    g.key('p'); const before = g.state(); g.click(action); tick(g, 120); g.click('cancel-restart');
    eq(g.state(), before); g.click('start'); eq(g.state().fieldContract, progress);
  }
});

test('living recovery clear adds exactly 350 points and one extra health and grenade before saving', () => {
  const g = recoveryDefense(); isolateRecoveryCombat(g); g.run('player.hp=2;player.grenades=2;');
  for (let index = 0; index < 3; index++) touchRecoveryNode(g, index);
  const before = g.state(); finishDefenseWave(g); const settled = g.state();
  eq(settled.fieldContract.status, 'success'); eq(settled.score, before.score + 300 + 350);
  eq(settled.hp, 4); eq(settled.grenades, 4); eq(settled.survivalCleared, 2);
  eq(settled.progress.survival, { wave: 2, best: settled.score });
  eq(JSON.parse(g.values.get(STORE)).survival, settled.progress.survival);
  assert(g.nodes.get('result-details').textContent.includes('回收委托完成'));
  assert(g.nodes.get('contract-hud').hidden); eq(settled.selectedContract, 'hold');
  for (let repeat = 0; repeat < 3; repeat++) { g.run('finishWave();'); tick(g, 60); g.frames(10); eq(g.state(), settled); }
  g.click('restart'); g.click('cancel-restart'); eq(g.state(), settled);
});

test('recovery rewards respect health and seven-grenade caps across all loadouts and armor ranks', () => {
  for (const loadout of ['assault', 'counter', 'demolition']) for (const armor of [0, 2]) {
    const g = recoveryDefense({ loadout }); isolateRecoveryCombat(g);
    g.run(`upgrades.armor=${armor};player.hp=maxHealth()-1;player.grenades=6;`);
    for (let index = 0; index < 3; index++) touchRecoveryNode(g, index);
    const max = g.state().maxHp, score = g.state().score; finishDefenseWave(g);
    eq(g.state().hp, max); eq(g.state().grenades, 7); eq(g.state().score, score + 650);
    eq(g.state().fieldContract.status, 'success');
  }
});

test('clearing with zero, one or two recovered nodes never waits, fails the run or awards extra resources', () => {
  for (const count of [0, 1, 2]) {
    const g = recoveryDefense(); isolateRecoveryCombat(g); g.run('player.hp=2;player.grenades=2;');
    for (let index = 0; index < count; index++) touchRecoveryNode(g, index);
    const before = g.state(); finishDefenseWave(g);
    eq(g.state().phase, 'waveClear'); eq(g.state().fieldContract.status, 'missed');
    eq(g.state().score, before.score + 300); eq(g.state().hp, 3); eq(g.state().grenades, 3);
    eq(g.state().progress.survival, { wave: 2, best: g.state().score });
    assert(g.nodes.get('result-details').textContent.includes(`未完成 · ${count} / 3`));
    assert(g.nodes.get('result-details').textContent.includes('正常清场奖励保留'));
    g.click('supply-0'); g.click('start'); eq(g.state().survivalWave, 3); eq(g.state().fieldContract, null);
  }
});

test('last node and last enemy may resolve together only when the player survives that tick', () => {
  const g = recoveryDefense(); isolateRecoveryCombat(g); touchRecoveryNode(g, 0); touchRecoveryNode(g, 1);
  const node = g.state().fieldContract.nodes[2], before = g.state();
  g.run(`player.x=${node.x - 13.5};player.y=${node.y - 22};player.vy=0;
    enemies=[{...makeEnemy(150,'turret'),hp:1,shot:100}];
    projectile(enemies[0].x+15,enemies[0].y+18,0,0,'p');`);
  tick(g); eq(g.state().phase, 'waveClear'); eq(collectedRecovery(g), 3);
  eq(g.state().fieldContract.status, 'success'); eq(g.state().score, before.score + 160 + 300 + 350);
});

test('death after gathering all nodes never pays or saves the unfinished recovery wave', () => {
  const g = recoveryDefense(); isolateRecoveryCombat(g);
  for (let index = 0; index < 3; index++) touchRecoveryNode(g, index);
  const before = g.state(), stored = g.values.get(STORE);
  g.run("player.hp=1;player.inv=0;projectile(player.x+12,player.y+20,0,0,'e');"); tick(g);
  eq(g.state().phase, 'survivalOver'); eq(g.state().fieldContract.status, 'missed');
  eq(g.state().hp, 0); eq(g.state().lives, 0); eq(g.state().score, before.score); eq(g.state().grenades, before.grenades);
  eq(g.state().progress, before.progress); eq(g.values.get(STORE), stored);
  assert(g.nodes.get('result-details').textContent.includes('回收委托未结算'));
  assert(g.nodes.get('contract-hud').hidden); const terminal = g.state();
  tick(g, 120); g.run('finishWave();'); eq(g.state(), terminal);
});

test('same-frame lethal trades beat the last node and recovery settlement in either projectile order', () => {
  for (const gathered of [false, true]) for (const killFirst of [false, true]) {
    const g = recoveryDefense(); isolateRecoveryCombat(g);
    for (let index = 0; index < (gathered ? 3 : 2); index++) touchRecoveryNode(g, index);
    const node = g.state().fieldContract.nodes[2], before = g.state(), stored = g.values.get(STORE);
    const hitPlayer = "projectile(player.x+12,player.y+20,0,0,'e');";
    const killEnemy = "projectile(enemies[0].x+15,enemies[0].y+18,0,0,'p');";
    g.run(`player.x=${node.x - 13.5};player.y=${node.y - 22};player.vy=0;player.hp=1;player.inv=0;bullets=[];
      enemies=[{...makeEnemy(150,'turret'),hp:1,shot:100}];
      ${killFirst ? hitPlayer + killEnemy : killEnemy + hitPlayer}`);
    tick(g); eq(g.state().phase, 'survivalOver'); eq(g.state().fieldContract.status, 'missed');
    eq(collectedRecovery(g), gathered ? 3 : 2); eq(g.state().score, before.score + (killFirst ? 160 : 0));
    eq(g.state().progress, before.progress); eq(g.state().grenades, before.grenades); eq(g.values.get(STORE), stored);
    eq(g.state().survivalCleared, 1); eq(g.state().hp, 0);
  }
});

test('each new intermission defaults to hold and a later accepted commission gets fresh nodes', () => {
  const g = recoveryDefense({ wave: 4 }); isolateRecoveryCombat(g); touchRecoveryNode(g, 0); finishDefenseWave(g);
  eq(g.state().selectedContract, 'hold'); eq(g.nodes.get('contract-hold').getAttribute('aria-pressed'), 'true');
  eq(g.nodes.get('contract-options').open, false);
  const prior = g.state().fieldContract; eq(prior.status, 'missed');
  g.click('supply-0'); g.click('start'); eq(g.state().survivalWave, 5); eq(g.state().fieldContract, null);
  finishDefenseWave(g); g.click('supply-0'); g.click('start'); eq(g.state().survivalWave, 6); eq(g.state().fieldContract, null);
  finishDefenseWave(g); eq(g.state().selectedContract, 'hold');
  g.click('contract-recovery'); g.click('supply-0'); g.click('start'); eq(g.state().survivalWave, 7);
  eq(g.state().fieldContract.status, 'active'); eq(collectedRecovery(g), 0); eq(prior.nodes.filter(node => node.done).length, 1);
});

test('recovery snapshots cannot mutate nested nodes or selection and never expose a mutable API', () => {
  const g = recoveryDefense(), before = g.state(); const snapshot = g.win.__raidState;
  try { snapshot.selectedContract = 'recovery'; snapshot.fieldContract.status = 'success';
    snapshot.fieldContract.nodes[0].done = true; snapshot.fieldContract.nodes[1].x = -999;
    snapshot.fieldContract.nodes.push({ x: 0, y: 0, done: true }); } catch {}
  eq(g.state(), before); assert(!source.includes('__raidQA'));
});

test('restart and death retry remove selected commissions, active progress and pending rewards', () => {
  for (const at of ['intermission', 'active', 'gathered', 'dead']) {
    const g = at === 'intermission' ? defense() : recoveryDefense();
    if (at === 'intermission') { finishDefenseWave(g); g.click('contract-recovery'); }
    else {
      isolateRecoveryCombat(g); touchRecoveryNode(g, 0);
      if (at === 'gathered' || at === 'dead') { touchRecoveryNode(g, 1); touchRecoveryNode(g, 2); }
      if (at === 'dead') { g.run('player.inv=0;hurt(99);'); eq(g.state().phase, 'survivalOver'); }
    }
    const records = g.state().progress;
    if (at !== 'dead') g.click('restart');
    g.click('start'); eq(g.state().survivalWave, 1); eq(g.state().selectedContract, 'hold');
    eq(g.state().fieldContract, null); eq(g.state().score, 0); eq(g.state().phase, 'playing');
    eq(g.state().progress, records); assert(g.nodes.get('contract-hud').hidden);
  }
});

test('leaving recovery for campaign, practice or operations cannot collect nodes or apply rewards', () => {
  for (const target of ['campaign', 'practice', 'sprint', 'counter', 'bosses']) {
    const g = recoveryDefense(); isolateRecoveryCombat(g); touchRecoveryNode(g, 0);
    g.key('p'); g.click('menu-home'); g.click('start'); eq(g.state().phase, 'title');
    eq(g.state().fieldContract, null); eq(g.state().selectedContract, 'hold');
    assert(g.nodes.get('contract-hud').hidden); const records = g.state().progress;
    if (target === 'campaign') { g.click('mode-campaign'); g.click('start'); }
    else if (target === 'practice') { g.click('mode-campaign'); g.click('stage-1'); }
    else { g.click('mode-challenges'); g.click('challenge-' + target); }
    assert(!g.nodes.get('survival-options') || g.nodes.get('survival-options').hidden);
    assert(g.nodes.get('contract-hud').hidden); const field = g.state().fieldContract; eq(field, null);
    g.click('contract-recovery'); g.run('pickups=[];player.inv=100;'); tick(g, 30);
    eq(g.state().score, 0); eq(g.state().fieldContract, field); eq(g.state().progress, records);
    eq(g.state().maxHp, target === 'bosses' ? 7 : 5);
  }
});

test('reload drops pending recovery while completed rewards keep the original persistence schema', () => {
  for (const complete of [false, true]) {
    const g = recoveryDefense(); isolateRecoveryCombat(g);
    for (let index = 0; index < 3; index++) touchRecoveryNode(g, index);
    if (complete) finishDefenseWave(g);
    const saved = JSON.parse(g.values.get(STORE)), reloaded = createGame({ storage: Object.fromEntries(g.values) });
    eq(Object.keys(saved.survival).sort(), ['best', 'wave']);
    assert(!/fieldContract|selectedContract|nodes|recovery/.test(JSON.stringify(saved)));
    eq(reloaded.state().progress, g.state().progress); eq(saved.survival.wave, complete ? 2 : 1);
    eq(reloaded.state().phase, 'title'); eq(reloaded.state().fieldContract, null); eq(reloaded.state().selectedContract, 'hold');
    reloaded.click('mode-survival'); reloaded.click('start');
    eq(reloaded.state().survivalWave, 1); eq(reloaded.state().fieldContract, null); eq(reloaded.state().score, 0);
  }
});

test('blocked storage still settles recovery once in memory without changing unrelated records', () => {
  const g = recoveryDefense({ blocked: true }), other = nonDefenseRecords(g);
  isolateRecoveryCombat(g); for (let index = 0; index < 3; index++) touchRecoveryNode(g, index);
  const score = g.state().score; finishDefenseWave(g);
  eq(g.state().score, score + 650); eq(g.state().fieldContract.status, 'success');
  eq(g.state().progress.survival, { wave: 2, best: g.state().score }); eq(g.values.size, 0);
  eq(nonDefenseRecords(g), other); eq(g.state().storageAvailable, false);
  const before = g.state(); g.run('finishWave();'); tick(g, 30); eq(g.state(), before);
});

test('recovery inputs descend from either ledge edge even inside the horizontal ground-node stop radius', () => {
  for (const [index, x] of [[0, 113.75], [1, 818.5]]) {
    const g = recoveryDefense(), decide = recoveryTactics(); isolateRecoveryCombat(g);
    g.run(`fieldContract.nodes[2].done=true;fieldContract.nodes[${1-index}].done=true;
      player.x=${x};player.y=325-player.h;player.ground=true;player.vy=0;`);
    const before = g.state(), input = decide(before);
    eq(input.move, ''); eq(input.down, true); eq(input.jump, true); eq(input.dash, false);
    eq(input.fire, false); eq(g.state(), before, 'Route planning must remain read-only');
    for (let frame = 0; frame < 45 && !g.state().fieldContract.nodes[index].done; frame++) {
      const state = g.state(), next = decide(state);
      g.key('s', next.down === true); g.key('a', next.move === 'a'); g.key('d', next.move === 'd');
      if (next.jump && state.ground) { g.key('w', false); g.key('w'); } else if (!next.jump) g.key('w', false);
      tick(g);
    }
    for (const key of ['s', 'a', 'd', 'w']) g.key(key, false);
    eq(g.state().fieldContract.nodes[index].done, true); eq(collectedRecovery(g), 3);
    assert(g.state().y + g.state().playerHeight > 365); eq(g.state().phase, 'playing');
    eq(g.state().score, before.score); eq(g.state().progress, before.progress);
  }
});

test('all loadouts recover and clear rotating arenas using only genuine inputs across seeds and cadences', () => {
  for (const randomSeed of [1, 42, 16437, 71901]) for (const loadout of ['assault', 'counter', 'demolition']) {
    for (const cadence of [5, 12]) {
      const g = defense({ randomSeed, loadout }), tap = key => { g.key(key); g.key(key, false); };
      const records = nonDefenseRecords(g);
      for (let wave = 1; wave <= 4; wave++) {
        const recovery = [2, 4].includes(wave), decide = recovery ? recoveryTactics() : survivalTactics();
        const seenCounts = new Set(); let duration = 0, decisions = 0, sawGatheredBeforeClear = false;
        // Only the fixture seed is configured before game creation. All movement,
        // jumping, shooting, defensive dashes and menu choices are real inputs;
        // the private evaluator below advances time, never rewrites gameplay.
        while (g.state().phase === 'playing' && duration < 3600) {
          if (duration % cadence === 0) {
            const state = g.state(), untouched = JSON.stringify(state), input = decide(state);
            eq(JSON.stringify(state), untouched, 'Read-only recovery controller mutated its snapshot');
            decisions++;
            if (recovery) {
              const count = state.fieldContract.nodes.filter(node => node.done).length;
              seenCounts.add(count);
              if (count === 3) { sawGatheredBeforeClear = true; eq(state.fieldContract.status, 'active'); }
            }
            g.key('a', input.move === 'a'); g.key('d', input.move === 'd'); g.key('j', input.fire !== false); g.key('s', input.down === true);
            if (input.jump && state.ground) { g.key('w', false); g.key('w'); }
            else if (!input.jump) g.key('w', false);
            if (input.dash) tap('l'); if (input.grenade) tap('k');
          }
          tick(g); duration++;
        }
        for (const key of ['a', 'd', 'w', 'j', 's']) g.key(key, false);
        const state = g.state();
        eq(state.phase, 'waveClear', `Recovery loadout ${loadout}, seed ${randomSeed}, cadence ${cadence}, wave ${wave}: ` + JSON.stringify(state));
        eq(state.survivalCleared, wave); eq(state.lives, 1); eq(state.stageDeaths, 0); assert(state.hp > 0);
        assert(duration > 132 && duration < 3600 && decisions > 10, 'Recovery must use real ingress and finish within one active minute');
        eq(nonDefenseRecords(g), records); eq(state.progress.survival, { wave, best: state.score });
        if (recovery) {
          eq(state.fieldContract.status, 'success'); eq(collectedRecovery(g), 3);
          eq([...seenCounts].sort(), [0, 1, 2, 3]); assert(sawGatheredBeforeClear);
          eq(state.selectedContract, 'hold'); assert(g.nodes.get('result-details').textContent.includes('回收委托完成'));
        } else eq(state.fieldContract, null);
        if (wave < 4) {
          let choice = state.supplyOffers.indexOf('armor');
          if (choice < 0) choice = state.hp < 4 ? state.supplyOffers.indexOf('heal') : 0;
          g.click('supply-' + Math.max(0, choice));
          if ([2, 4].includes(wave + 1)) g.click('contract-recovery');
          g.click('start');
        }
      }
    }
  }
});


test('ordinary waves rotate three real layouts without boss rounds skipping a map', () => {
  const g = defense(), expected = ['steps', 'flanks', null, 'bridge', 'steps', null, 'flanks', 'bridge', null];
  const seen = new Map();
  for (let wave = 1; wave <= 18; wave++) {
    const s = g.state(), arena = expected[(wave - 1) % 9];
    eq(s.survivalWave, wave); eq(s.arena?.id ?? null, arena); eq(s.worldWidth, 960); eq(s.cam, 0);
    eq(g.read('stage.gaps'), []); eq(g.read('stage.checkpoints'), []);
    if (arena) {
      assert(g.nodes.get('mission-objective').textContent.includes(s.arena.name));
      assert(g.nodes.get('announcer').textContent.includes(s.arena.name));
      if (seen.has(arena)) eq(s.platforms, seen.get(arena)); else seen.set(arena, s.platforms);
      assert(s.platforms.every(([x, y, w]) => x > 0 && x + w < 960 && y >= 285 && y <= 365));
      const spread = s.pickups.find(p => p.kind === 'spread');
      assert(s.platforms.some(([x, y, w]) => spread.x === x + w / 2 && spread.y === y - 25));
      const drones = g.read("enemies.filter(e=>e.type==='drone').map(e=>e.home)");
      eq(new Set(drones).size, drones.length, 'Air units must use separate patrol lanes');
      assert(drones.every(x => x - 53 >= 60 && x + 53 + 38 <= 900));
    } else {
      eq(s.platforms, [[260, 320, 170], [500, 310, 150]]);
      eq(s.pickups[0], { x: 480, y: 260, kind: 'spread', done: false });
    }
    finishDefenseWave(g);
    const preview = g.nodes.get('overlay-text').textContent;
    const next = g.read('arenaForWave(survivalWave+1)');
    assert(preview.includes(next?.name ?? '首领战'));
    if (next) assert(preview.includes(next.hint));
    g.click('supply-0'); g.click('start');
  }
  eq(new Set([...seen.values()].map(v => JSON.stringify(v))).size, 3);
});

test('arena and reward snapshots are detached and restart restores the first route', () => {
  const g = defense(), before = g.state(), snapshot = g.win.__raidState;
  snapshot.arena.name = 'mutated'; snapshot.platforms[0][0] = -999;
  snapshot.platforms.push([0, 0, 999]); snapshot.pickups[0].x = -999; snapshot.pickups[0].done = true;
  eq(g.state(), before);
  finishDefenseWave(g); g.click('supply-0'); g.click('start'); eq(g.state().arena.id, 'flanks');
  g.click('restart'); g.click('start'); eq(g.state().arena.id, 'steps'); eq(g.state().platforms, before.platforms);
  g.key('p'); g.click('menu-home'); g.click('start'); g.click('mode-campaign'); g.click('start');
  eq(g.state().arena, null); eq(g.state().platforms, g.read('STAGES[0].platforms'));
  eq(g.state().dropTime, 0);
});

function onLedge({ y = 325, below = false, x = 500 } = {}) {
  const g = createGame(); g.start();
  // Isolate collision boundaries. Only this fixture arranges positions;
  // keyboard/pointer/gamepad input executes production physics thereafter.
  g.run(`stage={...stage,gaps:[],platforms:[[480,${y},260]${below ? ',[480,365,260]' : ''}]};
    enemies=[];boss.dead=true;pickups=[];intel=[];
    player.x=${x};player.y=${y}-player.h;player.ground=true;player.vy=0;player.inv=0;`);
  return g;
}

test('Down plus a fresh jump drops only the current ledge and lands on a lower platform', () => {
  for (const down of ['s', 'ArrowDown']) for (const jump of ['w', 'ArrowUp', ' ']) {
    const g = onLedge({ below: true }), before = g.state();
    g.key(down); tick(g, 4); eq(g.state().y + g.state().playerHeight, 325);
    eq(g.state().dropTime, 0, 'Crouching alone must not drop');
    g.key(jump); tick(g); g.key(jump, false);
    assert(g.state().dropTime > 0 && !g.state().ground && g.read('player.vy') > 0);
    g.key(down, false); tick(g, 24);
    eq(g.state().ground, true); eq(g.state().y + g.state().playerHeight, 365);
    eq(g.state().dropTime, 0); eq(g.read('player.dropPlatform'), null);
    eq(g.state().hp, before.hp); eq(g.state().grenades, before.grenades); eq(g.state().score, before.score);
    eq(g.read('player.inv'), 0); eq(g.state().progress, before.progress);
    tick(g, 30); eq(g.state().y + g.state().playerHeight, 365, 'Holding jump may not repeatedly drop through floors');
  }
});

test('platform descent never drops through solid ground or cancels normal/coyote jumps', () => {
  const g = onLedge(); g.run('player.x=80;player.y=G-player.h;');
  g.key('s'); g.key('w'); tick(g); assert(g.read('player.vy') < 0); eq(g.state().dropTime, 0);
  g.key('w', false); g.key('s', false); tick(g, 75);
  eq(g.state().ground, true); eq(g.state().y + g.state().playerHeight, 425);
  const normal = onLedge(); normal.key('w'); tick(normal); assert(normal.read('player.vy') < 0); eq(normal.state().dropTime, 0);
  const edge = onLedge({ x: 735 }); edge.key('d'); tick(edge, 4); edge.key('d', false);
  assert(!edge.state().ground); edge.key('s'); edge.key('w'); tick(edge);
  assert(edge.read('player.vy') < -450); eq(edge.state().dropTime, 0);
});

test('simultaneous dash and descent cannot snap back to the ledge when ignore time expires', () => {
  for (const face of [-1, 1]) {
    const g = onLedge({ x: face === 1 ? 490 : 700 }); g.run(`player.face=${face};`);
    g.key('s'); g.key('w'); g.key('l'); tick(g);
    g.key('s', false); g.key('w', false); g.key('l', false);
    assert(g.state().dashTime > 0 && g.state().dropTime > 0);
    tick(g, 13); assert(!g.state().ground, 'Dash must not reland on the ignored support');
    tick(g, 36); eq(g.state().ground, true); eq(g.state().y + g.state().playerHeight, 425);
    eq(g.read('player.dropPlatform'), null);
  }
});

test('platform descent freezes across pause and canceled confirmation without injecting a second jump', () => {
  const g = onLedge(); g.key('s'); g.key('w'); tick(g); g.key('w', false); g.key('s', false);
  g.key('p'); const saved = g.state(); tick(g, 90); eq(g.state(), saved);
  g.click('restart'); tick(g, 30); g.click('cancel-restart'); eq(g.state(), saved);
  g.click('start'); tick(g, 40); eq(g.state().y + g.state().playerHeight, 425); eq(g.state().dropTime, 0);
  g.click('restart'); g.click('start'); eq(g.state().dropTime, 0); eq(g.read('player.dropPlatform'), null);
});

test('touch and gamepad down-jump pairs use the same platform descent physics', () => {
  const touch = onLedge();
  const down = [...touch.nodes.values()].find(node => node.dataset.action === 'down');
  const jump = [...touch.nodes.values()].find(node => node.dataset.action === 'jump');
  down.dispatch('pointerdown', { pointerId: 10 }); jump.dispatch('pointerdown', { pointerId: 11 });
  tick(touch); assert(touch.state().dropTime > 0 && touch.read('player.vy') > 0);
  down.dispatch('pointerup', { pointerId: 10 }); jump.dispatch('pointerup', { pointerId: 11 });
  tick(touch, 40); eq(touch.state().y + touch.state().playerHeight, 425); eq(touch.state().touchCount, 0);
  const pad = onLedge(); pad.pad(); pad.frames(2); pad.pad([0, 13]); pad.frames(2);
  assert(pad.state().dropTime > 0 && pad.read('player.vy') > 0);
  pad.pad(); pad.frames(40); eq(pad.state().y + pad.state().playerHeight, 425);
});

test('drop-through remains vulnerable to hostile fire and resets after a lost life', () => {
  const g = onLedge(); g.key('s'); g.key('w'); tick(g); g.key('w', false); g.key('s', false);
  g.run("projectile(player.x+10,player.y+16,0,0,'e');"); tick(g); eq(g.state().hp, 4);
  g.run('player.inv=0;hurt(99);'); eq(g.state().lives, 2); eq(g.state().dropTime, 0);
  eq(g.read('player.dropPlatform'), null); eq(g.state().y + g.state().playerHeight, 425);
});


test('all elevated arena weapons are reachable and descendable with unassisted movement inputs', () => {
  const routes = {
    1: [{ x: 287.5, floor: 425 }, { x: 287.5, floor: 325, jump: true }, { x: 350, floor: 325 }, { x: 480, floor: 285, jump: true }],
    2: [{ x: 737.5, floor: 425 }, { x: 737.5, floor: 325, jump: true }],
    4: [{ x: 217.5, floor: 425 }, { x: 217.5, floor: 335, jump: true }, { x: 280, floor: 335 }, { x: 415, floor: 295, jump: true }],
  };
  for (const [wave, route] of Object.entries(routes)) {
    const g = defense();
    // Isolate platform reachability, using production geometry and physics.
    // No position, velocity or pickup changes after the route begins.
    g.run(`survivalWave=${Number(wave) - 1};startWave();spawnTime=100;`);
    for (const target of route) {
      if (target.jump) g.key('w');
      let reached = false;
      for (let frame = 0; frame < 180; frame++) {
        const state = g.state(), dx = target.x - state.x - 13.5;
        g.key('a', dx < -3); g.key('d', dx > 3); tick(g);
        if (Math.abs(g.state().x + 13.5 - target.x) <= 3 && g.state().ground &&
          g.state().y + g.state().playerHeight === target.floor) { reached = true; break; }
      }
      for (const key of ['a', 'd', 'w']) g.key(key, false);
      assert(reached, `Wave ${wave} waypoint ${JSON.stringify(target)} is not reachable: ${JSON.stringify(g.state())}`);
    }
    assert(g.state().pickups.find(p => p.kind === 'spread').done); eq(g.state().weapon, 'spread');
    g.key('s'); g.key('w'); tick(g); g.key('s', false); g.key('w', false); tick(g, 60);
    eq(g.state().y + g.state().playerHeight, 425); eq(g.state().ground, true); eq(g.state().dropTime, 0);
    eq(g.state().hp, 6); eq(g.state().lives, 1); eq(g.state().score, 75);
  }
});

// Loadout actives use only survival resources. Boundary fixtures below isolate
// damage; browser checks additionally activate every kit with real controls.
function tacticalGame(loadout='assault') {
  const g=defense({loadout});
  g.run("spawnTime=0;pickups=[];enemies.forEach(e=>e.shot=100);player.inv=100;");
  return g;
}
function useSkill(g) { g.key('e'); tick(g); g.key('e',false); }

test('active skills start full only in survival, reject spawn and menus, and consume exactly once',()=>{
  for(const loadout of ['assault','counter','demolition']) {
    const g=defense({loadout}); eq(g.state().tacticalCharge,100); eq(g.state().tacticalUses,0);
    g.key('e');tick(g);g.click('tactical-use');tick(g);eq(g.state().tacticalUses,0);
    g.run('spawnTime=0;');g.key('e',true,true);tick(g);eq(g.state().tacticalUses,0,'Held spawn input must not release later');
    g.key('e',false);g.key('p');const paused=g.state();g.click('tactical-use');g.key('e');g.frames(5);eq(g.state(),paused);
    g.key('p',false);g.key('p');g.key('p',false);
    g.click('tactical-use');g.click('tactical-use');tick(g);eq(g.state().tacticalUses,1);eq(g.state().tacticalCharge,0);
    g.click('tactical-use');useSkill(g);eq(g.state().tacticalUses,1);
  }
  const g=createGame();g.start();const before=g.state();useSkill(g);eq(g.state().tacticalCharge,0);eq(g.state().tacticalUses,0);eq(g.state().shots,before.shots);
  eq(g.nodes.get('tactical-hud').hidden,true);
});

test('charge rewards real damage and kills once, caps overkill, and ignores shields, arrival and idle time',()=>{
  const g=tacticalGame();g.run('tacticalCharge=0;');
  g.run('damageEnemy(enemies[0],1);');eq(g.state().tacticalCharge,3);
  g.run('damageEnemy(enemies[0],99);');eq(g.state().tacticalCharge,21);
  g.run('damageEnemy(enemies[0],99);');eq(g.state().tacticalCharge,21);
  g.run("const shield=makeEnemy(600,'shield');shield.face=-1;hitEnemy(shield,{damage:20,vx:650,x:590,y:400,reflected:false});");eq(g.state().tacticalCharge,21);
  g.run("projectile(10,10,0,0,'e');reflectBullet(bullets[0]);reflectBullet(bullets[0]);");eq(g.state().tacticalCharge,29);
  g.run('enemies.forEach(e=>e.shot=100);');tick(g,120);eq(g.state().tacticalCharge,29);
  g.run('tacticalCharge=95;damageEnemy(enemies[1],99);');eq(g.state().tacticalCharge,100);
  g.run('tacticalCharge=0;spawnTime=2;damageEnemy(enemies[2],1);');eq(g.state().tacticalCharge,0);
});

test('overclock changes real rifle and scatter cadences without mutating upgrades or weapon timers',()=>{
  for(const scatter of [false,true])for(const rapid of [0,2]) {
    const normal=tacticalGame(),active=tacticalGame();
    for(const g of [normal,active])g.run(`upgrades.rapid=${rapid};player.weaponTime=${scatter?12:0};player.boost=10;fire();player.shoot=0;`);
    useSkill(active);normal.run('fire();');active.run('fire();');
    near(active.read('player.shoot'),normal.read('player.shoot')*.55);eq(active.state().lastVolley,scatter?3:1);
    eq(active.state().upgrades,normal.state().upgrades);assert(active.state().weaponTime<=normal.state().weaponTime);
    eq(active.read('bullets.at(-1).tactical'),true);
    active.run('damageEnemy(enemies[0],1);');eq(active.state().tacticalCharge,0);
    active.run("tacticalTime=0;enemies[0].hp=10;hitEnemy(enemies[0],bullets.at(-1));");eq(active.state().tacticalCharge,0,'Late empowered shot recharged itself');
    active.run('damageEnemy(enemies[0],1);');eq(active.state().tacticalCharge,3);
  }
});

test('phase shield reflects swept collisions, prevents contact and beam damage, and expires without extra invulnerability',()=>{
  const g=tacticalGame('counter');g.run('player.inv=0;');useSkill(g);
  g.run("projectile(player.x-20,player.y+20,3000,0,'e');");tick(g);
  eq(g.state().hp,5);eq(g.state().reflections,1);eq(g.read('bullets[0].tactical'),true);eq(g.read('bullets[0].damage'),3);eq(g.state().tacticalCharge,0);
  g.run('hurt(99);');eq(g.state().hp,5);eq(g.state().lives,1);
  g.run('bullets=[];enemies.forEach(e=>e.shot=100);');tick(g,185);eq(g.state().tacticalTime,0);
  g.run('hurt(1);');eq(g.state().hp,4);eq(g.state().tacticalCharge,0);
  const boss=defenseBoss(9,{loadout:'counter'});
  boss.run("loadout='counter';tacticalCharge=100;spawnTime=0;player.inv=0;boss.attackType='beam';boss.beamTime=.4;boss.beamY=player.y+20;");const hp=boss.state().hp;useSkill(boss);eq(boss.state().tacticalUses,1);tick(boss,5);eq(boss.state().hp,hp);eq(boss.state().reflections,0);eq(boss.state().stageDeaths,0);
});

test('phase reflected shots remain ineligible for charge after expiry and reflux still has one cooldown',()=>{
  const g=tacticalGame('counter');g.run('upgrades.dash=1;upgrades.reflect=1;player.hp=3;');useSkill(g);
  g.run("projectile(10,10,0,0,'e');projectile(20,10,0,0,'e');reflectBullet(bullets[0]);reflectBullet(bullets[1]);");
  eq(g.state().hp,4);eq(g.state().refluxCooldown,8);eq(g.state().tacticalCharge,0);
  g.run('tacticalTime=0;hitEnemy(enemies[0],bullets[0]);');eq(g.state().tacticalCharge,0);
});

test('shock pulse has fixed reach and damage, spares arriving targets, clears only nearby hostiles and never refunds grenades',()=>{
  const g=tacticalGame('demolition');
  g.run('devices=[];'); // Isolate pulse geometry; device cascades have their own contract.
  g.run("upgrades.armor=2;upgrades.blast=2;const cx=player.x+player.w/2;enemies=[makeEnemy(cx+100,'shield'),makeEnemy(cx+221,'walker'),makeEnemy(cx-40,'walker'),makeEnemy(cx+50,'walker')];enemies[0].hp=20;enemies[3].arrival=.5;enemies.forEach(e=>e.shot=100);projectile(cx+30,player.y+20,0,0,'e');projectile(cx+221,player.y+20,0,0,'e');projectile(cx+20,player.y+20,0,0,'p');");
  const before=g.state();useSkill(g);
  eq(g.read('enemies.map(e=>e.hp)'),[12,3,-5,3]);eq(g.state().grenades,before.grenades);eq(g.state().tacticalCharge,0);
  eq(g.read("bullets.filter(b=>b.owner==='e').length"),1);eq(g.read("bullets.filter(b=>b.owner==='p').length"),1);
  assert(g.state().score>before.score);eq(g.state().tacticalTime,0);eq(g.state().tacticalUses,1);
});

test('shock pulse damages a nearby boss once and cannot hit through the spawn warning',()=>{
  const g=defenseBoss(3,{loadout:'demolition'});
  g.run("loadout='demolition';tacticalCharge=100;spawnTime=1;player.x=boss.x-100;");useSkill(g);eq(g.state().tacticalCharge,100);
  const hp=g.state().bossHp;g.run('spawnTime=0;');useSkill(g);eq(g.state().bossHp,hp-8);eq(g.state().tacticalCharge,0);
  tick(g,30);eq(g.state().bossHp,hp-8);eq(g.state().tacticalUses,1);
});

test('skills and energy freeze across pause, visibility and canceled restart without queued activation',()=>{
  const g=tacticalGame();useSkill(g);tick(g,20);g.key('p');g.key('p',false);
  const frozen=g.state();g.frames(100);eq(g.state(),frozen);
  g.click('restart');g.click('cancel-restart');eq(g.state(),frozen);
  g.key('e');g.click('tactical-use');g.click('start');tick(g);eq(g.state().tacticalUses,1);assert(g.state().tacticalTime<frozen.tacticalTime);
  g.visibility(true);const hidden=g.state();g.frames(60);eq(g.state(),hidden);
  g.visibility(false);g.click('start');tick(g);eq(g.state().tacticalUses,1);
});

test('wave transition keeps energy but not active effects; restart and home isolate all transient skill state',()=>{
  const g=tacticalGame();useSkill(g);g.run('tacticalCharge=37;');finishDefenseWave(g);
  eq(g.state().tacticalCharge,37);eq(g.state().tacticalTime,0);g.click('supply-0');g.click('start');eq(g.state().tacticalCharge,37);
  g.click('restart');g.click('start');eq(g.state().tacticalCharge,100);eq(g.state().tacticalTime,0);eq(g.state().tacticalUses,0);
  g.key('p');g.key('p',false);g.click('menu-home');g.click('start');eq(g.state().tacticalCharge,0);eq(g.nodes.get('tactical-hud').hidden,true);
  g.click('mode-challenges');g.click('challenge-counter');useSkill(g);eq(g.state().tacticalCharge,0);eq(g.state().tacticalUses,0);
});

test('gamepad Y is neutral-armed and edge-triggered across pause and restart',()=>{
  const g=tacticalGame();g.pad([3]);g.frames(3);eq(g.state().tacticalUses,0);
  g.pad();g.frames(2);g.pad([3]);g.frames(2);eq(g.state().tacticalUses,1);
  g.run('tacticalCharge=100;tacticalTime=0;');g.frames(3);eq(g.state().tacticalUses,1);
  g.pad();g.frames(2);g.pad([3]);g.frames(2);eq(g.state().tacticalUses,2);
  g.key('p');g.key('p',false);g.click('restart');g.click('start');g.frames(3);eq(g.state().tacticalUses,0);
});

test('keyboard, touch and gamepad all discard skill input on the final spawn-warning tick',()=>{
  for(const input of ['key','touch','pad']) {
    const g=tacticalGame();g.pad();g.frames(2);g.run('spawnTime=.001;');
    if(input==='key')g.key('e');
    if(input==='touch')g.nodes.get('tactical-use').dispatch('pointerdown',{pointerId:91});
    if(input==='pad')g.pad([3]);
    g.frames(2);eq(g.state().spawnTime,0);eq(g.state().tacticalUses,0);eq(g.state().tacticalCharge,100);
  }
});

test('a skill pointer release cannot re-activate after recharge or after a rejected ingress press',()=>{
  const g=tacticalGame('demolition'),button=g.nodes.get('tactical-use');
  button.dispatch('pointerdown',{pointerId:1});tick(g);eq(g.state().tacticalUses,1);
  g.run('tacticalCharge=100;');button.dispatch('pointerup',{pointerId:1});button.dispatch('click',{detail:1});tick(g);eq(g.state().tacticalUses,1);
  g.run('spawnTime=.001;');button.dispatch('pointerdown',{pointerId:2});tick(g);
  button.dispatch('pointerup',{pointerId:2});button.dispatch('click',{detail:1});tick(g);eq(g.state().tacticalUses,1);
  button.click();tick(g);eq(g.state().tacticalUses,2,'Native keyboard click must remain usable');
});

test('99 charge is not ready and boss kills grant only actual damage plus one kill reward',()=>{
  const g=tacticalGame();g.run('tacticalCharge=99;');useSkill(g);eq(g.state().tacticalUses,0);
  g.run('chargeTactical(1);');useSkill(g);eq(g.state().tacticalUses,1);
  const b=defenseBoss(12);b.run('spawnTime=0;tacticalCharge=0;boss.hp=2;damageBoss(999);');eq(b.state().tacticalCharge,18);
  b.run('damageBoss(999);');eq(b.state().tacticalCharge,18);
});

test('skill meter and charge snapshots are detached and never alter the saved record schema',()=>{
  for(const blocked of [false,true]) {
    const g=defense({blocked,loadout:'demolition'});g.run('spawnTime=0;');const before=g.state().progress;useSkill(g);
    const state=g.win.__raidState;state.tacticalCharge=100;state.tacticalTime=100;eq(g.state().tacticalCharge,0);eq(g.state().tacticalTime,0);
    g.run('hud();');eq(g.nodes.get('tactical-meter').getAttribute('aria-valuenow'),'0');eq(g.nodes.get('tactical-use').getAttribute('aria-disabled'),'true');
    eq(g.state().progress,before);eq(Object.hasOwn(g.state().progress.survival,'tacticalCharge'),false);
  }
});

test('active skills support all three loadouts through four real-input waves without changing baseline replays', () => {
  let totalReflections = 0;
  for (const randomSeed of [1, 16437]) for (const loadout of ['assault', 'counter', 'demolition']) {
    for (const cadence of [8]) {
      const g = defense({ randomSeed, loadout }), tap = key => { g.key(key); g.key(key, false); };
      const encountered = new Set(); let frame = 0, decisions = 0, reflected = 0;
      // Seed only the VM fixture before initialization. Thereafter this is the
      // same read-only controller used by Chromium: real keys and menu clicks.
      for (let wave = 1; wave <= 4; wave++) {
        const decide = survivalTactics();
        eq(g.state().survivalWave, wave); g.key('j');
        let duration = 0;
        while (g.state().phase === 'playing' && duration < 3600) {
          if (frame % cadence === 0) {
            decisions++;
            const s = g.state(); s.enemies.forEach(enemy => encountered.add(enemy.type));
            const input = decide(s);
            g.key('a', input.move === 'a'); g.key('d', input.move === 'd');
            if (input.jump && s.ground) { g.key('w', false); g.key('w'); }
            else if (!input.jump) g.key('w', false);
            if (s.spawnTime === 0 && s.tacticalCharge === 100 && (loadout !== 'demolition' || s.bossWave || s.enemies.some(e => Math.abs(e.x - s.x) < 190))) tap('e');
            if (input.dash) tap('l');
            if (input.grenade) tap('k');
          }
          tick(g); duration++; frame++;
        }
        for (const key of ['a', 'd', 'w', 'j']) g.key(key, false);
        const s = g.state();
        eq(s.phase, 'waveClear', `Loadout ${loadout}, seed ${randomSeed}, cadence ${cadence}, wave ${wave}: ` + JSON.stringify(s));
        eq(s.survivalCleared, wave); eq(s.lives, 1); assert(s.hp > 0); eq(s.stageDeaths, 0); reflected += s.reflections;
        assert(duration > 132 && duration < 3600, 'Opening waves must resolve in under one active minute');
        if (wave < 4) {
          let choice = s.supplyOffers.indexOf('armor');
          if (choice < 0) choice = s.hp < 4 ? s.supplyOffers.indexOf('heal') : 0;
          g.click('supply-' + Math.max(0, choice)); g.click('start');
        }
      }
      assert(g.state().tacticalUses >= 2, 'Combat did not recharge a second use');
      eq([...encountered].sort(), ['charger', 'drone', 'shield', 'turret', 'walker']);
      // Explosive devices can clear a route before a reflection opportunity.
      totalReflections += reflected; assert(decisions > 20); eq(g.state().progress.survival.wave, 4);
      eq(g.state().progress.survival.best, g.state().score);
    }
  }
  assert(totalReflections > 0, 'The replay set must still exercise live reflections');
});

// Controller menu contracts use the source DOM hierarchy, not a fake list of
// always-visible controls. Real focus scrolling and CSS are checked in Chromium.
function padTap(g, button) { g.pad(); g.frames(2); g.pad([button]); g.frames(2); g.pad(); g.frames(2); }
function padFocus(g, id) {
  for (let i = 0; i < 45 && g.document.activeElement?.id !== id; i++) padTap(g, 13);
  eq(g.document.activeElement?.id, id, 'Controller cannot reach ' + id);
}
function padChoose(g, id) { padFocus(g, id); padTap(g, 0); }
function padWaveMenu(g) {
  g.click('mode-survival'); g.click('start');
  g.run('spawnTime=0; enemies.forEach(e=>e.dead=true); boss.dead=true; finishWave();');
  eq(g.state().phase, 'waveClear');
}

test('controller menus can choose modes, difficulty, loadout and challenge without phantom combat input', () => {
  const g = createGame();
  assert(g.nodes.get('controller-hint').hidden);
  g.pad(); g.frames(2); assert(!g.nodes.get('controller-hint').hidden);
  padChoose(g, 'difficulty-relaxed'); eq(g.state().difficulty, 'relaxed'); eq(g.state().phase, 'title');
  padChoose(g, 'mode-survival'); padChoose(g, 'loadout-demolition');
  eq(g.state().selectedLoadout, 'demolition'); eq(g.state().phase, 'title');
  padFocus(g, 'start'); g.pad([0]); g.frames(30);
  eq(g.state().mode, 'survival'); eq(g.state().loadout, 'demolition');
  eq(g.state().x, 466.5); assert(g.state().ground); eq(g.state().shots, 0); eq(g.state().grenades, 5);
  eq(g.state().tacticalUses, 0); assert(g.nodes.get('controller-hint').hidden);
  padTap(g, 9); eq(g.state().phase, 'pause');
  padChoose(g, 'menu-home'); eq(g.state().phase, 'confirmRestart');
  padChoose(g, 'start'); eq(g.state().phase, 'title');
  padChoose(g, 'mode-challenges'); padChoose(g, 'challenge-counter');
  eq(g.state().mode, 'challenge'); eq(g.state().challengeId, 'counter');
});

test('controller directions skip hidden modes, closed details, locked stages and disabled continue', () => {
  const g = createGame(); g.pad(); g.frames(2);
  const ids = () => g.read('menuControls().map(node=>node.id)');
  assert(!ids().includes('stage-1') && !ids().includes('stage-2') && !ids().includes('pause'));
  assert(!ids().includes('loadout-assault') && !ids().includes('challenge-sprint'));
  const summary = g.nodes.get('stage-menu').querySelector('summary');
  padChoose(g, summary.id); assert(g.nodes.get('stage-menu').open);
  assert(ids().includes('stage-1') && !ids().includes('stage-2') && !ids().includes('stage-3'));
  padFocus(g, 'stage-1'); padTap(g, 1); assert(!g.nodes.get('stage-menu').open);
  eq(g.document.activeElement.id, summary.id); eq(g.state().phase, 'title');
  padWaveMenu(g); assert(!ids().includes('start')); padTap(g, 9); eq(g.state().phase, 'waveClear');
  padChoose(g, 'supply-0'); assert(ids().includes('start'));
});

test('controller menus keep working without Element.checkVisibility', () => {
  const g = createGame();
  for (const node of g.nodes.values()) node.checkVisibility = undefined;
  const ids = () => g.read('menuControls().map(node=>node.id)');
  assert(!ids().includes('stage-1') && !ids().includes('stage-2') && !ids().includes('loadout-assault'));
  const summary = g.nodes.get('stage-menu').querySelector('summary');
  padChoose(g, summary.id); assert(ids().includes('stage-1'));
  padTap(g, 1); assert(!ids().includes('stage-1'));
  padChoose(g, 'mode-survival'); padChoose(g, 'loadout-counter'); padTap(g, 9);
  eq(g.state().mode, 'survival'); eq(g.state().loadout, 'counter'); eq(g.state().phase, 'playing');
});

test('controller menu A, B and Start are edge-triggered and destructive confirmation defaults to cancel', () => {
  const g = createGame(); padChoose(g, 'mode-survival');
  g.pad([0]); g.frames(90); eq(g.state().phase, 'title'); eq(g.state().titleView, 'survival');
  padTap(g, 9); eq(g.state().phase, 'playing');
  padTap(g, 9); eq(g.state().phase, 'pause');
  padChoose(g, 'menu-home'); eq(g.state().phase, 'confirmRestart');
  eq(g.document.activeElement.id, 'cancel-restart');
  g.pad([0]); g.frames(90); eq(g.state().phase, 'pause', 'Held A must cancel once, never resume');
  const before = g.state();
  g.pad(); g.frames(2); g.pad([1]); g.frames(30);
  eq(g.state().phase, 'playing'); eq(g.state().grenades, before.grenades); eq(g.state().shots, before.shots);
  assert(g.state().ground); eq(g.state().tacticalUses, 0);
});

test('controller direction repeat waits before repeating and reversal responds immediately', () => {
  const g = createGame(); g.pad(); g.frames(2);
  g.pad([13]); g.frames(1); const first = g.document.activeElement;
  g.frames(18); eq(g.document.activeElement.id, first.id);
  g.frames(4); const second = g.document.activeElement; assert(second !== first);
  g.frames(10); assert(g.document.activeElement !== second);
  g.pad([12]); g.frames(1); eq(g.document.activeElement.id, second.id);
  g.pad(); g.frames(2); g.pad([13]); g.frames(1); assert(g.document.activeElement !== second);
});

test('controller connect, replacement, hidden document and reconnect all require neutral including up', () => {
  const g = createGame(); g.pad([0, 12, 9]); g.frames(20); eq(g.state().phase, 'title');
  eq(g.document.activeElement, null); g.pad([12]); g.frames(20); eq(g.document.activeElement, null);
  g.pad(); g.frames(2); g.pad([13]); g.frames(1); assert(g.document.activeElement);
  const first = g.document.activeElement;
  g.pad([13], [0, 0], 'replacement'); g.frames(30); eq(g.document.activeElement.id, first.id);
  g.pad([], [0, 0], 'replacement'); g.frames(2); g.pad([13], [0, 0], 'replacement'); g.frames(1); assert(g.document.activeElement !== first);
  g.visibility(true); g.pad([0]); g.frames(30); eq(g.state().phase, 'title'); assert(g.nodes.get('controller-hint').hidden);
  g.visibility(false); g.frames(30); eq(g.state().phase, 'title');
  g.noPad(); g.frames(2); g.pad([9]); g.frames(20); eq(g.state().phase, 'title');
  padTap(g, 9); eq(g.state().phase, 'playing');
});

test('controller disconnect and connection never clear held keyboard movement', () => {
  const g = createGame(); g.start(); g.key('d'); g.frames(4); const first = g.state().x;
  g.pad([0]); g.frames(4); assert(g.state().x > first); const second = g.state().x;
  g.noPad(); g.frames(4); assert(g.state().x > second); g.key('d', false);
});

test('controller focus yields to keyboard and pointer without idle focus stealing', () => {
  const g = createGame(); padFocus(g, 'mode-survival'); const target = g.document.activeElement;
  assert(target.classList.contains('gamepad-focus'));
  g.key('Tab'); assert(!target.classList.contains('gamepad-focus'));
  g.nodes.get('mode-campaign').focus(); g.pad(); g.frames(60); eq(g.document.activeElement.id, 'mode-campaign');
  padFocus(g, 'mode-survival'); g.event('pointerdown'); assert(!target.classList.contains('gamepad-focus'));
});

test('controller-owned pause and automatic intermission show focus without stealing from keyboard', () => {
  const g = createGame(); g.event('pointerdown'); padTap(g, 9); padTap(g, 9);
  eq(g.state().phase, 'pause'); assert(g.nodes.get('start').classList.contains('gamepad-focus'));
  padTap(g, 9); g.clear(); eq(g.state().phase, 'stageClear');
  assert(g.nodes.get('upgrade-rapid').classList.contains('gamepad-focus'));
  padTap(g, 0); padTap(g, 9); g.key('j'); g.key('j', false); g.clear();
  eq(g.state().phase, 'stageClear'); assert(!g.nodes.get('upgrade-rapid').classList.contains('gamepad-focus'));
});

test('controller A selects chapter upgrade and Start continues only when ready', () => {
  const g = createGame(); g.start(); g.clear(); eq(g.state().phase, 'stageClear');
  padTap(g, 9); eq(g.state().phase, 'stageClear');
  padTap(g, 0); eq(g.state().selectedUpgrade, 'rapid');
  const before = g.state(); padTap(g, 1); eq(g.state().phase, 'confirmRestart');
  padTap(g, 9); eq(g.state().phase, 'stageClear'); eq(g.state().selectedUpgrade, before.selectedUpgrade);
  g.pad(); g.frames(2); g.pad([9, 0, 1, 2, 3, 4]); g.frames(8);
  eq(g.state().stage, 2); eq(g.state().phase, 'playing'); eq(g.state().upgrades.rapid, 1);
  eq(g.state().shots, 0); eq(g.state().grenades, Math.max(2, before.grenades)); assert(g.state().ground);
});

test('controller survival supply, reroll, commission, cancellation and next wave preserve state', () => {
  const g = createGame(); padWaveMenu(g); padChoose(g, 'supply-1');
  padFocus(g, 'supply-reroll'); g.pad([0]); g.frames(90);
  eq(g.state().supplyRerolls, 0); eq(g.state().selectedSupply, null); eq(g.state().phase, 'waveClear');
  assert(g.nodes.get('start').disabled); eq(g.document.activeElement.id, 'supply-0');
  padTap(g, 0); const supply = g.state().selectedSupply; assert(supply);
  padChoose(g, 'contract-summary'); padChoose(g, 'contract-recovery');
  eq(g.state().selectedContract, 'recovery'); padTap(g, 1); assert(!g.nodes.get('contract-options').open);
  const before = g.state(); padTap(g, 1); eq(g.state().phase, 'confirmRestart'); padTap(g, 1);
  eq(g.state().phase, 'waveClear'); eq(g.state().selectedSupply, supply);
  eq(g.state().selectedContract, 'recovery'); eq(g.state().supplyOffers, before.supplyOffers);
  eq(g.state().supplyRerolls, 0); eq(g.state().survivalTime, before.survivalTime);
  g.pad(); g.frames(2); g.pad([9, 0, 1, 2, 3, 4]); g.frames(8);
  eq(g.state().survivalWave, 2); eq(g.state().phase, 'playing'); assert(g.state().fieldContract);
  eq(g.state().shots, 0); eq(g.state().tacticalUses, 0); assert(g.state().ground);
});

test('controller Start reaches each challenge, boss intermission and terminal retry', () => {
  for (const key of ['sprint', 'counter', 'bosses']) {
    const g = createGame(); padChoose(g, 'mode-challenges'); padFocus(g, 'challenge-' + key); padTap(g, 9);
    eq(g.state().challengeId, key); eq(g.state().phase, 'playing');
  }
  const boss = createGame(); boss.click('mode-challenges'); boss.click('challenge-bosses'); boss.clear();
  eq(boss.state().phase, 'bossBreak'); padTap(boss, 9); eq(boss.state().stage, 2); eq(boss.state().phase, 'playing');
  for (const tag of ['victory','gameOver','practiceClear','challengeClear','challengeFailed','survivalOver']) {
    const g = createGame();
    if(tag.startsWith('challenge'))g.click('challenge-sprint');
    else if(tag==='survivalOver'){g.click('mode-survival');g.click('start');}
    else g.start();
    g.run(`showMenu('Result','Test','Retry','${tag}')`); padTap(g, 9); eq(g.state().phase, 'playing');
    g.run(`showMenu('Result','Test','Retry','${tag}')`); padTap(g, 1); eq(g.state().phase, 'title');
  }
});

// Tactical devices use the same production hit ordering and damage pipeline.
function deviceGame() {
  const g = defense();
  g.run("spawnTime=0;player.inv=100;enemies=[{...makeEnemy(60,'turret'),hp:50,maxHp:50,shot:100}];");
  return g;
}

test('devices follow supported arena geometry, reset per wave and never enter other modes', () => {
  const g = defense();
  for (const wave of [1, 2, 3, 4, 5, 6, 7, 99]) {
    g.run(`survivalWave=${wave - 1};startWave();`);
    const state = g.state(); eq(state.devices.length, wave % 3 ? 2 : 0);
    for (const d of state.devices) {
      eq(d.hp, 2); eq(d.spent, false);
      assert(d.x >= 0 && d.x + d.w <= 960);
      assert(d.y + d.h === 425 || state.platforms.some(([x,y,w]) => d.y+d.h === y && d.x >= x && d.x+d.w <= x+w));
      for (const p of state.pickups) assert(Math.hypot(d.x+12-p.x,d.y+18-p.y)>32);
    }
  }
  g.run('survivalWave=0;startWave();spawnTime=0;damageDevice(devices[0],2);');
  assert(g.state().devices[0].spent);
  g.key('r');g.click('start');eq(g.state().devices.map(d=>d.hp),[2,2]);eq(g.read('deviceBursts'),[]);
  const snapshot = g.win.__raidState;snapshot.devices[0].hp=99;snapshot.devices.push({});eq(g.state().devices.length,2);eq(g.state().devices[0].hp,2);
  g.run('openTitle();');eq(g.state().devices,[]);
  g.click('mode-campaign');g.click('start');eq(g.state().devices,[]);
  g.run('openTitle();');g.click('mode-challenges');g.click('challenge-bosses');eq(g.state().devices,[]);
});

test('device durability rejects ingress, enemy bullets, paused actions and repeated detonation', () => {
  const g=defense();g.run('damageDevice(devices[1],99);boom(600,407);');eq(g.state().devices.map(d=>d.hp),[2,2]);
  g.run("spawnTime=0;player.inv=100;enemies.forEach(e=>e.shot=100);projectile(600,407,0,0,'e');");tick(g);eq(g.state().devices[1].hp,2);
  g.run("bullets=[];projectile(580,407,650,0,'p');");tick(g,2);eq(g.state().devices[1].hp,1);
  g.key('p');const before=g.state();g.run('damageDevice(devices[1],2);');g.frames(30);eq(g.state(),before);
  g.key('p',false);g.key('p');g.key('p',false);g.run("projectile(580,407,650,0,'p');");tick(g,2);
  eq(g.state().devices[1].hp,0);assert(g.state().devices[1].spent);
  assert(g.nodes.get('mission-objective').textContent.includes('爆破装置 1 / 2'), 'Detonation must refresh its HUD immediately');
  const after=g.state();g.run('damageDevice(devices[1],99);damageDevice(devices[1],99);');eq(g.state(),after);
  g.key('r');g.click('cancel-restart');eq(g.state().devices[1].spent,true);
});

test('swept device contacts respect nearest targets, shields, piercing and enhanced projectiles', () => {
  const g=deviceGame();g.run("projectile(550,407,10000,0,'p');");tick(g);eq(g.state().devices[1].hp,1);eq(g.state().bullets,0);
  g.run("devices[1].hp=2;enemies=[{...makeEnemy(560,'shield'),shot:100,face:-1}];projectile(550,407,10000,0,'p');");tick(g);
  eq(g.state().devices[1].hp,2);eq(g.state().enemies[0].hp,5);
  g.run("enemies=[{...makeEnemy(650,'turret'),hp:50,maxHp:50,shot:100}];upgrades.pierce=2;projectile(550,407,10000,0,'p');");tick(g);
  eq(g.state().devices[1].hp,1);eq(g.state().enemies[0].hp,50);eq(g.state().bullets,0);
  g.run("devices[1].hp=2;projectile(580,407,650,0,'p',2);");tick(g,2);
  assert(g.state().devices[1].spent);eq(g.state().enemies[0].hp,46);eq(g.state().bullets,0);
});

test('natural ledge chain is finite, fixed-strength, safe for the player and skips arriving enemies', () => {
  const g=deviceGame();
  g.run(`survivalWave=1;startWave();spawnTime=0;player.inv=0;player.x=400;player.y=321;player.hp=3;
    upgrades.blast=2;loadout='demolition';
    enemies=[{...makeEnemy(460,'shield'),y:329,hp:30,maxHp:30,shot:100},
      {...makeEnemy(460,'walker'),y:329,arrival:.6}];damageDevice(devices[0],2);`);
  eq(g.state().devices.map(d=>d.spent),[true,true]);eq(g.read('deviceBursts.length'),2);assert(g.state().combatText.includes('连锁爆破 ×2'));
  assert(g.nodes.get('mission-objective').textContent.includes('爆破装置 0 / 2'), 'Chain HUD must include every spent device');
  eq(g.state().enemies.map(e=>e.hp),[22,3]);eq(g.state().hp,3);eq(g.state().score,0);eq(g.state().grenades,3);
  g.run('damageDevice(devices[1],20);');eq(g.read('deviceBursts.length'),2);eq(g.state().enemies[0].hp,22);
  g.key('p');const bursts=g.read('deviceBursts');g.frames(40);eq(g.read('deviceBursts'),bursts);
  g.key('p',false);g.key('p');g.key('p',false);tick(g,30);eq(g.read('deviceBursts'),[]);
});

test('device blasts clear only nearby hostiles without corrupting either projectile iteration order', () => {
  for (const reverse of [false,true]) {
    const g=deviceGame();
    g.run(`devices[1].hp=1;bullets=[];
      projectile(700,407,0,0,'e');projectile(760,407,0,0,'e');
      projectile(800,300,0,0,'p');projectile(580,407,650,0,'p');
      ${reverse?'bullets.reverse();':''}`);
    tick(g,2);assert(g.state().devices[1].spent);
    eq(g.read("bullets.filter(b=>b.owner==='e').map(b=>b.x)"),[760]);
    eq(g.read("bullets.filter(b=>b.owner==='p').map(b=>b.x)"),[800]);
  }
});

test('device kills use normal rewards but empty devices and grenade chains never mint resources', () => {
  const g=deviceGame();g.run('tacticalCharge=0;damageDevice(devices[0],2);');eq(g.state().score,0);eq(g.state().tacticalCharge,0);
  g.run(`upgrades.armor=1;upgrades.blast=1;player.grenades=2;
    enemies=[{...makeEnemy(730,'walker'),shot:100},{...makeEnemy(60,'turret'),shot:100}];boom(500,407);`);
  eq(g.state().grenades,2);eq(g.state().score,100);eq(g.state().tacticalCharge,21);assert(g.state().devices[1].spent);
  eq(g.state().progress.survival.wave,0);
});

test('pulse-triggered chains preserve skill provenance and cannot recharge their originating skill', () => {
  const g=defense({loadout:'demolition'});
  g.run(`survivalWave=1;startWave();spawnTime=0;player.x=190;player.y=321;
    enemies=[{...makeEnemy(660,'walker'),y:329,shot:100},{...makeEnemy(60,'turret'),y:40,shot:100}];useTactical();`);
  eq(g.state().devices.map(d=>d.spent),[true,true]);eq(g.state().tacticalCharge,0);eq(g.state().tacticalUses,1);
  eq(g.state().score,100);eq(g.state().grenades,5);
});

test('a last-enemy device explosion does not save a simultaneous lethal trade', () => {
  for (const reverse of [false,true]) {
    const g=deviceGame();
    g.run(`player.hp=1;player.inv=0;player.x=60;devices[1].hp=1;
      enemies=[{...makeEnemy(650,'walker'),shot:100}];
      projectile(60,400,0,0,'e');projectile(580,407,650,0,'p');
      ${reverse?'bullets.reverse();':''}`);
    tick(g,3);eq(g.state().phase,'survivalOver');eq(g.state().progress.survival,{wave:0,best:0});
  }
});

// Charger fixtures isolate geometry; the existing multi-seed four-wave runs
// above still exercise the actual roster using only ordinary player inputs.
function chargerGame(options) {
  const g=defense(options);
  g.run(`survivalWave=3;startWave();spawnTime=0;devices=[];pickups=[];
    enemies=[makeEnemy(650,'charger')];enemies[0].shot=0;
    player.x=480;player.inv=0;player.hp=maxHealth();`);
  return g;
}
const charger = g => g.state().enemies.find(e=>e.type==='charger');

test('one charger replaces a walker only after the first survival boss with bounded health',()=>{
  const g=defense();
  for(const wave of [1,2,3,4,5,6,7,8,9,10,98,99]){
    g.run(`survivalWave=${wave-1};startWave();`);
    const state=g.state(),rushers=state.enemies.filter(e=>e.type==='charger');
    eq(rushers.length,wave>=4&&wave%3?1:0);
    eq(state.enemies.length,wave%3?Math.min(8,3+Math.floor(wave/2)):0);
    if(rushers.length){
      eq(rushers[0].hp,4+Math.min(6,Math.floor((wave-1)/4)));
      eq(rushers[0].chargerPhase,'hunt');eq(rushers[0].chargerTime,0);
      assert(g.read('wavePreview(survivalWave)').includes('冲锋兵加入'));
    }
  }
  g.run('openTitle();');g.click('mode-campaign');g.click('start');
  for(let i=0;i<3;i++){g.run(`resetStage(${i},null);`);assert(!g.state().enemies.some(e=>e.type==='charger'));}
  g.run('openTitle();');g.click('mode-challenges');g.click('challenge-bosses');eq(g.state().enemies,[]);
});

test('charger freezes during ingress and relocation protection before starting its readable warning',()=>{
  const g=chargerGame();g.run('spawnTime=1;');const first=charger(g);tick(g,30);
  eq(charger(g),first);eq(g.state().hostiles,[]);
  g.run('player.x=enemies[0].x;spawnTime=DT;');tick(g);
  const relocated=charger(g);assert(relocated.arrival>0);eq(relocated.chargerPhase,'hunt');eq(relocated.chargerTime,0);
  tick(g,20);eq(charger(g).x,relocated.x);eq(charger(g).chargerPhase,'hunt');eq(g.state().hostiles,[]);
  g.run('player.x=260;');tickUntil(g,"enemies[0].chargerPhase==='windup'",160);
  near(charger(g).chargerTime,.8);
});

test('charger commits stationary windup, exact lane and recovery without tracking or bullets',()=>{
  const g=chargerGame();tick(g);const locked=charger(g);
  eq(locked.chargerPhase,'windup');eq(locked.face,-1);eq(locked.chargerEnd,434);near(locked.chargerTime,.8);
  // Crossing to the opposite side cannot retarget the visible lane.
  g.run('player.x=850;');tick(g,47);
  eq(charger(g).x,locked.x);eq(charger(g).face,-1);eq(charger(g).chargerEnd,434);
  assert(charger(g).chargerTime>0);eq(g.state().hostiles,[]);
  tickUntil(g,"enemies[0].chargerPhase==='rush'",3);eq(charger(g).x,650);
  tickUntil(g,"enemies[0].chargerPhase==='recover'",30);
  eq(charger(g).x,434);near(charger(g).chargerTime,1.1);eq(g.state().hostiles,[]);
  tick(g,65);eq(charger(g).x,434);eq(charger(g).chargerPhase,'recover');
  tickUntil(g,"enemies[0].chargerPhase==='hunt'",3);near(g.read('enemies[0].shot'),1.7);
  tick(g);assert(charger(g).x>434);eq(g.state().hostiles,[]);
  g.run('enemies[0].hp=1000;enemies[0].maxHp=1000;player.inv=100;');tick(g,600);
  eq(g.state().hostiles,[]);eq(g.state().turretCharge,0);
});

test('charger clamps both wall endpoints and always recovers rather than bouncing',()=>{
  for(const [x,px,end,face] of [[100,8,60,-1],[840,927,870,1]]){
    const g=chargerGame();g.run(`enemies[0].x=${x};player.x=${px};player.inv=100;`);tick(g);
    eq(charger(g).face,face);eq(charger(g).chargerEnd,end);
    tickUntil(g,"enemies[0].chargerPhase==='recover'",100);
    eq(charger(g).x,end);eq(charger(g).face,face);tick(g,30);eq(charger(g).x,end);
  }
});

test('grounded and crouching players take one rush hit, while real jumps reach a safe ledge',()=>{
  for(const crouch of [false,true]){
    const g=chargerGame();const hp=g.state().hp;if(crouch)g.key('s');
    tickUntil(g,"enemies[0].chargerPhase==='recover'",100);
    eq(g.state().hp,hp-1);eq(g.state().lives,1);eq(g.state().hostiles,[]);
  }
  for(const reducedMotion of [false,true]){
    const g=chargerGame({reducedMotion});g.run('player.x=580;');tick(g,31);
    assert(charger(g).chargerPhase==='windup');const hp=g.state().hp;
    g.key('w');tick(g);g.key('w',false);
    tickUntil(g,"enemies[0].chargerPhase==='recover'",80);
    eq(g.state().hp,hp);assert(g.state().y+g.state().playerHeight<=335);
    tick(g,30);eq(g.state().hp,hp);near(g.state().y+g.state().playerHeight,335);
  }
});

test('a late-windup ground jump clears the actual rushing body without a platform',()=>{
  const g=chargerGame();g.run('stage.platforms=[];');tick(g,37);
  eq(charger(g).chargerPhase,'windup');assert(charger(g).chargerTime>.15&&charger(g).chargerTime<.25);
  const hp=g.state().hp;g.key('w');tick(g);g.key('w',false);
  let crossed=false;
  for(let frame=0;frame<70;frame++){
    tick(g);const s=g.state(),e=charger(g);
    if(e.x<s.x+27&&e.x+e.w>s.x&&e.chargerPhase==='rush'){
      crossed=true;assert(s.y+s.playerHeight<e.y);
    }
  }
  assert(crossed,'The enemy must actually pass under the jumping player');eq(g.state().hp,hp);
  assert(g.state().ground);near(g.state().y+g.state().playerHeight,425);
});

test('dash and phase shield counter a rush using the existing damage pipeline',()=>{
  const g=chargerGame();g.run("player.x=580;player.face=1;");tickUntil(g,"enemies[0].chargerPhase==='rush'",60);
  const hp=g.state().hp;g.key('l');tick(g);g.key('l',false);tick(g,12);
  eq(g.state().hp,hp);assert(g.state().x>charger(g).x+charger(g).w);
  const shield=chargerGame({loadout:'counter'});shield.run('player.x=580;');
  tickUntil(shield,"enemies[0].chargerPhase==='rush'",60);
  const shieldHp=shield.state().hp;shield.key('e');tick(shield);shield.key('e',false);
  tickUntil(shield,"enemies[0].chargerPhase==='recover'",40);eq(shield.state().hp,shieldHp);
  assert(shield.state().tacticalTime>0);eq(shield.state().tacticalUses,1);
});

test('rush body sweep cannot tunnel and a lethal contact cannot award wave completion',()=>{
  const g=chargerGame();g.run("enemies[0].chargerPhase='rush';enemies[0].chargerEnd=434;player.x=550;update(.45);");
  eq(g.state().hp,5);eq(charger(g).x,434);
  const lethal=chargerGame();lethal.run("enemies[0].chargerPhase='rush';enemies[0].chargerEnd=434;player.x=630;player.hp=1;");
  tick(lethal);eq(lethal.state().phase,'survivalOver');eq(lethal.state().progress.survival,{wave:0,best:0});
});

test('charger can be stopped during windup or rush and its defeat pays once',()=>{
  for(const phase of ['windup','rush','recover']){
    const g=chargerGame();tickUntil(g,`enemies[0].chargerPhase==='${phase}'`,100);
    const before=g.state().score;g.run("damageEnemy(enemies[0],4);damageEnemy(enemies[0],4);");
    eq(g.state().score,before+160);eq(g.state().enemies,[]);eq(g.read('enemies[0].chargerTime'),0);
    const x=g.read('enemies[0].x');tick(g,10);eq(g.read('enemies[0].x'),x);eq(g.state().phase,'waveClear');eq(g.state().survivalCleared,4);
  }
});

test('charger takes normal bullet, grenade, device and tactical damage without adding armor',()=>{
  for(const source of ['bullet','grenade','device','skill']){
    const g=chargerGame({loadout:'demolition'});g.run('player.x=600;player.inv=100;');tick(g);
    if(source==='bullet'){
      g.run("projectile(630,407,650,0,'p',4);");tick(g,3);
    }else if(source==='grenade')g.run('boom(665,407);');
    else if(source==='device')g.run("devices=[{x:600,y:389,w:24,h:36,hp:2,spent:false}];damageDevice(devices[0],2);");
    else {g.key('e');tick(g);g.key('e',false);eq(g.state().tacticalCharge,0);}
    eq(g.state().enemies,[]);assert(g.state().score>=160);eq(g.state().grenades,g.state().phase==='waveClear'?6:5);
  }
});

test('warning and recovery survive pause, canceled confirmations, blur and reset cleanly on retry',()=>{
  for(const stage of ['windup','rush','recover']){
    const g=chargerGame();tickUntil(g,`enemies[0].chargerPhase==='${stage}'`,100);
    g.key('p');g.key('p',false);const frozen=g.state();g.frames(40);eq(g.state(),frozen);
    for(const control of ['restart','menu-home']){g.click(control);g.frames(10);g.click('cancel-restart');eq(g.state(),frozen);}
    g.click('start');tick(g);assert(g.state().survivalTime>frozen.survivalTime);
    g.event('blur');eq(g.state().phase,'pause');const blurred=g.state();g.frames(20);eq(g.state(),blurred);
    g.key('r');g.click('start');eq(g.state().survivalWave,1);assert(!g.state().enemies.some(e=>e.type==='charger'));
  }
});

test('charger snapshots are detached and no attack state is written to saved records',()=>{
  const g=chargerGame();tick(g);const first=charger(g),snapshot=g.win.__raidState;
  snapshot.enemies[0].chargerEnd=9999;snapshot.enemies[0].chargerPhase='rush';snapshot.enemies.splice(0,1);
  eq(charger(g),first);g.run('saveProgress();');
  assert(!JSON.stringify(g.state().progress).includes('charger'));
});

// Beacon occupation reuses the wave contract boundary; private arrangements
// below isolate geometry, timing and same-frame resolution, not browser input.
function beaconDefense({ wave = 2, ...options } = {}) {
  const g = defense(options);
  if (wave !== 2) g.run(`survivalWave=${wave - 2};startWave();`);
  finishDefenseWave(g); g.click('contract-beacon'); g.click('supply-0'); g.click('start');
  eq(g.state().survivalWave, wave); assert(g.state().fieldContract.beacon);
  return g;
}
function standAtBeacon(g, offset = 0) {
  const b = g.state().fieldContract.beacon;
  g.run(`clearInput();player.x=${b.x - 13.5 + offset};player.y=${b.y - 44};player.h=44;
    player.vx=0;player.vy=0;player.ground=true;player.dashTime=0;player.dropPlatform=null;`);
}
const beaconProgress = g => g.state().fieldContract.beacon.progress;
function captureBeacon(g) { isolateRecoveryCombat(g); standAtBeacon(g); tick(g, 300); eq(beaconProgress(g), 5); }

test('beacon is an exclusive opt-in commission and never starts a wave without a supply', () => {
  const g = createGame(); g.click('contract-beacon'); eq(g.state().selectedContract, 'hold');
  g.click('mode-survival'); g.click('start'); eq(g.state().fieldContract, null);
  finishDefenseWave(g); const initial = g.state();
  for (let i = 0; i < 3; i++) g.click('contract-beacon');
  eq(g.state().selectedContract, 'beacon'); eq(g.state().fieldContract, null); assert(g.nodes.get('start').disabled);
  for (const key of Object.keys(initial)) if (key !== 'selectedContract') eq(g.state()[key], initial[key]);
  g.click('start'); eq(g.state().phase, 'waveClear');
  g.click('contract-recovery'); eq(g.state().selectedContract, 'recovery');
  eq(g.nodes.get('contract-beacon').getAttribute('aria-pressed'), 'false');
  g.click('contract-beacon'); eq(g.nodes.get('contract-recovery').getAttribute('aria-pressed'), 'false');
  g.click('supply-reroll'); eq(g.state().selectedContract, 'beacon');
  g.click('supply-0'); const ready = g.state();
  for (const id of ['restart', 'menu-home']) { g.click(id); tick(g, 60); g.click('cancel-restart'); eq(g.state(), ready); }
  g.click('start'); eq(g.state().selectedContract, 'hold'); eq(g.state().fieldContract.nodes, []);
  eq(g.nodes.get('contract-name').textContent, '信标夺控');
  assert(g.nodes.get('contract-objective').textContent.includes('尚未启用'));
  assert(g.nodes.get('contract-reward').textContent.includes('+35'));
  const started = g.state(); g.click('contract-hold'); g.click('contract-beacon'); eq(g.state(), started);
});

test('beacons stay on distinct supported ledges in all three layouts, away from pickups and devices', () => {
  const seen = new Set();
  for (const wave of [2, 4, 5, 7, 8, 10, 11, 13]) {
    const g = beaconDefense({ wave }), state = g.state(), b = state.fieldContract.beacon;
    seen.add(state.arena.id); eq(b.radius, 48); eq(b.progress, 0); eq(b.occupied, false);
    assert(state.platforms.some(([x, y, w]) => y === b.y && b.x - b.radius > x + 3 && b.x + b.radius < x + w - 3));
    assert(state.pickups.every(p => Math.hypot(p.x - b.x, p.y - (b.y - 25)) > 40));
    assert(state.devices.every(d => d.y + d.h !== b.y || d.x + d.w < b.x - b.radius || d.x > b.x + b.radius));
    isolateRecoveryCombat(g); g.run(`player.x=${b.x - 13.5};player.y=G-44;player.vy=0;`); tick(g, 10);
    eq(beaconProgress(g), 0, 'Ground below the signal must never count');
    standAtBeacon(g); tick(g); assert(beaconProgress(g) > 0);
  }
  eq([...seen].sort(), ['bridge', 'flanks', 'steps']);
});

test('beacon takes exactly 300 eligible ticks, caps at five seconds and pays nothing on capture', () => {
  const g = beaconDefense(); isolateRecoveryCombat(g); standAtBeacon(g);
  g.run('player.hp=2;player.grenades=2;tacticalCharge=17;');
  const before = g.state(), stored = g.values.get(STORE);
  tick(g, 299); near(beaconProgress(g), 299 / 60); eq(g.state().fieldContract.status, 'active');
  assert(!g.nodes.get('contract-objective').textContent.includes('夺控完成'));
  tick(g); eq(beaconProgress(g), 5); assert(g.nodes.get('contract-objective').textContent.includes('夺控完成'));
  eq(g.state().combatText, '信标夺控完成 · 活着清场领取奖励');
  tick(g, 480); eq(beaconProgress(g), 5); eq(g.state().phase, 'playing');
  for (const key of ['score', 'hp', 'grenades', 'tacticalCharge', 'progress']) eq(g.state()[key], before[key]);
  eq(g.values.get(STORE), stored);
});

test('beacon zone includes its marked center boundary but excludes outside, flight and drop-through', () => {
  for (const sign of [-1, 1]) {
    const g = beaconDefense(); isolateRecoveryCombat(g);
    standAtBeacon(g, sign * 48.1); tick(g); eq(beaconProgress(g), 0);
    standAtBeacon(g, sign * 48); tick(g); near(beaconProgress(g), 1 / 60);
    standAtBeacon(g); g.key('w'); tick(g); g.key('w', false);
    const before = beaconProgress(g); assert(!g.state().ground); tick(g, 15); eq(beaconProgress(g), before);
    standAtBeacon(g); g.key('s'); tick(g, 30); eq(g.state().crouch, true); near(beaconProgress(g), before + .5);
    g.key('w'); tick(g); g.key('w', false); g.key('s', false);
    assert(g.state().dropTime > 0); const left = beaconProgress(g); tick(g, 25); eq(beaconProgress(g), left);
    standAtBeacon(g); tick(g, 30); near(beaconProgress(g), left + .5);
  }
});

test('beacon ingress, off-zone movement, damage and pauses preserve existing progress without advancing it', () => {
  const g = beaconDefense(); isolateRecoveryCombat(g); standAtBeacon(g); g.run('spawnTime=.5;');
  tick(g, 20); eq(beaconProgress(g), 0); g.run('spawnTime=0;'); tick(g, 90); near(beaconProgress(g), 1.5);
  g.run('player.inv=0;hurt(1);'); near(beaconProgress(g), 1.5);
  standAtBeacon(g, 60); tick(g, 120); near(beaconProgress(g), 1.5); eq(g.state().fieldContract.beacon.occupied, false);
  standAtBeacon(g);
  for (const pause of ['keyboard', 'blur', 'visibility']) {
    if (pause === 'keyboard') g.key('p'); else if (pause === 'blur') g.event('blur'); else g.visibility(true);
    eq(g.state().phase, 'pause'); const frozen = g.state(); tick(g, 120); g.frames(20); eq(g.state(), frozen);
    for (const id of ['restart', 'menu-home']) { g.click(id); tick(g, 120); g.click('cancel-restart'); eq(g.state(), frozen); }
    if (pause === 'visibility') g.visibility(false);
    g.click('start'); near(beaconProgress(g), 1.5);
  }
  tick(g, 210); eq(beaconProgress(g), 5);
});

test('completed beacon settles only once with normal rewards and persists the combined clear score', () => {
  const g = beaconDefense(); captureBeacon(g); g.run('player.hp=2;player.grenades=2;tacticalCharge=17;');
  const before = g.state(); finishDefenseWave(g); const settled = g.state();
  eq(settled.fieldContract.status, 'success'); eq(settled.fieldContract.beacon.occupied, false);
  eq(settled.score, before.score + 600); eq(settled.hp, 4); eq(settled.grenades, 3); eq(settled.tacticalCharge, 52);
  eq(settled.progress.survival, { wave: 2, best: settled.score }); eq(JSON.parse(g.values.get(STORE)).survival, settled.progress.survival);
  assert(g.nodes.get('result-details').textContent.includes('信标夺控完成')); assert(g.nodes.get('contract-hud').hidden);
  for (let i = 0; i < 3; i++) { g.run('finishWave();'); tick(g, 60); eq(g.state(), settled); }
});

test('beacon reward respects health and charge caps even during active timed skills', () => {
  for (const loadout of ['assault', 'counter', 'demolition']) for (const charge of [0, 90, 100]) {
    const g = beaconDefense({ loadout }); captureBeacon(g);
    g.run(`upgrades.armor=2;player.hp=maxHealth()-1;player.grenades=6;tacticalCharge=${charge};tacticalTime=2;`);
    finishDefenseWave(g); const state = g.state();
    eq(state.hp, state.maxHp); eq(state.grenades, 7); eq(state.tacticalCharge, Math.min(100, charge + 35));
    eq(state.tacticalTime, 0); eq(state.fieldContract.status, 'success');
  }
});

test('clearing early never stalls or pays a beacon reward, including a last-enemy kill at 4.99 seconds', () => {
  for (const progress of [0, 2.5, 4.99]) {
    const g = beaconDefense(); isolateRecoveryCombat(g); standAtBeacon(g);
    g.run(`fieldContract.beacon.progress=${progress};player.hp=2;player.grenades=2;tacticalCharge=17;`);
    const before = g.state(); finishDefenseWave(g); const state = g.state();
    eq(state.fieldContract.status, 'missed'); eq(beaconProgress(g), progress);
    eq(state.score, before.score + 300); eq(state.hp, 3); eq(state.grenades, 3); eq(state.tacticalCharge, 17);
    assert(g.nodes.get('result-details').textContent.includes('信标夺控未完成'));
    if (progress === 4.99) assert(g.nodes.get('result-details').textContent.includes('4.9 / 5.0'));
    assert(g.nodes.get('result-details').textContent.includes('正常清场奖励保留'));
  }
});

test('a final live projectile kill at 4.99 seconds resolves before occupation and cannot earn the beacon bonus', () => {
  const g = beaconDefense(); isolateRecoveryCombat(g); standAtBeacon(g);
  g.run(`fieldContract.beacon.progress=4.99;player.hp=2;tacticalCharge=17;
    enemies=[{...makeEnemy(150,'turret'),hp:1,shot:100}];
    projectile(enemies[0].x+15,enemies[0].y+18,0,0,'p');`);
  const before = g.state(); tick(g); const state = g.state();
  eq(state.phase, 'waveClear'); eq(beaconProgress(g), 4.99); eq(state.fieldContract.status, 'missed');
  eq(state.score, before.score + 160 + 300); eq(state.hp, 3); eq(state.tacticalCharge, 32);
});

test('death and either projectile order in lethal trades override completed beacon settlement', () => {
  for (const complete of [false, true]) for (const killFirst of [false, true]) {
    const g = beaconDefense(); isolateRecoveryCombat(g); standAtBeacon(g);
    if (complete) tick(g, 300);
    const before = g.state(), stored = g.values.get(STORE);
    const lethal = "projectile(player.x+12,player.y+20,0,0,'e');";
    const kill = "projectile(enemies[0].x+15,enemies[0].y+18,0,0,'p');";
    g.run(`player.hp=1;player.inv=0;enemies=[{...makeEnemy(150,'turret'),hp:1,shot:100}];bullets=[];
      ${killFirst ? lethal + kill : kill + lethal}`); tick(g);
    eq(g.state().phase, 'survivalOver'); eq(g.state().fieldContract.status, 'missed');
    eq(g.state().hp, 0); eq(g.state().score, before.score + (killFirst ? 160 : 0));
    eq(g.state().progress, before.progress); eq(g.values.get(STORE), stored);
    assert(g.nodes.get('result-details').textContent.includes('信标夺控未结算'));
    const dead = g.state(); tick(g, 60); g.run('finishWave();'); eq(g.state(), dead);
    g.click('start'); eq(g.state().survivalWave, 1); eq(g.state().fieldContract, null);
  }
});

test('beacon choice and nested progress are detached, transient and excluded from boss waves', () => {
  const g = beaconDefense(); isolateRecoveryCombat(g); standAtBeacon(g); tick(g, 90);
  const before = g.state(), snapshot = g.win.__raidState;
  snapshot.fieldContract.beacon.progress = 5; snapshot.fieldContract.beacon.x = -500; snapshot.fieldContract.status = 'success';
  eq(g.state(), before); finishDefenseWave(g); eq(g.state().selectedContract, 'hold');
  assert(!g.nodes.get('contract-options').open); assert(g.nodes.get('contract-beacon').disabled);
  const clear = g.state(); g.click('contract-beacon'); g.run("chooseContract('beacon');"); eq(g.state(), clear);
  g.click('supply-0'); g.click('start'); eq(g.state().survivalWave, 3); eq(g.state().fieldContract, null);
  finishDefenseWave(g); g.click('contract-beacon'); g.click('supply-0'); g.click('start');
  eq(g.state().survivalWave, 4); eq(beaconProgress(g), 0);
  g.click('restart'); g.click('start'); eq(g.state().fieldContract, null); eq(g.state().survivalWave, 1);
});

test('beacon reset, reload and blocked storage preserve records without carrying objectives into other modes', () => {
  for (const blocked of [false, true]) {
    const g = beaconDefense({ blocked }), other = nonDefenseRecords(g); captureBeacon(g); finishDefenseWave(g);
    eq(nonDefenseRecords(g), other); const records = g.state().progress;
    if (blocked) eq(g.values.size, 0);
    else {
      const saved = JSON.parse(g.values.get(STORE)); assert(!/beacon|fieldContract|selectedContract/.test(JSON.stringify(saved)));
      const reload = createGame({ storage: Object.fromEntries(g.values) }); eq(reload.state().progress, records); eq(reload.state().fieldContract, null);
    }
    g.click('menu-home'); g.click('start'); eq(g.state().phase, 'title'); eq(g.state().fieldContract, null);
    g.click('mode-campaign'); g.click('start'); g.click('contract-beacon'); eq(g.state().fieldContract, null);
    eq(g.state().progress, records); assert(g.nodes.get('contract-hud').hidden);
  }
});

test('gamepad can select and switch beacon without leaking menu inputs or replaying a settled reward', () => {
  const g = defense(); finishDefenseWave(g); g.pad([]); g.frames(2);
  padChoose(g, 'contract-summary'); padChoose(g, 'contract-beacon'); eq(g.state().selectedContract, 'beacon');
  padChoose(g, 'contract-recovery'); eq(g.state().selectedContract, 'recovery');
  padChoose(g, 'contract-beacon'); padTap(g, 1); assert(!g.nodes.get('contract-options').open);
  padChoose(g, 'supply-0'); padChoose(g, 'start'); g.noPad();
  eq(g.state().survivalWave, 2); assert(g.state().fieldContract.beacon); eq(g.state().shots, 0);
  eq(g.state().jumpBuffer, 0); captureBeacon(g); finishDefenseWave(g); const settled = g.state();
  padTap(g, 0); eq(g.state().score, settled.score); eq(g.state().tacticalCharge, settled.tacticalCharge);
});

test('real inputs capture all three beacon layouts and clear five waves across loadouts and timing cadences', () => {
  for (const loadout of ['assault', 'counter', 'demolition']) for (const randomSeed of [42]) for (const cadence of [5, 12]) {
    const g = defense({ loadout, randomSeed }), records = nonDefenseRecords(g);
    const tap = key => { g.key(key); g.key(key, false); };
    const layouts = new Set();
    for (let wave = 1; wave <= 5; wave++) {
      const capture = [2, 4, 5].includes(wave), navigate = beaconTactics(), fight = survivalTactics();
      let frames = 0, observedCapture = false, prior = 0;
      while (g.state().phase === 'playing' && frames < 3600) {
        if (frames % cadence === 0) {
          const state = g.state(), untouched = JSON.stringify(state), b = state.fieldContract?.beacon;
          const input = capture && b.progress < 5 ? navigate(state) : fight(state);
          eq(JSON.stringify(state), untouched);
          if (capture) {
            assert(b.progress >= prior); prior = b.progress;
            if (b.progress === 5) { observedCapture = true; eq(state.fieldContract.status, 'active'); }
          }
          g.key('a', input.move === 'a'); g.key('d', input.move === 'd'); g.key('j', input.fire !== false); g.key('s', input.down === true);
          if (input.jump && state.ground) { g.key('w', false); g.key('w'); } else if (!input.jump) g.key('w', false);
          if (input.dash) tap('l'); if (input.grenade) tap('k'); if (input.tactical) tap('e');
        }
        tick(g); frames++;
      }
      for (const key of ['a', 'd', 'w', 's', 'j']) g.key(key, false);
      const state = g.state();
      eq(state.phase, 'waveClear', `Beacon ${loadout}, seed ${randomSeed}, cadence ${cadence}, wave ${wave}: ` + JSON.stringify(state));
      eq(state.survivalCleared, wave); assert(state.hp > 0); eq(state.stageDeaths, 0); eq(nonDefenseRecords(g), records);
      eq(state.progress.survival, { wave, best: state.score });
      if (capture) { eq(state.fieldContract.status, 'success'); eq(state.fieldContract.beacon.progress, 5); assert(observedCapture); layouts.add(state.arena.id); }
      else eq(state.fieldContract, null);
      if (wave < 5) {
        let index = state.supplyOffers.indexOf('armor');
        if (index < 0) index = state.hp < 4 ? state.supplyOffers.indexOf('heal') : 0;
        g.click('supply-' + Math.max(0, index));
        if ([2, 4, 5].includes(wave + 1)) g.click('contract-beacon');
        g.click('start');
      }
    }
    eq([...layouts].sort(), ['bridge', 'flanks', 'steps']);
  }
});

// Mortar fixtures isolate support-level impact geometry. Real input runs above
// and the published browser test still reach these waves without mutations.
function mortarGame(options) {
  const g=defense(options);
  g.run(`survivalWave=4;startWave();spawnTime=0;devices=[];pickups=[];
    enemies=[makeEnemy(800,'mortar')];enemies[0].shot=0;
    player.x=465;player.inv=0;player.hp=maxHealth();`);
  return g;
}
const mortar=g=>g.state().enemies.find(e=>e.type==='mortar');
function launchMortar(g){tickUntil(g,'shells.length===1',65);assert(mortar(g).windup===0);}
function impactMortar(g){tickUntil(g,'mortarBursts.length===1',60);}

test('one mortar replaces a turret at wave five without displacing the charger or increasing the roster',()=>{
  const g=defense();
  for(const wave of [1,2,3,4,5,6,7,8,9,10,98,99]){
    g.run(`survivalWave=${wave-1};startWave();`);
    const s=g.state(),casters=s.enemies.filter(e=>e.type==='mortar');
    eq(casters.length,wave>=5&&wave%3?1:0);
    eq(s.enemies.length,wave%3?Math.min(8,3+Math.floor(wave/2)):0);
    eq(s.enemies.filter(e=>e.type==='charger').length,wave>=4&&wave%3?1:0);
    if(casters.length){eq(casters[0].hp,4+Math.min(6,Math.floor((wave-1)/4)));eq(casters[0].windup,0);assert(g.read('wavePreview(survivalWave)').includes('投弹兵'));}
    eq(s.shells,[]);eq(s.mortarBursts,[]);
  }
  for(const mode of ['campaign','practice','challenge']){
    g.run(`openTitle();mode='${mode}';`);
    for(let index=0;index<3;index++){g.run(`resetStage(${index},null);`);assert(!g.state().enemies.some(e=>e.type==='mortar'));eq(g.state().shells,[]);}
  }
});

test('mortar waits through ingress, relocation and airborne motion then locks the actual support level',()=>{
  const g=mortarGame();g.run('spawnTime=1;');const waiting=mortar(g);tick(g,30);eq(mortar(g),waiting);
  g.run('player.x=enemies[0].x;spawnTime=DT;');tick(g);assert(mortar(g).arrival>0);eq(mortar(g).windup,0);
  tick(g,20);eq(mortar(g).windup,0);eq(g.state().shells,[]);
  g.run('enemies[0].arrival=0;enemies[0].shot=0;player.x=465;player.inv=100;');
  g.key('w');tick(g);g.key('w',false);assert(!g.state().ground);eq(mortar(g).windup,0);
  for(let n=0;n<90&&!g.state().ground;n++){eq(mortar(g).windup,0);tick(g);}
  assert(g.state().ground);near(mortar(g).windup,.9);near(mortar(g).aimY,g.state().y+g.state().playerHeight);
  const support=mortar(g).aimY,lockedX=mortar(g).aimX;g.key('d');tick(g,30);g.key('d',false);
  near(mortar(g).aimY,support);near(mortar(g).aimX,lockedX);eq(g.state().hostiles,[]);eq(g.state().turretCharge,0);
});

test('mortar retains the complete fixed warning, one harmless arc and an unscaled reload',()=>{
  const g=mortarGame();tick(g);near(mortar(g).windup,.9);const x=mortar(g).aimX,y=mortar(g).aimY;
  tick(g,53);assert(mortar(g).windup>0);eq(g.state().shells,[]);
  launchMortar(g);let shot=g.state().shells[0];eq(shot.elapsed,0);near(mortar(g).shot,2.6);
  eq([shot.aimX,shot.aimY],[x,y]);eq(shot.zone,{x:x-58,y:y-64,w:116,h:64});
  const hp=g.state().hp;tick(g,25);shot=g.state().shells[0];assert(shot.y<shot.startY-100);eq(g.state().hp,hp);
  tick(g,25);eq(g.state().shells.length,1);eq(g.state().hp,hp);
  impactMortar(g);eq(g.state().shells,[]);eq(g.state().hp,hp-1);eq(g.state().mortarBursts.length,1);
  tick(g,20);eq(g.state().hp,hp-1);eq(g.state().mortarBursts,[]);assert(mortar(g).shot>1);
  g.run('survivalWave=98;enemies[0].shot=0;');tick(g);near(mortar(g).windup,.9);
  launchMortar(g);near(mortar(g).shot,2.6);eq(g.state().hostiles,[]);
});

test('mortar support boxes match all three arena ledges, clamp wall edges and exclude players underneath',()=>{
  for(const wave of [5,7,8]){
    const g=mortarGame();g.run(`survivalWave=${wave-1};startWave();spawnTime=0;devices=[];pickups=[];
      enemies=[makeEnemy(900,'mortar')];enemies[0].shot=0;player.inv=0;`);
    for(const [x,y,w] of g.state().platforms){
      g.run(`shells=[];enemies[0].windup=0;enemies[0].shot=0;player.x=${x+w/2-13.5};
        player.y=${y-44};player.h=44;player.vy=0;player.vx=0;player.ground=true;player.inv=0;`);
      tick(g);near(mortar(g).aimY,y);near(mortar(g).aimX,x+w/2);launchMortar(g);
      const hp=g.state().hp;g.run('player.y=G-44;player.vy=0;player.ground=true;');impactMortar(g);eq(g.state().hp,hp);
      g.run('mortarBursts=[];');
    }
  }
  for(const [x,target] of [[8,58],[927,902]]){
    const g=mortarGame();g.run(`player.x=${x};`);tick(g);near(mortar(g).aimX,target);
    launchMortar(g);const box=g.state().shells[0].zone;assert(box.x>=0&&box.x+box.w<=960);
  }
});

test('mortar box boundary uses the same rectangle as its warning and crouching does not evade it',()=>{
  for(const [offset,damage] of [[-85,false],[-84.9,true],[58,false],[57.9,true]]){
    const g=mortarGame();tick(g);const x=mortar(g).aimX;launchMortar(g);
    g.run(`player.x=${x+offset};player.inv=0;`);const hp=g.state().hp;impactMortar(g);eq(g.state().hp,hp-Number(damage));
  }
  const g=mortarGame();g.key('s');tick(g);launchMortar(g);const hp=g.state().hp;impactMortar(g);eq(g.state().hp,hp-1);assert(g.state().crouch);
});

test('genuine walk, timed jump and platform drop evade the locked impact while preserving beacon progress',()=>{
  for(const reducedMotion of [false,true]){
    const walk=mortarGame({reducedMotion});tick(walk);const target=mortar(walk).aimX;walk.key('a');tick(walk,30);walk.key('a',false);
    launchMortar(walk);const hp=walk.state().hp;impactMortar(walk);eq(walk.state().hp,hp);assert(walk.state().x+27<target-58);
    const jump=mortarGame({reducedMotion});jump.run('stage.platforms=[];');launchMortar(jump);tick(jump,30);
    const health=jump.state().hp;jump.key('w');tick(jump);jump.key('w',false);impactMortar(jump);eq(jump.state().hp,health);assert(jump.state().y+jump.state().playerHeight<361);
    const drop=beaconDefense({wave:5,reducedMotion});standAtBeacon(drop);
    drop.run("spawnTime=0;devices=[];pickups=[];enemies=[makeEnemy(100,'mortar')];enemies[0].shot=0;player.inv=0;fieldContract.beacon.progress=2;");
    tick(drop,10);launchMortar(drop);const progress=beaconProgress(drop),healthBefore=drop.state().hp;
    drop.key('s');drop.key('w');tick(drop);drop.key('w',false);drop.key('s',false);assert(drop.state().dropTime>0);
    impactMortar(drop);eq(drop.state().hp,healthBefore);near(beaconProgress(drop),progress);assert(drop.state().y+drop.state().playerHeight>mortar(drop).aimY);
  }
});

test('dash and phase shield protect from mortar without reflecting it or charging from its blast',()=>{
  for(const kind of ['dash','shield']){
    const g=mortarGame({loadout:'counter'});launchMortar(g);tick(g,49);
    g.run('player.face=-1;tacticalCharge=100;');const hp=g.state().hp;
    g.key(kind==='dash'?'l':'e');tick(g);g.key(kind==='dash'?'l':'e',false);impactMortar(g);
    eq(g.state().hp,hp);eq(g.state().reflections,0);eq(g.state().hostiles,[]);
    if(kind==='shield'){eq(g.state().tacticalUses,1);eq(g.state().tacticalCharge,0);}
    else eq(g.state().tacticalCharge,100);
  }
});

test('killing a mortar interrupts windup but never erases a launched shell, with ordinary reward and skill attribution',()=>{
  for(const launched of [false,true]){
    const g=mortarGame();g.run("enemies.push({...makeEnemy(60,'turret'),shot:100});tacticalCharge=0;");tick(g);if(launched)launchMortar(g);
    const score=g.state().score;g.run('damageEnemy(enemies[0],4);damageEnemy(enemies[0],4);');
    eq(g.state().score,score+160);eq(g.state().tacticalCharge,24);eq(g.read('enemies[0].windup'),0);
    eq(g.state().shells.length,Number(launched));const hp=g.state().hp;tick(g,60);eq(g.state().hp,hp-Number(launched));
  }
  const skill=mortarGame({loadout:'demolition'});skill.run('enemies[0].x=600;');skill.key('e');tick(skill);skill.key('e',false);
  eq(skill.state().enemies,[]);eq(skill.state().tacticalCharge,0);eq(skill.state().shells,[]);
});

test('lethal impact wins same-tick last-enemy trades and never pays clear or completed beacon rewards',()=>{
  for(const order of [false,true]){
    const g=beaconDefense({wave:5});standAtBeacon(g);
    g.run("spawnTime=0;devices=[];pickups=[];enemies=[makeEnemy(100,'mortar')];enemies[0].shot=0;player.inv=0;fieldContract.beacon.progress=5;");
    launchMortar(g);g.run(`player.hp=1;shells[0].elapsed=MORTAR.flight-DT/2;
      projectile(95,407,650,0,'p',99);${order?'bullets.reverse();':''}`);
    const before=g.state().progress.survival;tick(g);eq(g.state().phase,'survivalOver');eq(g.state().progress.survival,before);
    eq(g.state().fieldContract.status,'missed');eq(g.state().shells,[]);eq(g.state().mortarBursts,[]);
  }
});

test('warning and flight freeze on pause, confirmation, hidden tab and blur; snapshots and saves stay detached',()=>{
  for(const launched of [false,true]){
    const g=mortarGame();tick(g);if(launched)launchMortar(g);
    g.key('p');g.key('p',false);const frozen=g.state();g.frames(120);eq(g.state(),frozen);
    for(const name of ['restart','menu-home']){g.click(name);g.frames(30);g.click('cancel-restart');eq(g.state(),frozen);}
    const snapshot=g.win.__raidState;if(launched){snapshot.shells[0].aimY=-999;snapshot.shells[0].zone.h=999;}else snapshot.enemies[0].aimX=-999;
    eq(g.state(),frozen);g.run('saveProgress();');assert(!/mortar|shells|aimX/.test(JSON.stringify(g.state().progress)));
    g.click('start');tick(g);g.visibility(true);const hidden=g.state();g.frames(60);eq(g.state(),hidden);g.visibility(false);g.click('start');tick(g);
    g.event('blur');const blurred=g.state();g.frames(60);eq(g.state(),blurred);eq(g.state().phase,'pause');
    g.key('r');g.click('start');eq(g.state().survivalWave,1);eq(g.state().shells,[]);eq(g.state().mortarBursts,[]);assert(!mortar(g));
  }
});

test('clear, next boss wave and mode switch cancel all remaining mortar hazards',()=>{
  for(const transition of ['clear','next','home']){
    const g=mortarGame();launchMortar(g);
    if(transition==='clear'){g.run('damageEnemy(enemies[0],99);');tick(g);eq(g.state().phase,'waveClear');}
    if(transition==='next'){g.run('startWave();');eq(g.state().survivalWave,6);eq(g.state().enemies,[]);}
    if(transition==='home'){g.run('openTitle();');eq(g.state().phase,'title');}
    eq(g.state().shells,[]);eq(g.state().mortarBursts,[]);
  }
});

test('last windup tick launches before ordinary shot collisions while earlier kills and immediate skills interrupt',()=>{
  for(const ticks of [.5,1.5]){
    const g=mortarGame();g.run(`enemies.push({...makeEnemy(60,'turret'),shot:100});
      enemies[0].windup=DT*${ticks};enemies[0].aimX=player.x+13.5;enemies[0].aimY=G;
      projectile(795,407,650,0,'p',4);`);
    tick(g);assert(!mortar(g));eq(g.state().phase,'playing');eq(g.state().shells.length,ticks<1?1:0);
    if(ticks<1)eq(g.state().shells[0].elapsed,0);
  }
  const g=mortarGame({loadout:'demolition'});
  g.run("player.x=650;enemies[0].windup=DT/2;enemies.push({...makeEnemy(60,'turret'),shot:100});");
  g.key('e');tick(g);g.key('e',false);assert(!mortar(g));eq(g.state().shells,[]);eq(g.state().phase,'playing');
});


// Aerial counterplay runs through the real update and collision pipeline. The
// fixture isolates geometry, while controls-only routes below retain all foes.
function stompGame(type='walker',options={}){
  const g=createGame(options);g.click('mode-survival');g.click('start');
  g.run(`spawnTime=0;devices=[];pickups=[];stage.platforms=[];tacticalCharge=0;
    enemies=[{...makeEnemy(480,'${type}'),age:0,shot:100}, {...makeEnemy(100,'turret'),shot:100}];
    player.x=485;player.y=enemies[0].y-player.h-4;player.vy=300;player.ground=false;player.inv=0;
    player.dashCooldown=1;`);
  if(type==='drone')g.run('enemies[0].y=240;player.y=240-player.h-4;');
  return g;
}

test('descending aerial stomps hit every ordinary type for 2 and rebound without resources or immunity',()=>{
  for(const type of ['walker','shield','turret','charger','mortar','drone']){
    const g=stompGame(type),before=g.state(),enemy=g.read('({...enemies[0]})');
    tick(g);const after=g.state();eq(after.stomps,1);eq(after.vy,-400);eq(after.ground,false);
    eq(g.read('enemies[0].hp'),enemy.hp-2);eq(after.hp,before.hp);eq(g.read('player.inv'),0);
    eq(after.grenades,before.grenades);eq(after.shots,0);near(after.dashCooldown,1-1/60);
    eq(after.score,type==='drone'?100:0);eq(after.tacticalCharge,type==='drone'?18:6);
    eq(g.read('player.coyote'),0);eq(g.read('player.jumpBuffer'),0);assert(after.stompBurst);
    eq(g.read('enemies[0].stagger'),.3);assert(after.combatText.includes('空中踏击'));
    tick(g,5);eq(g.state().stomps,1);assert(g.state().y<after.y);eq(g.read('enemies[0].hp'),enemy.hp-2);
  }
});

test('stomp uses normal lethal rewards once, bypasses front shield and never grants module refunds',()=>{
  const g=stompGame('shield');g.run('enemies[0].hp=1;upgrades.armor=1;upgrades.blast=1;upgrades.reflect=2;upgrades.pierce=2;');
  tick(g);eq(g.state().score,200);eq(g.state().tacticalCharge,15);eq(g.state().grenades,3);
  assert(g.state().combatText.includes('空中踏击 · 1 连击 · +200'));
  eq(g.read('enemies[0].dead'),true);tick(g,20);eq(g.state().stomps,1);eq(g.state().score,200);
  const active=stompGame();active.run('tacticalTime=1;');tick(active);eq(active.state().tacticalCharge,0);
});

test('rising, lateral, standing and dashing contacts do not become aerial stomps',()=>{
  for(const setup of [
    'player.y=385;player.vy=-300;player.ground=false;',
    'player.x=458;player.y=381;player.vy=0;player.ground=true;held.add("right");',
    'player.y=381;player.vy=0;player.ground=true;',
    'player.dashTime=.18;player.dashDir=1;'
  ]){
    const g=stompGame('turret');g.run(setup);tick(g);eq(g.state().stomps,0);eq(g.read('enemies[0].hp'),4);
    if(!setup.includes('dashTime'))eq(g.state().hp,5);
  }
});

test('stomp remains survival-only and does not affect bosses or invulnerable ingress bodies',()=>{
  for(const kind of ['campaign','practice','challenge']){
    const g=stompGame();g.run(`mode='${kind}';${kind==='challenge'?"challengeId='counter';":''}`);tick(g);
    eq(g.state().stomps,0);eq(g.read('enemies[0].hp'),3);eq(g.state().hp,5);
  }
  for(const setup of ['spawnTime=1;','enemies[0].arrival=.001;','enemies[0].dead=true;']){
    const g=stompGame();g.run(setup);tick(g);eq(g.state().stomps,0);eq(g.state().hp,6);
  }
  const boss=stompGame();boss.run('enemies=[];boss=makeBoss(32,480);boss.shot=100;player.x=485;player.y=boss.y-player.h-4;');
  tick(boss);eq(boss.state().stomps,0);eq(boss.state().bossHp,32);eq(boss.state().hp,5);
});

test('maximum descent cannot tunnel through an enemy top and platforms win earlier crossings',()=>{
  const fast=stompGame('shield');fast.run('player.vy=720;player.y=enemies[0].y-player.h-11;');tick(fast);
  eq(fast.state().stomps,1);eq(fast.state().hp,6);eq(fast.state().vy,-400);
  const blocked=stompGame('shield');blocked.run('stage.platforms=[[470,385,100]];player.vy=720;player.y=380-player.h;');tick(blocked);
  eq(blocked.state().stomps,0);eq(blocked.state().ground,true);eq(blocked.state().y+44,385);eq(blocked.read('enemies[0].hp'),5);
  const drop=stompGame('shield');drop.run('stage.platforms=[[470,385,100]];player.dropPlatform=stage.platforms[0];player.dropTime=.2;player.vy=720;player.y=380-player.h;');tick(drop);
  eq(drop.state().stomps,1);eq(drop.state().ground,false);assert(drop.read('player.dropPlatform')!==null);
});

test('stomp selection is nearest physical top, not enemy array order, and resolves only once',()=>{
  for(const reversed of [false,true]){
    const g=stompGame('turret');g.run(`enemies=[{...makeEnemy(480,'shield'),y:387,stagger:1},
      {...makeEnemy(480,'turret'),y:392,stagger:1}];player.y=380-player.h;player.vy=720;
      ${reversed?'enemies.reverse();':''}`);
    tick(g);eq(g.state().stomps,1);eq(g.read("enemies.find(e=>e.type==='shield').hp"),3);
    eq(g.read("enemies.find(e=>e.type==='turret').hp"),4);eq(g.state().hp,6);
  }
  for(const reversed of [false,true]){
    const g=stompGame('turret');g.run(`enemies=[{...makeEnemy(480,'shield'),y:389,stagger:1},
      {...makeEnemy(490,'turret'),y:389,stagger:1}];${reversed?'enemies.reverse();':''}`);
    tick(g);eq(g.state().stomps,1);eq(g.read("enemies.find(e=>e.type==='shield').hp"),3);
    eq(g.read("enemies.find(e=>e.type==='turret').hp"),4);
  }
});

test('moving charger top crossing wins its body sweep while a late side overlap still hurts',()=>{
  const g=stompGame('charger');g.run("enemies[0].chargerPhase='rush';enemies[0].chargerEnd=264;enemies[0].face=-1;");
  tick(g);eq(g.state().stomps,1);eq(g.state().hp,6);eq(g.state().vy,-400);
  eq(g.read('enemies[0].chargerPhase'),'recover');eq(g.read('enemies[0].stagger'),.3);
  const side=stompGame('charger');side.run("enemies[0].chargerPhase='rush';enemies[0].chargerEnd=264;player.x=446;player.y=388.8-player.h;");
  tick(side);eq(side.state().stomps,0);eq(side.state().hp,5);
});

test('horizontal overlap is evaluated at impact time for moving targets, including exact edges',()=>{
  const g=stompGame('turret');
  const contact=code=>g.read(`(()=>{const e={...makeEnemy(480,'turret'),x:472,y:389};
    return stompContact(${code},[{enemy:e,x:480,y:389}])?.t??null;})()`);
  // Endpoint-only overlap would turn this late side collision into a stomp.
  eq(contact('{x:446,endX:450,bottom:388.8,dy:6,limit:1}'),null);
  assert(contact('{x:475,endX:479,bottom:385,dy:6,limit:1}')!==null);
  // At t=.5 enemy left is476 and player right is exactly476: touching is not overlap.
  eq(contact('{x:449,endX:449,bottom:386,dy:6,limit:1}'),null);
});

test('stagger cancels turret bursts, mortar windups and rushes, but launched ammunition persists',()=>{
  for(const type of ['turret','mortar','charger']){
    const g=stompGame(type);g.run("enemies[0].windup=.6;enemies[0].burst=2;enemies[0].burstTimer=1;enemies[0].chargerPhase='rush';enemies[0].chargerEnd=700;");
    tick(g);eq(g.state().stomps,1);eq(g.read('enemies[0].windup'),0);eq(g.read('enemies[0].burst'),0);
    const x=g.read('enemies[0].x'),y=g.read('enemies[0].y');tick(g,15);
    eq(g.read('enemies[0].x'),x);eq(g.read('enemies[0].y'),y);eq(g.state().hostiles,[]);eq(g.state().shells,[]);
  }
  const launched=stompGame('mortar');launched.run(`shells=[{x:100,y:100,startX:100,startY:100,aimX:100,aimY:425,elapsed:0}];
    projectile(50,50,10,0,'e');`);tick(launched);
  eq(launched.state().stomps,1);eq(launched.state().shells.length,1);eq(launched.state().hostiles.length,1);
  assert(launched.state().shells[0].elapsed>0);
  const finalTick=stompGame('mortar');finalTick.run('enemies[0].windup=DT/2;enemies[0].aimX=100;enemies[0].aimY=425;');tick(finalTick);
  eq(finalTick.state().stomps,1);eq(finalTick.state().shells.length,1);eq(finalTick.state().shells[0].elapsed,0);
});

test('stunned side contact remains dangerous and rebound grants no protection from projectiles',()=>{
  const side=stompGame('shield');side.run('enemies[0].stagger=.3;player.y=381;player.vy=0;player.ground=true;');
  tick(side);eq(side.state().stomps,0);eq(side.state().hp,5);
  const shot=stompGame();shot.run("projectile(492,360,0,0,'e');");tick(shot);
  eq(shot.state().stomps,1);eq(shot.state().hp,5);eq(shot.state().reflections,0);
});

test('lethal projectile or shell trades suppress clear and completed-commission rewards',()=>{
  const g=stompGame();g.run(`enemies.length=1;enemies[0].hp=2;player.hp=1;projectile(492,360,0,0,'e');
    fieldContract={status:'active',nodes:[],beacon:{x:480,y:325,radius:48,progress:5,occupied:false}};`);
  tick(g);eq(g.state().phase,'survivalOver');eq(g.state().stomps,1);eq(g.state().progress.survival,{wave:0,best:0});
  eq(g.state().fieldContract.status,'missed');eq(g.state().stompBurst,null);
  const shell=stompGame();shell.run(`enemies.length=1;enemies[0].hp=2;player.hp=1;
    shells=[{x:492,y:360,startX:492,startY:360,aimX:492,aimY:389,elapsed:MORTAR.flight-DT/2}];`);
  tick(shell);eq(shell.state().phase,'survivalOver');eq(shell.state().stomps,0);eq(shell.state().progress.survival,{wave:0,best:0});
});

test('stomp effects freeze through pause and canceled confirms, detach snapshots and reset safely',()=>{
  const g=stompGame();tick(g);g.key('p');g.key('p',false);const before=g.state();g.frames(60);eq(g.state(),before);
  for(const id of ['restart','menu-home']){g.click(id);g.frames(30);g.click('cancel-restart');eq(g.state(),before);}
  const copy=g.win.__raidState;copy.stompBurst.time=999;copy.enemies[0].stagger=999;eq(g.state(),before);
  g.run('saveProgress();');assert(!/stomp|stagger/.test(JSON.stringify(g.state().progress)));
  g.click('start');tick(g);g.visibility(true);const hidden=g.state();g.frames(30);eq(g.state(),hidden);
  g.visibility(false);g.click('start');tick(g);g.event('blur');const blur=g.state();g.frames(30);eq(g.state(),blur);
  g.key('r');g.click('start');eq(g.state().stomps,0);eq(g.state().stompBurst,null);assert(g.state().enemies.every(e=>e.stagger===0));
  const next=stompGame();tick(next);next.run('startWave();');eq(next.state().stomps,0);eq(next.state().stompBurst,null);
  const home=stompGame();tick(home);home.run('openTitle();');eq(home.state().stomps,0);eq(home.state().stompBurst,null);
});

test('last-enemy stomp clears once and removes transient effects before the supply menu',()=>{
  const g=stompGame();g.run('enemies.length=1;enemies[0].hp=2;');tick(g);
  eq(g.state().phase,'waveClear');eq(g.state().survivalCleared,1);eq(g.state().stompBurst,null);
  const result=g.state();tick(g,20);eq(g.state(),result);
});


test('all three loadouts can earn a first-wave stomp through ordinary keyboard or controller jumps',()=>{
  for(const loadout of ['assault','counter','demolition'])for(const randomSeed of [1,16437,99991]){
    for(const lag of [0,5])for(const input of ['keyboard','controller']){
      const g=createGame({randomSeed});g.click('mode-survival');g.click('loadout-'+loadout);g.click('start');
      g.key('a');until(g,()=>g.state().x<=400,100);g.frames(lag);g.key('a',false);
      until(g,()=>{const s=g.state();return s.spawnTime===0&&Math.min(...s.enemies.map(e=>Math.abs(e.x+e.w/2-s.x-13.5)))<=47;},500);
      g.frames(lag);
      if(input==='controller'){g.pad();g.frames(1);}
      const before=g.state();
      if(input==='controller')g.pad([0]);else g.key('w');
      g.frames(1);if(input==='controller')g.pad();else g.key('w',false);
      until(g,()=>g.state().stomps>0,70);const after=g.state();
      eq(after.stomps,1);eq(after.hp,before.hp);eq(after.enemies.filter(e=>e.hp===1).length,1);
      for(const key of ['score','shots','grenades','tacticalUses','reflections'])eq(after[key],before[key]);
      eq(after.dashTime,0);eq(after.score,0);eq(after.ground,false);eq(after.survivalCleared,0);
      near(after.vy,-400+1250*(.28-after.stompBurst.time));
    }
  }
});


// Airborne aiming adds no new action: down takes priority over the existing
// held-jump upward shot. Fixtures isolate exact contacts; the last contract
// below uses only ordinary input from an untouched first-wave save.
test('airborne down-fire mirrors both directions across modes without changing rifle or scatter cadence',()=>{
  for(const factory of [()=>{const g=createGame();g.start();return g;},()=>operation('sprint'),()=>defense()]){
    for(const face of [-1,1])for(const scatter of [false,true])for(const aim of [-1,0,1]){
      const g=factory();g.run(`player.x=400;player.y=200;player.ground=false;player.face=${face};player.weaponTime=${scatter?12:0};player.shoot=0;bullets=[];`);
      if(aim!==0)g.key('w');if(aim===1)g.key('s');
      const before=g.state();g.run('fire();');const shots=g.read('bullets');
      eq(g.read('fireAim()'),aim);eq(shots.length,scatter?3:1);
      eq(shots.map(b=>b.vx),Array(shots.length).fill(face*(aim?480:650)));
      eq(shots.map(b=>b.vy),(scatter?[-1,0,1]:[0]).map(offset=>aim*340+offset*(aim?88:145)));
      near(g.read('player.shoot'),scatter?.33:.15);eq(g.state().weaponTime,before.weaponTime);
      for(const field of ['hp','grenades','score','tacticalCharge','progress'])eq(g.state()[field],before[field]);
      assert(shots.every(b=>b.damage===1&&!b.reflected));
      g.run('fire();');eq(g.state().shots,before.shots+shots.length,'Held fire cannot bypass cooldown');
    }
  }
});

test('ground crouch stays horizontal, ledge descent fires down immediately, and released down restores aim',()=>{
  const g=onLedge();g.key('s');g.key('j');tick(g);
  eq(g.state().crouch,true);eq(g.read('fireAim()'),0);eq(g.read('bullets.at(-1).vy'),0);
  g.key('w');g.run('player.shoot=0;');tick(g);
  assert(g.state().dropTime>0&&!g.state().ground);eq(g.read('fireAim()'),1);eq(g.read('bullets.at(-1).vy'),340);
  g.key('s',false);eq(g.read('fireAim()'),-1);
  g.key('w',false);eq(g.read('fireAim()'),0);
  g.key('j',false);g.key('s');tick(g,50);eq(g.state().ground,true);eq(g.read('fireAim()'),0);
  g.run('player.shoot=0;fire();');eq(g.read('bullets.at(-1).vy'),0);
});

test('touch and gamepad can aim down during a jump and release aim independently from shooting',()=>{
  const touch=onLedge();const action=name=>[...touch.nodes.values()].find(node=>node.dataset.action===name);
  action('jump').dispatch('pointerdown',{pointerId:31});tick(touch);
  action('jump').dispatch('pointerup',{pointerId:31});
  action('down').dispatch('pointerdown',{pointerId:32});action('fire').dispatch('pointerdown',{pointerId:33});tick(touch);
  eq(touch.read('fireAim()'),1);eq(touch.read('bullets.at(-1).vy'),340);eq(touch.state().touchCount,2);
  action('down').dispatch('pointercancel',{pointerId:32});eq(touch.read('fireAim()'),0);eq(touch.state().touchCount,1);
  touch.run('player.shoot=0;');tick(touch);eq(touch.read('bullets.at(-1).vy'),0);
  action('fire').dispatch('pointerup',{pointerId:33});eq(touch.state().touchCount,0);
  const pad=onLedge();pad.pad();pad.frames(2);pad.pad([0]);pad.frames(1);pad.pad([2,13]);pad.frames(1);
  eq(pad.read('fireAim()'),1);eq(pad.read('bullets.at(-1).vy'),340);
  pad.pad([2]);pad.frames(1);eq(pad.read('fireAim()'),0);
  pad.noPad();pad.frames(1);eq(pad.read('fireAim()'),0);
});

test('airborne down-fire clears on pause, canceled restart, blur and hidden-document interruption',()=>{
  for(const interrupt of ['pause','blur','hidden']){
    const g=onLedge();g.key('w');tick(g);g.key('w',false);g.key('s');g.key('j');tick(g);
    eq(g.read('fireAim()'),1);
    if(interrupt==='pause'){g.key('p');g.key('p',false);}else if(interrupt==='blur')g.event('blur');else g.visibility(true);
    eq(g.state().phase,'pause');eq(g.read('fireAim()'),0);const paused=g.state();g.frames(20);eq(g.state(),paused);
    g.click('restart');g.frames(10);g.click('cancel-restart');eq(g.state(),paused);
    if(interrupt==='hidden')g.visibility(false);g.click('start');g.frames(2);
    eq(g.read('fireAim()'),0);eq(g.state().shots,paused.shots);
  }
});

function diveCollision({shield=false,face=1,skill=false,arrival=0}={}){
  const g=defense();g.run(`spawnTime=0;devices=[];pickups=[];tacticalCharge=0;tacticalTime=${skill?6:0};
    stage={...stage,platforms:[]};player.x=400;player.y=250;player.ground=false;player.vy=0;player.face=${face};player.inv=100;
    upgrades.pierce=1;enemies=[{...makeEnemy(${face===1?480:292},'${shield?'shield':'turret'}'),y:302,stagger:10,face:${-face},arrival:${arrival}},
      {...makeEnemy(${face===1?550:222},'turret'),y:351,stagger:10}];enemies.reverse();`);
  g.key('s');g.run('fire();');g.key('s',false);return g;
}

test('descending bullets retain distance-ordered piercing, single-hit budgets and frontal shield blocking',()=>{
  for(const face of [-1,1])for(const shield of [false,true]){
    const g=diveCollision({face,shield});const initial=g.read('enemies.map(e=>e.hp)');tick(g,20);
    const after=g.read('enemies.map(e=>e.hp)');
    eq(after,shield?initial:initial.map(hp=>hp-1));
    eq(g.state().tacticalCharge,shield?0:6);eq(g.state().score,0);eq(g.state().reflections,0);
    tick(g,5);eq(g.read('enemies.map(e=>e.hp)'),after,'Piercing may not hit a target twice');
  }
});

test('down-fire respects arrival protection and late overclock projectile charging isolation',()=>{
  const protectedTarget=diveCollision({arrival:1});const hp=protectedTarget.read('enemies[1].hp');tick(protectedTarget,20);
  eq(protectedTarget.read('enemies[1].hp'),hp);eq(protectedTarget.state().tacticalCharge,3);
  const active=diveCollision({skill:true});eq(active.read('bullets[0].tactical'),true);
  active.run('tacticalTime=0;');tick(active,20);eq(active.read('enemies.map(e=>e.hp)'),[3,3]);eq(active.state().tacticalCharge,0);
});

test('three loadouts hit a first-wave enemy with pure airborne down-fire through genuine delayed input',()=>{
  for(const loadout of ['assault','counter','demolition'])for(const randomSeed of [1,16437,99991])for(const lag of [0,1,2,3,4,5,6,7,8]){
    const g=defense({loadout,randomSeed});g.key('s');g.key('a');
    until(g,()=>g.state().x<=405,100);g.frames(lag);g.key('a',false);g.key('s',false);
    assert(g.state().x>=388&&g.state().x<=405);eq(g.state().face,-1);
    until(g,()=>{const s=g.state(),target=s.enemies.filter(e=>e.x<s.x).sort((a,b)=>b.x-a.x)[0];
      const gap=target?s.x+13.5-target.x-target.w/2:Infinity;
      return s.spawnTime===0&&s.ground&&gap>=120&&gap<=155;},250);
    const before=g.state(),hp=before.enemies.reduce((sum,e)=>sum+e.hp,0);
    // Like the browser's RAF observer, capture the first damage even while an
    // input tool is delayed. This observes snapshots without editing the game.
    let firstDamage=null;const frames=g.frames.bind(g);
    g.frames=(count=1)=>{for(let frame=0;frame<count;frame++){
      frames();const state=g.state();
      if(!firstDamage&&state.enemies.reduce((sum,e)=>sum+e.hp,0)<hp)firstDamage=state;
    }};
    g.key('w');until(g,()=>g.state().y<=300,30);g.frames(lag);assert(!g.state().ground);
    g.key('s');g.frames(lag);g.key('j');until(g,()=>g.state().shots>0,5);g.frames(lag);g.key('w',false);
    const bullets=g.read("bullets.filter(b=>b.owner==='p')");assert(bullets.length>0&&bullets.every(b=>b.vx===-480&&b.vy===340));
    until(g,()=>g.state().enemies.reduce((sum,e)=>sum+e.hp,0)<hp,40);
    g.key('j',false);g.key('s',false);const hit=firstDamage;assert(hit);
    eq(hit.ground,false);eq(hit.stomps,0);eq(hit.enemies.length,before.enemies.length);eq(hit.hp,before.hp);eq(hit.devices,before.devices);
    eq(hit.tacticalUses,0);eq(hit.grenades,before.grenades);eq(hit.reflections,0);eq(hit.score,0);
    assert(hit.shots>0);eq(hit.progress,before.progress);
  }
});

// Physical-key ownership: aliases may overlap during a direction or aim handoff.
test('releasing one keyboard alias keeps its still-held action in both release orders',()=>{
  const aliases=[['a','ArrowLeft','left'],['d','ArrowRight','right'],['s','ArrowDown','down'],
    ['w',' ','jump'],['ArrowUp','w','jump'],['j','z','fire'],['k','x','grenade'],['Shift','l','dash']];
  for(const [first,second,name] of aliases)for(const reverse of [false,true]){
    const g=defense();g.key(first);g.key(second);eq(g.read(`pressed('${name}')`),true);
    g.key(reverse?second:first,false);
    eq(g.read(`pressed('${name}')`),true,`${name} stopped while another alias was held`);
    g.key(reverse?first:second,false);eq(g.read(`pressed('${name}')`),false);
  }
});

test('physical codes survive changed key values, opposite shifts and modified releases',()=>{
  const g=defense();g.key('a',true,false,{code:'KeyA'});
  g.key('q',true,true,{code:'KeyA'}); // A layout/repeat change cannot replace ownership.
  g.key('Q',false,false,{code:'KeyA',ctrlKey:true});eq(g.read('held.size'),0);
  g.key('Shift',true,false,{code:'ShiftLeft'});g.key('Shift',true,false,{code:'ShiftRight'});
  g.key('Shift',false,false,{code:'ShiftLeft'});eq(g.read('pressed("dash")'),true);
  g.key('Shift',false,false,{code:'ShiftRight'});eq(g.read('held.size'),0);
  for(const modifier of ['ctrlKey','metaKey','altKey']){
    g.key('j',true,false,{code:'KeyJ',[modifier]:true});eq(g.read('pressed("fire")'),false);
    g.key('j',false,false,{code:'KeyJ'});
  }
});

test('alias handoff does not repeat grenades, jumps, dashes or tactical edges',()=>{
  for(const [first,second,action] of [['k','x','grenadeQueued'],['w','ArrowUp','jumpQueued'],['Shift','l','dashQueued']]){
    const g=defense();g.key(first);eq(g.read(action),true);g.run(`${action}=false;`);
    g.key(second);g.key(first,false);g.key(second,true,true);eq(g.read(action),false);
    g.key(second,false);g.key(first);eq(g.read(action),true);
  }
  const g=defense();g.run('spawnTime=0;');g.key('e');eq(g.read('tacticalQueued'),true);
  g.run('tacticalQueued=false;');g.key('E',true,true);eq(g.read('tacticalQueued'),false);
});

test('interrupted held keys cannot re-arm from OS repeats after resume or a canceled restart',()=>{
  for(const interrupt of ['pause','blur','hidden','restart']){
    const g=defense();g.key('s');g.key('ArrowDown');g.key('j');g.key('z');g.key('k');
    if(interrupt==='pause'){g.key('p');g.key('p',false);}
    else if(interrupt==='blur')g.event('blur');
    else if(interrupt==='hidden')g.visibility(true);
    else g.click('restart');
    eq(g.read('held.size'),0);eq(g.read('keyboardKeys.size'),0);
    if(interrupt==='restart')g.click('cancel-restart');
    else {if(interrupt==='hidden')g.visibility(false);g.click('start');}
    for(const key of ['s','ArrowDown','j','z','k'])g.key(key,true,true);
    eq(g.read('held.size'),0);eq(g.read('keyboardKeys.size'),0);
    eq(g.read('grenadeQueued'),false);eq(g.read('pressed("fire")'),false);
    for(const key of ['s','ArrowDown','j','z','k'])g.key(key,false);
    g.key('j');eq(g.read('pressed("fire")'),true);g.key('j',false);
  }
});

test('keyboard aliases remain independent from native touch and controller holds',()=>{
  const g=defense(),button=[...g.nodes.values()].find(n=>n.dataset.action==='fire');
  button.dispatch('pointerdown',{pointerId:201});g.key('j');g.key('z');g.key('j',false);
  button.dispatch('pointerup',{pointerId:201});eq(g.read('pressed("fire")'),true);
  g.key('z',false);eq(g.read('pressed("fire")'),false);
  g.pad();g.frames(2);g.pad([2]);g.frames();g.key('j');g.key('z');g.key('j',false);
  g.noPad();g.frames();eq(g.read('pressed("fire")'),true);
  g.key('z',false);eq(g.read('pressed("fire")'),false);
  button.dispatch('pointerdown',{pointerId:202});button.dispatch('pointerdown',{pointerId:203});
  button.dispatch('pointercancel',{pointerId:202});eq(g.state().touchCount,1);
  eq(button.classList.contains('active'),true);eq(g.read('pressed("fire")'),true);
  button.dispatch('lostpointercapture',{pointerId:203});eq(g.state().touchCount,0);
  eq(button.classList.contains('active'),false);eq(g.read('pressed("fire")'),false);
});

test('three jump aliases and unidentified codes retain ownership until the final release',()=>{
  const g=defense();g.run('player.ground=false;');
  for(const key of ['w','ArrowUp',' '])g.key(key,true,false,{code:'Unidentified'});
  for(const key of ['ArrowUp','w']){g.key(key,false,false,{code:'Unidentified'});eq(g.state().fireAim,-1);}
  g.key(' ',false,false,{code:'Unidentified'});eq(g.state().fireAim,0);
  g.key(' ',true,false,{code:'Unidentified'});eq(g.state().fireAim,-1);
});

test('confirmed restart and home-mode changes clear old key ownership but allow fresh presses',()=>{
  for(const home of [false,true]){
    const g=defense();g.key('j');g.key('z');g.key('d');g.key('k');
    g.click(home?'menu-home':'restart');g.click('start');
    if(home){g.click('mode-campaign');g.click('start');}
    eq(g.state().phase,'playing');eq(g.read('keyboardKeys.size'),0);eq(g.read('held.size'),0);
    const before=g.state();for(const key of ['j','z','d','k'])g.key(key,true,true);tick(g,20);
    eq(g.state().shots,before.shots);eq(g.state().grenades,before.grenades);eq(g.state().x,before.x);
    for(const key of ['j','z','d','k'])g.key(key,false);
    g.key('j');tick(g,2);assert(g.state().shots>before.shots);g.key('j',false);
  }
});

test('every rifle pose points along its existing shot and ends at the actual muzzle',()=>{
  for(const face of [-1,1])for(const crouch of [false,true])for(const aim of [-1,0,1]){
    const g=defense();g.run(`player.face=${face};player.crouch=${crouch};player.h=${crouch?28:44};
      player.ground=false;player.shoot=0;player.weaponTime=0;bullets=[];`);
    if(aim===1)g.key('s');if(aim===-1)g.key('w');g.run('fire();');
    const b=g.read('bullets[0]'),transforms=[],rotations=[],rects=[];
    g.graphics.translate=(x,y)=>transforms.push([x,y]);g.graphics.rotate=a=>rotations.push(a);
    g.graphics.fillRect=(...args)=>rects.push(args);
    g.run(`drawRifle(${crouch?14:20});`);
    eq(transforms.length,1);eq(rotations.length,1);
    near(g.state().x+27/2+face*transforms[0][0],b.x);near(g.state().y+transforms[0][1],b.y);
    near(rotations[0],Math.atan2(b.vy,Math.abs(b.vx)));
    assert(rects.some(([x,y,w,h])=>x+w===0&&y<0&&y+h>0),'Gun barrel must end at the shot origin');
  }
});

test('dash pre-input waits for the full cooldown, then consumes exactly one edge',()=>{
  for(const setup of ["beginRun(0,'campaign')","beginRun(1,'practice')","beginChallenge('counter')","beginSurvival()"]){
    const g=createGame();g.run(`${setup};player.inv=100;player.dashCooldown=.1;player.face=1;`);
    const before=g.state();g.key('l');tick(g);g.key('l',false);
    eq(g.state().dashTime,0);assert(g.state().dashBuffer>0);near(g.state().x,before.x);
    while(g.state().dashCooldown>1/60+1e-7){tick(g);eq(g.state().dashTime,0);}
    // Allow one extra fixed step for floating-point cooldown residue.
    tickUntil(g,'player.dashTime>0',2);
    eq(g.state().dashBuffer,0);near(g.state().dashCooldown,g.read('dashDelay()'));
    eq(g.state().grenades,before.grenades);eq(g.state().score,before.score);eq(g.state().tacticalCharge,before.tacticalCharge);
    tick(g,160);eq(g.state().dashTime,0);eq(g.state().dashCooldown,0);
  }
});

test('dash buffering expires, and held keys/repeats/aliases never refresh it',()=>{
  const g=createGame();g.start();g.run('player.dashCooldown=.3;');
  g.key('Shift');tick(g);assert(g.state().dashBuffer>0);
  for(let i=0;i<25;i++){g.key('Shift',true,true);if(i===9)g.key('l');tick(g);eq(g.state().dashTime,0);}
  eq(g.state().dashCooldown,0);eq(g.state().dashBuffer,0);
  g.key('Shift',false);eq(g.read('pressed("dash")'),true);tick(g);eq(g.state().dashTime,0);
  g.key('l',false);g.key('l');tick(g);assert(g.state().dashTime>0);g.key('l',false);
});

test('dash buffer uses the execution-facing direction and never stacks charges',()=>{
  const g=createGame();g.start();g.run('player.x=500;player.face=1;player.dashCooldown=.1;');
  g.key('l');tick(g);g.key('l',false);g.key('a');
  tickUntil(g,'player.dashTime>0',8);eq(g.read('player.dashDir'),-1);assert(g.state().x<500);
  g.key('a',false);const used=g.state().dashCooldown;
  g.key('l');tick(g);g.key('l',false);tick(g,160);
  assert(used>0);eq(g.state().dashTime,0);eq(g.state().dashBuffer,0);eq(g.state().dashCooldown,0);
});

test('touch and controller dash pre-input share the same once-only window',()=>{
  for(const input of ['touch','pad']){
    const g=createGame();g.start();if(input==='pad'){g.pad();g.frames(2);}
    g.run('player.dashCooldown=.1;');
    if(input==='touch')g.nodes.get('dash-control').dispatch('pointerdown',{pointerId:501});
    else g.pad([4]);
    g.frames(2);assert(g.state().dashBuffer>0);eq(g.state().dashTime,0);
    until(g,()=>g.state().dashTime>0,10);eq(g.state().dashBuffer,0);
    g.frames(170);eq(g.state().dashTime,0);eq(g.state().dashCooldown,0);
    if(input==='touch')g.nodes.get('dash-control').dispatch('pointerup',{pointerId:501});else g.pad();
    g.frames(2);eq(g.state().touchCount,0);
  }
});

test('pause, confirmation, focus loss and background cancel waiting dash input',()=>{
  for(const interrupt of ['pause','restart','home','blur','hidden']){
    const g=createGame();g.start();g.run('player.dashCooldown=.1;');g.key('l');tick(g);assert(g.state().dashBuffer>0);
    if(interrupt==='pause')g.key('p');
    else if(interrupt==='restart')g.click('restart');
    else if(interrupt==='home')g.click('menu-home');
    else if(interrupt==='blur')g.event('blur');
    else g.visibility(true);
    eq(g.state().dashBuffer,0);const stopped=g.state();g.frames(30);eq(g.state(),stopped);
    if(interrupt==='hidden')g.visibility(false);
    if(['restart','home'].includes(interrupt))g.click('cancel-restart');else g.click('start');
    g.key('l',true,true);tick(g,12);eq(g.state().dashTime,0);eq(g.state().dashBuffer,0);
    near(g.state().x,stopped.x);g.key('l',false);g.key('l');tick(g);assert(g.state().dashTime>0);
  }
});

test('death, nonfatal fall, new wave, restart and stage reset cannot inherit a waiting dash',()=>{
  for(const reset of ['death','fall','wave','restart','stage']){
    const g=reset==='wave'?defense():createGame();if(reset!=='wave')g.start();
    g.run('player.dashCooldown=.1;');g.key('l');tick(g);assert(g.state().dashBuffer>0);
    if(reset==='death')g.run('player.hp=1;player.inv=0;hurt();');
    if(reset==='fall'){g.run('player.y=H+80;player.inv=0;');tick(g);eq(g.state().stageDeaths,0);eq(g.state().hp,g.state().maxHp-2);}
    if(reset==='wave')g.run('startWave();');
    if(reset==='restart'){g.click('restart');g.click('start');}
    if(reset==='stage')g.run('resetStage(1,null);');
    eq(g.state().dashBuffer,0);g.key('l',true,true);tick(g,12);eq(g.state().dashTime,0);
  }
});

test('dash recovery meter and ready label use the actual loadout and upgraded cooldown',()=>{
  for(const loadout of ['assault','counter','demolition'])for(const level of [0,1,2]){
    const g=defense({loadout});g.run(`upgrades.dash=${level};dash();`);
    const button=g.nodes.get('dash-control'),meter=g.nodes.get('dash-meter'),status=g.nodes.get('dash-status');
    eq(button.getAttribute('data-ready'),'false');eq(meter.style.width,'0%');eq(button.disabled,false);
    near(g.state().dashCooldown,g.read('dashDelay()'));
    g.run('player.dashCooldown=dashDelay()/2;hud();');eq(meter.style.width,'50%');
    for(const remaining of [.1,.049,.001]){
      g.run(`player.dashCooldown=${remaining};hud();`);eq(status.textContent,'0.1s');
      eq(button.getAttribute('data-ready'),'false');assert(button.getAttribute('aria-label').includes('冷却 0.1s'));
    }
    g.run('player.dashCooldown=0;hud();');eq(status.textContent,'就绪');eq(meter.style.width,'100%');
    eq(button.getAttribute('data-ready'),'true');assert(button.getAttribute('aria-label').includes('已就绪'));
  }
});

// Arrange collision boundaries only: every attribution below is resolved by
// production update(), not by directly calling hurt or a result-menu helper.
const recapSources={
  bullet:['敌方子弹','冲刺接触敌弹可反弹'],contact:['敌人接触','拉开距离再开火'],
  charger:['冲锋兵接触','趁回气时反击'],mortar:['投弹爆炸','爆炸不能反弹'],
  lowBeam:['低位激光','跳跃或冲刺避开'],highBeam:['高位激光','下蹲或冲刺避开'],
  boss:['首领接触','与首领保持距离'],fall:['坠落深坑','从坑前起跳'],
};
function recapGame({mode='survival',difficulty='standard',loadout='assault',blocked=false,reducedMotion=false}={}){
  const g=createGame({blocked,reducedMotion});
  if(mode==='survival'){g.click('mode-survival');g.click('loadout-'+loadout);g.click('start');}
  else if(mode==='challenge')g.run("beginChallenge('sprint');");
  else{g.click('difficulty-'+difficulty);g.run(`beginRun(0,${JSON.stringify(mode)});`);}
  g.run(`clearInput();spawnTime=0;devices=[];pickups=[];bullets=[];bombs=[];shells=[];fieldContract=null;
    stage.platforms=[];stage.gaps=[];enemies=[{...makeEnemy(70,'turret'),shot:100}];
    boss.dead=true;boss.windup=0;boss.beamTime=0;boss.shot=100;
    player.x=465;player.y=G-44;player.h=44;player.vx=0;player.vy=0;player.ground=true;
    player.inv=0;player.dashTime=0;player.dashBuffer=0;player.hp=maxHealth();player.lives=1;
    combo.count=3;combo.timer=5;combatText='';combatTime=0;`);
  return g;
}
function arrangeRecapHit(g,source){
  if(source==='bullet')g.run("projectile(player.x+player.w/2,player.y+20,0,0,'e');");
  else if(source==='contact')g.run("enemies.push({...makeEnemy(player.x+6,'walker'),shot:100,age:0});");
  else if(source==='charger')g.run("enemies.push({...makeEnemy(player.x+6,'charger'),shot:100,chargerPhase:'rush',chargerEnd:player.x+170});");
  else if(source==='mortar')g.run(`shells.push({x:player.x,y:player.y,startX:70,startY:100,
    aimX:player.x+player.w/2,aimY:G,elapsed:MORTAR.flight-DT/2});`);
  else if(source==='lowBeam'||source==='highBeam')g.run(`boss.dead=false;boss.x=700;boss.beamTime=.5;boss.beamY=G-${source==='lowBeam'?12:36};`);
  else if(source==='boss')g.run('boss.dead=false;boss.x=player.x+8;boss.y=G-boss.h;');
  else if(source==='fall')g.run('player.y=H+80;player.ground=false;');
  else throw new Error('Unknown recap fixture '+source);
}
function assertRecap(g,source,phase){
  const [name,tip]=recapSources[source],sub=g.nodes.get('overlay-text').textContent;
  eq(g.state().phase,phase);assert(sub.startsWith('致命来源：'+name+'。'),sub);assert(sub.includes(tip),sub);
  eq(g.nodes.get('announcer').textContent,g.nodes.get('overlay-title').textContent+'。'+sub);
  eq(g.nodes.get('overlay').hidden,false);eq(g.document.activeElement,g.nodes.get('start'));
}

test('all eight actual damage paths report the source and preserve damage, combo and invulnerability rules',()=>{
  for(const source of Object.keys(recapSources))for(const reducedMotion of [false,true]){
    const g=recapGame({reducedMotion}),hp=g.state().hp;arrangeRecapHit(g,source);tick(g);
    eq(g.state().phase,'playing',source);eq(g.state().hp,hp-(source==='fall'?2:1),source);
    eq(g.state().stageDeaths,0);eq(g.state().combo,0);eq(g.state().comboTime,0);
    eq(g.state().combatText,recapSources[source][0]+' · 连击中断');
    eq(g.nodes.get('announcer').textContent,g.state().combatText);near(g.read('player.inv'),1.45);
    assert(!g.nodes.get('announcer').textContent.includes('致命来源'));
  }
});

test('all eight lethal paths supply their own counterplay to the existing failure menu and live region',()=>{
  for(const source of Object.keys(recapSources))for(const loadout of ['assault','counter','demolition']){
    const g=recapGame({loadout});g.run('player.hp=1;');arrangeRecapHit(g,source);tick(g);
    assertRecap(g,source,'survivalOver');eq(g.state().hp,0);eq(g.state().lives,0);eq(g.state().stageDeaths,1);
    eq(g.state().progress.survival,{wave:0,best:0});assert(g.nodes.get('result-details').textContent.includes('本波未计入纪录'));
    const state=g.state(),sub=g.nodes.get('overlay-text').textContent;tick(g,10);g.frames(10);
    eq(g.state(),state);eq(g.nodes.get('overlay-text').textContent,sub);
  }
});

test('campaign, practice and challenges retain their difficulty and result behavior with source recaps',()=>{
  for(const mode of ['campaign','practice','challenge'])for(const difficulty of ['standard','relaxed']){
    for(const source of ['bullet','contact','lowBeam','highBeam','boss','fall'])for(const lethal of [false,true]){
      const g=recapGame({mode,difficulty});if(lethal)g.run('player.hp=1;');
      const hp=g.state().hp;arrangeRecapHit(g,source);tick(g);
      if(lethal){
        assertRecap(g,source,mode==='challenge'?'challengeFailed':'gameOver');
        if(mode==='challenge')assert(g.nodes.get('result-details').textContent.includes('不计入挑战纪录'));
      }else{
        eq(g.state().phase,'playing');eq(g.state().hp,hp-(source==='fall'?2:1));
        eq(g.state().combatText,recapSources[source][0]+' · 连击中断');
        near(g.read('player.inv'),mode!=='challenge'&&difficulty==='relaxed'?1.9:1.45);
      }
      eq(g.state().difficulty,mode==='challenge'?'standard':difficulty);
    }
  }
});

test('invulnerability, dash and phase shield never turn blocked collisions into damage or fatal recaps',()=>{
  for(const source of Object.keys(recapSources).filter(source=>source!=='fall'))for(const protection of ['inv','dash','shield']){
    const g=recapGame({loadout:'counter'});g.run("player.hp=1;combatNotice('保留提示');");
    if(protection==='inv')g.run('player.inv=1;');
    else if(protection==='dash')g.run('player.dashTime=.18;player.dashDir=1;');
    else g.run('tacticalTime=1;');
    arrangeRecapHit(g,source);tick(g);eq(g.state().hp,1);eq(g.state().phase,'playing');eq(g.state().combo,3);
    eq(g.state().stageDeaths,0);assert(!g.state().combatText.includes('连击中断'));
    assert(!g.nodes.get('announcer').textContent.includes('致命来源'));
    if(source==='bullet'&&protection!=='inv'){eq(g.state().reflections,1);assert(g.state().combatText.includes('反弹'));}
    else eq(g.state().combatText,'保留提示');
  }
  // Falling deliberately cancels invulnerability/dash in existing gameplay;
  // attribution must not accidentally turn it into an ordinary blocked hit.
  for(const protection of ['inv','dash','shield']){
    const g=recapGame({loadout:'counter'});g.run("combatNotice('保留提示');player.inv=1;player.dashTime=.18;player.dashDir=1;");
    if(protection==='shield')g.run('tacticalTime=1;');
    const hp=g.state().hp;arrangeRecapHit(g,'fall');tick(g);
    eq(g.state().hp,hp-(protection==='shield'?0:2));
    eq(g.state().combatText,protection==='shield'?'保留提示':'坠落深坑 · 连击中断');
    eq(g.state().x,g.state().checkpoint);eq(g.state().dashTime,0);
  }
});

test('losing a nonfinal life keeps checkpoint recovery separate from a later final source',()=>{
  for(const mode of ['campaign','practice']){
    const g=recapGame({mode});g.run('player.hp=1;player.lives=2;player.checkpoint=100;');
    arrangeRecapHit(g,'bullet');tick(g);eq(g.state().phase,'playing');eq(g.state().lives,1);
    eq(g.state().x,100);eq(g.state().hp,g.state().maxHp);near(g.read('player.inv'),2.2);
    eq(g.nodes.get('announcer').textContent,'失去一条生命，从检查点继续。');
    g.run('player.inv=0;player.hp=1;');arrangeRecapHit(g,'fall');tick(g);assertRecap(g,'fall','gameOver');
    assert(!g.nodes.get('overlay-text').textContent.includes('敌方子弹'));
  }
});

test('timeout and insufficient-reflection exits never promote previous damage to a lethal recap',()=>{
  for(const key of ['sprint','counter']){
    const g=recapGame({mode:'challenge'});
    if(key==='counter')g.run("challengeId='counter';");
    arrangeRecapHit(g,'bullet');tick(g);assert(g.state().hp>0);eq(g.state().stageDeaths,0);
    if(key==='sprint')g.run('challengeTime=90-DT/2;');
    else g.run('boss.dead=true;player.x=stage.width-90;challengeReflections=4;');
    tick(g);eq(g.state().phase,'challengeFailed');
    const sub=g.nodes.get('overlay-text').textContent;assert(sub.includes(key==='sprint'?'90 秒已到':'反弹不足 5 枚'),sub);
    assert(!sub.includes('致命来源'));assert(!sub.includes('敌方子弹'));eq(g.state().stageDeaths,0);
    assert(!g.nodes.get('announcer').textContent.includes('致命来源'));
    eq(g.state().progress.challenges[key].clears,0);
  }
});

test('retry, home, new wave and stage transitions do not carry old combat or fatal messages',()=>{
  for(const mode of ['campaign','practice','challenge','survival'])for(const next of ['retry','home']){
    const g=recapGame({mode});g.run('player.hp=1;');arrangeRecapHit(g,'bullet');tick(g);
    assert(g.nodes.get('overlay-text').textContent.includes('致命来源'));
    g.click(next==='retry'?'start':'menu-home');eq(g.state().combatText,'');eq(g.state().stageDeaths,0);
    eq(g.state().phase,next==='retry'?'playing':'title');
    assert(!g.nodes.get('announcer').textContent.includes('致命来源'));
    if(next==='retry'){g.key('p');assert(!g.nodes.get('overlay-text').textContent.includes('致命来源'));}
    else assert(!g.nodes.get('overlay-text').textContent.includes('致命来源'));
  }
  for(const transition of ['wave','stage','mode']){
    const g=recapGame();arrangeRecapHit(g,'bullet');tick(g);
    if(transition==='wave')g.run('startWave();');
    else if(transition==='stage')g.run('resetStage(1,null);');
    else g.run("beginRun(0,'campaign');");
    eq(g.state().combatText,'');g.key('p');assert(!g.nodes.get('overlay-text').textContent.includes('敌方子弹'));
  }
});

test('first lethal collision wins same-tick competing sources without changing damage resolution order',()=>{
  for(const [first,later] of [['fall','mortar'],['mortar','contact'],['contact','lowBeam'],['lowBeam','bullet'],['boss','bullet']]){
    const g=recapGame();g.run('player.hp=1;');arrangeRecapHit(g,later);arrangeRecapHit(g,first);tick(g);
    assertRecap(g,first,'survivalOver');eq(g.state().stageDeaths,1);
    assert(!g.nodes.get('overlay-text').textContent.includes('致命来源：'+recapSources[later][0]));
  }
});

test('lethal projectile and mortar recaps cannot settle same-tick clear or completed commission rewards',()=>{
  for(const source of ['bullet','mortar'])for(const order of [false,true]){
    const g=recapGame();g.run(`enemies=[{...makeEnemy(100,'turret'),hp:1,shot:100}];player.hp=1;
      fieldContract={status:'active',nodes:[],beacon:{x:465,y:G,radius:48,progress:5,occupied:true}};
      projectile(110,G-18,0,0,'p',99);`);
    arrangeRecapHit(g,source);if(order)g.run('bullets.reverse();');
    const before=g.state().progress;tick(g);assertRecap(g,source,'survivalOver');
    eq(g.state().progress,before);eq(g.state().survivalCleared,0);eq(g.state().fieldContract.status,'missed');
    eq(g.state().shells,[]);eq(g.state().mortarBursts,[]);
    const score=g.state().score;tick(g,30);eq(g.state().score,score);
  }
});

test('damage-source feedback adds no saved fields and works when storage is unavailable',()=>{
  for(const blocked of [false,true])for(const source of Object.keys(recapSources)){
    const g=recapGame({blocked}),before=g.state().progress;g.run('player.hp=1;');arrangeRecapHit(g,source);tick(g);
    assertRecap(g,source,'survivalOver');g.run('saveProgress();');eq(g.state().progress,before);
    assert(!/lastHit|hitSource|fatal|recap|致命|敌方子弹|投弹爆炸/.test(JSON.stringify(g.state().progress)));
    if(!blocked)eq(JSON.parse(g.values.get(STORE)),before);
    else eq(g.state().storageAvailable,false);
  }
});

// Pickups are reserved in the current scene, never in persisted progress.
function pickupGame(kind,options={}){
  const g=recapGame(options);
  g.run(`pickups=[{x:player.x+player.w/2,y:G-22,kind:${JSON.stringify(kind)},done:false,age:0}];
    player.grenades=7;player.inv=100;combo={count:0,timer:0,best:0};`);
  return g;
}
const pickupModes=[
  ...['standard','relaxed'].flatMap(difficulty=>['campaign','practice'].map(mode=>({mode,difficulty}))),
  {mode:'challenge'},...['assault','counter','demolition'].map(loadout=>({loadout})),
];
test('full finite pickups reserve across modes, difficulties and armor without scoring or changing saves',()=>{
  for(const options of pickupModes)for(const kind of ['heal','grenade'])for(const armor of [0,2]){
    const g=pickupGame(kind,options);g.run(`upgrades.armor=${armor};player.hp=maxHealth();`);
    const before=g.state(),saved=g.state().progress;tick(g,130);
    eq(g.state().pickups[0].done,false);eq(g.state().hp,before.hp);eq(g.state().grenades,7);eq(g.state().score,0);
    eq(g.state().progress,saved);eq(g.state().combatText,'');assert(g.read('pickups[0].reserveHinted'));
    g.run('player.x+=160;');tick(g);g.run('player.x-=160;');tick(g);
    eq(g.state().pickups[0].done,false);eq(g.state().score,0);eq(g.state().combatText,'','Reentering must not repeat reservation feedback');
  }
});
test('finite pickups restore only missing resources with one original 75 point reward',()=>{
  for(const options of pickupModes)for(const kind of ['heal','grenade'])for(const missing of [1,2,3]){
    const g=pickupGame(kind,options);
    g.run(kind==='heal'?`player.hp=maxHealth()-${missing};`:`player.grenades=7-${missing};`);tick(g);
    eq(g.state().pickups[0].done,true);eq(g.state().score,75);
    eq(kind==='heal'?g.state().maxHp-g.state().hp:7-g.state().grenades,Math.max(0,missing-2));
    tick(g,20);eq(g.state().score,75);
  }
});
test('reserved pickup feedback waits for existing combat feedback and announces only once',()=>{
  for(const kind of ['heal','grenade']){
    const g=pickupGame(kind);g.run("combatNotice('敌方子弹 · 连击中断');");tick(g,30);
    eq(g.state().combatText,'敌方子弹 · 连击中断');eq(g.nodes.get('announcer').textContent,'敌方子弹 · 连击中断');
    assert(!g.read('pickups[0].reserveHinted'));tick(g,80);assert(g.state().combatText.includes('已满'));
    eq(g.nodes.get('announcer').textContent,g.state().combatText);
    g.run("announce('另一个消息');");tick(g,130);eq(g.nodes.get('announcer').textContent,'另一个消息');eq(g.state().combatText,'');
  }
});
test('a real projectile hit or grenade press makes an overlapping reserved pickup useful immediately',()=>{
  const heal=pickupGame('heal');tick(heal);heal.run('player.inv=0;');arrangeRecapHit(heal,'bullet');tick(heal);
  eq(heal.state().hp,heal.state().maxHp);eq(heal.state().score,75);eq(heal.state().pickups[0].done,true);
  eq(heal.state().combatText,'敌方子弹 · 连击中断');eq(heal.state().lives,1);
  const ammo=pickupGame('grenade');tick(ammo);ammo.key('k');tick(ammo);ammo.key('k',false);
  eq(ammo.state().grenades,7);eq(ammo.state().score,75);eq(ammo.state().pickups[0].done,true);eq(ammo.read('bombs.length'),1);
});
test('spawn warnings preserve full medical pickups but allow useful healing under the existing rules',()=>{
  for(const missing of [0,1]){
    const g=defense();g.run(`const p=pickups.find(p=>p.kind==='heal');player.x=p.x-player.w/2;player.hp=maxHealth()-${missing};`);
    tick(g);assert(g.state().spawnTime>0);eq(g.state().pickups.find(p=>p.kind==='heal').done,missing===1);eq(g.state().score,missing*75);
  }
});
test('lethal damage wins over overlapping medical and same-frame clear rewards',()=>{
  for(const source of ['bullet','mortar']){
    const g=pickupGame('heal');g.run('player.hp=1;player.inv=0;enemies[0].hp=1;');
    arrangeRecapHit(g,source);g.run("projectile(enemies[0].x+15,enemies[0].y+15,0,0,'p',2);");tick(g);
    eq(g.state().phase,'survivalOver');eq(g.state().hp,0);eq(g.state().pickups[0].done,false);eq(g.state().survivalCleared,0);
    assert(!g.nodes.get('overlay-text').textContent.includes('医疗'));assert(g.state().score<250);
    const after=g.state();tick(g,60);eq(g.state(),after);
  }
});
test('nonlethal damage, useful medical pickup and ordinary wave settlement retain their order',()=>{
  const g=pickupGame('heal');g.run('player.hp=3;player.inv=0;enemies[0].hp=1;');
  // Reverse iteration processes enemy damage before the final friendly shot.
  g.run("projectile(enemies[0].x+15,enemies[0].y+15,0,0,'p',2);");arrangeRecapHit(g,'bullet');tick(g);
  eq(g.state().phase,'waveClear');eq(g.state().hp,5);eq(g.state().pickups[0].done,true);
  eq(g.state().score,485,'160 turret + 75 pickup + 250 clear');const frozen=g.state();tick(g,60);eq(g.state(),frozen);
});
test('timed pickups never shorten longer effects or stack, and pause freezes the retained duration',()=>{
  for(const kind of ['spread','boost'])for(const initial of [0,6,12,20]){
    const g=pickupGame(kind),field=kind==='spread'?'weaponTime':'boost';g.run(`player.${field}=${initial};`);tick(g);
    near(g.read(`player.${field}`),Math.max(initial-1/60,12));eq(g.state().score,75);eq(g.state().pickups[0].done,true);
    g.key('p');const remaining=g.read(`player.${field}`);tick(g,60);near(g.read(`player.${field}`),remaining);
    g.click('start');tick(g);near(g.read(`player.${field}`),remaining-1/60);eq(g.state().score,75);
  }
});
test('pause, cancel and respawn retain reserved pickups while retry, new waves and stages rebuild them',()=>{
  const g=pickupGame('heal');tick(g);const reserved=g.read('pickups');g.key('p');g.click('restart');g.click('cancel-restart');
  tick(g,60);eq(g.read('pickups'),reserved);g.click('start');tick(g);eq(g.state().pickups[0].done,false);
  g.click('restart');g.click('start');eq(g.state().survivalWave,1);assert(g.read('pickups.every(p=>!p.done&&!p.reserveHinted)'));
  tick(g);finishDefenseWave(g);g.click('supply-0');g.click('start');eq(g.state().survivalWave,2);assert(g.read('pickups.every(p=>!p.done&&!p.reserveHinted)'));
  for(const spent of [false,true]){
    const c=pickupGame('heal',{mode:'campaign'});if(spent){c.run('player.hp=1;');tick(c);}else tick(c);
    c.run('player.hp=1;player.inv=0;player.lives=2;');arrangeRecapHit(c,'bullet');tick(c);
    eq(c.state().lives,1);eq(c.state().pickups[0].done,spent);eq(c.state().score,spent?75:0);
    c.clear();c.click('upgrade-rapid');c.click('start');eq(c.state().stage,2);assert(c.read('pickups.every(p=>!p.done&&!p.reserveHinted)'));
  }
});
test('reservation hints are scene-only, detached snapshots and blocked storage remain safe',()=>{
  for(const blocked of [false,true]){
    const g=pickupGame('heal',{blocked});const before=g.state().progress;tick(g);g.run('saveProgress();');eq(g.state().progress,before);
    if(!blocked)eq(JSON.parse(g.values.get(STORE)),before);else eq(g.state().storageAvailable,false);
    const state=g.win.__raidState;state.pickups[0].done=true;tick(g);eq(g.state().pickups[0].done,false);
    assert(!JSON.stringify(g.state().progress).includes('reserveHinted'));
  }
});

// The browser proof and the deterministic suite share the exact capture/check
// functions, so fixes to the smoke predicate cannot silently weaken assertions.
test('combat proof accepts actual kill and damage in either order within one update',()=>{
  for(const damageFirst of [false,true]){
    const g=recapGame({mode:'campaign'});g.run('combo={count:0,timer:0,best:0};enemies[0].hp=1;hud();');
    const before=g.state();
    const kill=()=>g.run("projectile(enemies[0].x+12,enemies[0].y+15,0,0,'p',2);");
    if(damageFirst){kill();arrangeRecapHit(g,'bullet');}else{arrangeRecapHit(g,'bullet');kill();}
    tick(g);eq(g.read('enemies[0].dead'),true);eq(g.state().hp,before.hp-1);
    eq(g.state().combo,damageFirst?1:0);eq(g.state().comboBest,1);
    const proof=captureRaidCombatProof(before.comboBest,g.state(),g.nodes.get('combo-status').textContent);
    assert(validRaidCombatProof(proof,before),JSON.stringify(proof));
    // Later gameplay cannot alter the evidence already captured at the kill.
    tick(g,120);assert(validRaidCombatProof(proof,before));
  }
});
test('combat proof rejects missing kills, stale runs, wrong HUD and invented damage',()=>{
  const g=recapGame({mode:'campaign'});g.run('combo={count:0,timer:0,best:0};hud();');const before=g.state();
  arrangeRecapHit(g,'bullet');tick(g);
  eq(captureRaidCombatProof(before.comboBest,g.state(),g.nodes.get('combo-status').textContent),false);
  g.run("enemies[0].hp=1;projectile(enemies[0].x+12,enemies[0].y+15,0,0,'p',2);");tick(g);
  const proof=captureRaidCombatProof(before.comboBest,g.state(),g.nodes.get('combo-status').textContent);
  assert(validRaidCombatProof(proof,before));
  for(const patch of [{comboBest:0},{stage:2},{phase:'title'},{mode:'survival'},{label:'待命'},
    {label:'1 连 · ×3 · 5.0s'},{combatText:''},{combatText:'敌方子弹 · 连击中断'}])
    eq(validRaidCombatProof({...proof,...patch},before),false,JSON.stringify(patch));
  const interrupted={...proof,combo:0,comboTime:0,label:'待命',combatText:'敌方子弹 · 连击中断'};
  assert(validRaidCombatProof(interrupted,before));
  eq(validRaidCombatProof({...interrupted,hp:before.hp,lives:before.lives},before),false);
  eq(validRaidCombatProof({...interrupted,comboTime:1},before),false);
  eq(captureRaidCombatProof(proof.comboBest,g.state(),proof.label),false);
});
test('first-patrol smoke proof survives 300 seeded real-input timing replays',()=>{
  let interrupted=0,active=0;
  for(let seed=1;seed<=30;seed++)for(const delay of [0,1,2,3,5,8,12,18,24,36]){
    const g=createGame({randomSeed:seed*997});g.click('start');const before=g.state();
    g.key('d');until(g,()=>g.state().weapon==='spread',180);g.key('d',false);
    g.frames(delay);g.key('j');let proof=false;
    for(let frame=0;frame<270&&!proof;frame++){
      g.frames();proof=captureRaidCombatProof(before.comboBest,g.state(),g.nodes.get('combo-status').textContent);
    }
    g.key('j',false);assert(validRaidCombatProof(proof,before),JSON.stringify({seed,delay,proof,state:g.state()}));
    if(proof.combo===0)interrupted++;else active++;
  }
  assert(active>0);console.log(`  300 input replays: ${active} active combo, ${interrupted} damage interruption`);
});

test('weapon readout exposes independent scatter and rapid-fire clocks in all modes',()=>{
  for(const options of pickupModes)for(const [scatter,rapid,label] of [
    [0,0,'步枪'],[12,0,'散弹 12s'],[0,12,'步枪 · 连射 12s'],[20,12,'散弹 20s · 连射 12s'],
    [12,20,'散弹 12s · 连射 20s'],[.001,.001,'散弹 1s · 连射 1s'],
  ]){
    const g=recapGame(options);g.run(`player.weaponTime=${scatter};player.boost=${rapid};hud();`);
    eq(g.nodes.get('weapon').textContent,label);near(g.state().boostTime,rapid);near(g.state().weaponTime,scatter);
    assert(!g.nodes.get('weapon').hasAttribute('aria-live'),'Per-second clocks must not spam live announcements');
    g.run("announce('重要战斗消息');hud();");eq(g.nodes.get('announcer').textContent,'重要战斗消息');
  }
});
test('independent and simultaneous expiry restore the correct weapon without altering fire rate',()=>{
  for(const [scatter,rapid,after] of [[.1,4,'步枪 · 连射 4s'],[4,.1,'散弹 4s'],[.1,.1,'步枪']]){
    const g=recapGame({mode:'campaign'});g.run(`player.weaponTime=${scatter};player.boost=${rapid};player.inv=100;`);
    tick(g,12);g.run('hud();');eq(g.nodes.get('weapon').textContent,after);
    g.run('player.shoot=0;fire();');eq(g.state().lastVolley,scatter>1?3:1);
    near(g.read('player.shoot'),scatter>1?.33:rapid>1?.075:.15);
  }
});
test('both clocks and readout freeze across pause and canceled confirmation',()=>{
  const g=pickupGame('boost');g.run('player.weaponTime=8;player.boost=12;hud();');
  g.key('p');const state=g.state(),label=g.nodes.get('weapon').textContent;g.frames(120);
  near(g.state().weaponTime,state.weaponTime);near(g.state().boostTime,state.boostTime);eq(g.nodes.get('weapon').textContent,label);
  g.click('restart');g.frames(120);g.click('cancel-restart');g.frames(120);
  near(g.state().weaponTime,state.weaponTime);near(g.state().boostTime,state.boostTime);eq(g.nodes.get('weapon').textContent,label);
  g.click('start');g.frames(12);assert(g.state().weaponTime<state.weaponTime&&g.state().boostTime<state.boostTime);
});
test('pickup protection immediately refreshes both visible clocks without shortening either effect',()=>{
  for(const kind of ['boost','spread'])for(const duration of [3,20]){
    const g=pickupGame(kind);g.run(`player.weaponTime=${duration};player.boost=${duration};`);tick(g);
    const s=g.state();near(kind==='boost'?s.boostTime:s.weaponTime,Math.max(duration-1/60,12));
    eq(g.nodes.get('weapon').textContent,`散弹 ${Math.ceil(s.weaponTime)}s · 连射 ${Math.ceil(s.boostTime)}s`);
    eq(s.score,75);eq(s.pickups[0].done,true);
  }
});
test('readout follows existing retry, wave and stage carry rules without new saved fields',()=>{
  const g=pickupGame('boost');g.run('player.weaponTime=8;player.boost=12;hud();');
  finishDefenseWave(g);const cleared=g.state(),label=g.nodes.get('weapon').textContent;g.frames(120);
  near(g.state().weaponTime,cleared.weaponTime);near(g.state().boostTime,cleared.boostTime);eq(g.nodes.get('weapon').textContent,label);
  g.click('supply-0');g.click('start');near(g.state().weaponTime,cleared.weaponTime);near(g.state().boostTime,cleared.boostTime);
  g.click('restart');g.click('start');eq(g.state().weaponTime,0);eq(g.state().boostTime,0);eq(g.nodes.get('weapon').textContent,'步枪');
  const c=pickupGame('boost',{mode:'campaign'});c.run('player.weaponTime=8;player.boost=12;hud();');c.clear();
  const remaining=c.state().weaponTime;c.click('upgrade-rapid');c.click('start');
  near(c.state().weaponTime,remaining);eq(c.state().boostTime,0);eq(c.nodes.get('weapon').textContent,'散弹 '+Math.ceil(remaining)+'s');
  const snapshot=c.win.__raidState;snapshot.boostTime=999;eq(c.state().boostTime,0);
  assert(!JSON.stringify(c.state().progress).includes('boostTime'));
});

console.log(`\nOK  Pixel Raid: ${passed} deterministic expedition, combat, operation and survival contracts passed`);
