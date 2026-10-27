/**
 * Pixel Raid combat contract tests.
 *
 * Runs the ACTUAL unminified game's IIFE with a mocked DOM/Canvas and a virtual
 * animation clock. Test hooks are injected into the in-memory copy only;
 * there is no mutable debug API in the published game.
 *
 * Usage: node scripts/pixelraid-mechanics.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../public/games/pixelraid.html', import.meta.url), 'utf8');
const inline = source.match(/<script>\s*([\s\S]*?)<\/script>/i)?.[1];
assert(inline, 'Pixel Raid is expected to contain an inline game script');

const entry = "resetStage(0,null);phase='title';hud();draw();window.__raidReady=true;requestAnimationFrame(loop);";
assert.equal(inline.split(entry).length, 2, 'Could not find the exact game initialization anchor');

const testOnlyHooks = [
  "window.__raidQA = Object.freeze({",
  "  safe() { player.inv = 100; },",
  "  nearBoss() {",
  "    player.x = boss.x - 190;",
  "    player.y = G - player.h;",
  "    player.vy = 0;",
  "    player.ground = true;",
  "    player.inv = 100;",
  "    cam = clamp(player.x - 290, 0, stage.width - W);",
  "  },",
  "  enrageBoss() { boss.hp = Math.ceil(boss.maxHp * .4); },",
  "  exit() {",
  "    player.x = stage.width - 95;",
  "    player.y = G - player.h;",
  "    player.vy = 0;",
  "    player.ground = true;",
  "    player.inv = 100;",
  "  },",
  "  defeatBoss() { damageBoss(boss.hp); }",
  "});",
].join('\n');

const callbacks = new Map();
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) {
    nodes.set(id, {
      hidden: false,
      textContent: '',
      classList: { add() {}, remove() {} },
      addEventListener(name, callback) {
        callbacks.set(id + '.' + name, callback);
      },
      setAttribute() {},
      blur() {},
    });
  }
  return nodes.get(id);
}

const graphics = Object.fromEntries(
  ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'fill', 'stroke', 'save', 'restore',
    'translate', 'scale', 'fillText'].map((key) => [key, () => {}]),
);
node('field').getContext = () => graphics;

const events = new Map();
let queued = null;
let now = 0;
const win = {
  addEventListener(name, fn) { events.set(name, fn); },
};
const context = {
  window: win,
  document: {
    getElementById: node,
    querySelectorAll() { return []; },
    addEventListener() {},
    activeElement: null,
  },
  performance: { now: () => now },
  requestAnimationFrame: (fn) => { queued = fn; },
  localStorage: { getItem: () => null, setItem() {} },
  navigator: { getGamepads: () => [] },
};
vm.runInNewContext(inline.replace(entry, testOnlyHooks + entry), context, { timeout: 5000 });

const state = () => ({ ...win.__raidState });
const qa = win.__raidQA;
assert(win.__raidReady && qa, 'Game did not initialize');
function frames(count) {
  for (let i = 0; i < count; i++) {
    const current = queued;
    assert.equal(typeof current, 'function', 'Animation loop has stopped');
    queued = null;
    now += 1000 / 60;
    current(now);
  }
}
function key(name, down = true) {
  const fn = events.get(down ? 'keydown' : 'keyup');
  assert(fn, 'Keyboard handler missing');
  fn({ key: name, repeat: false, preventDefault() {} });
}
function click(id) {
  const fn = callbacks.get(id + '.click');
  assert(fn, 'Missing click handler for #' + id);
  fn();
}
function check(name, predicate) {
  const snap = state();
  assert(predicate(snap), name + ': ' + JSON.stringify(snap));
  console.log('✓ ' + name);
}

check('title screen is ready', (s) => s.phase === 'title' && s.stage === 1);
click('start');
qa.safe();
frames(3);
check('starts with a single-shot rifle', (s) => s.phase === 'playing' && s.weapon === 'rifle');
key('j');
frames(4);
key('j', false);
check('rifle emits one projectile per volley', (s) => s.lastVolley === 1 && s.shots >= 1);

key('d');
frames(54);
key('d', false);
check('running over a reachable pickup grants a temporary scatter weapon',
  (s) => s.x > 260 && s.weapon === 'spread' && s.weaponTime > 10);
key('j');
frames(20);
key('j', false);
check('scatter weapon emits a three-way volley',
  (s) => s.lastVolley === 3 && s.shots >= 4);

frames(760); // Twelve seconds of virtual gameplay, without actual waiting.
check('temporary weapon expires and returns to rifle',
  (s) => s.weapon === 'rifle' && s.weaponTime === 0);

qa.nearBoss();
frames(30);
check('boss warns before firing', (s) => s.bossCharge > 0 && s.bossAttacks === 0);
frames(50);
check('first-stage normal boss fires a single aimed shot',
  (s) => s.bossAttacks >= 1 && s.bossLastVolley === 1);
qa.enrageBoss();
frames(190);
check('below half health first-stage boss uses a three-way volley',
  (s) => s.bossRage && s.bossAttacks >= 2 && s.bossLastVolley === 3);

qa.exit();
frames(3);
check('exit remains locked until boss is defeated', (s) => s.phase === 'playing');
qa.defeatBoss();
frames(3);
check('defeated boss unlocks the stage clear screen', (s) => s.phase === 'stageClear');
click('start');
check('stage two loads with preserved lives',
  (s) => s.stage === 2 && s.phase === 'playing' && s.lives === 3);

qa.nearBoss();
frames(130);
check('second-stage boss starts with a three-way volley',
  (s) => s.bossAttacks >= 1 && s.bossLastVolley === 3);
qa.enrageBoss();
frames(190);
check('second-stage rage phase fires five projectiles per volley',
  (s) => s.bossRage && s.bossAttacks >= 2 && s.bossLastVolley === 5);
qa.exit();
qa.defeatBoss();
frames(3);
check('defeating stage-two boss completes the campaign',
  (s) => s.phase === 'victory' && s.stage === 2);

console.log('\nOK  Pixel Raid: weapon, pickup, boss phase and victory contracts passed');
