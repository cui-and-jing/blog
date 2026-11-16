/** Deterministic scheduling tests of the QA driver, not mutable game fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatPhase, auditCombatTouch, dispatchCombatTouch } from './lib/raid-combat-boundary.mjs';

const playing = (extra = {}) => ({ mode: 'survival', phase: 'playing', survivalWave: 2, survivalCleared: 1, hp: 5, touchCount: 0, ...extra });
const settled = (extra = {}) => playing({ phase: 'waveClear', survivalCleared: 2, ...extra });
const event = (extra = {}) => ({ type: 'pointerdown', action: 'jump', id: 'jump', pointerId: 7, trusted: true, state: playing(), ...extra });
const audit = (extra = {}) => ({ events: [event()], state: playing({ touchCount: 1 }), active: ['jump'], ...extra });

function timeline({ atMeasure = playing(), before = playing(), after = audit() } = {}) {
  const calls = [], contacts = new Map(), handle = { nativeContact: 'test transport handle' };
  return { calls, contacts, handle,
    run: () => dispatchCombatTouch({ action: 'jump', wave: 2,
      measure: async () => { calls.push('coordinates');return { x: 240, y: 600, w: 50, h: 48, hit: atMeasure.phase === 'playing', state: atMeasure }; },
      beforeDispatch: async () => { calls.push('before-dispatch');return { index: 9, state: before }; },
      dispatch: async point => { calls.push('native-dispatch');assert.equal(point.x, 240);return handle; },
      observe: async index => { calls.push('audit');assert.equal(index, 9);return after; },
      track: (h, e) => { assert.equal(h, handle);contacts.set('jump', { handle: h, pointerId: e?.pointerId, action: e?.action, id: e?.id }); },
      heldActions: () => [...contacts.keys()]
    })
  };
}

test('ordinary native touch requires exact action and active contact accounting', async () => {
  const t = timeline();assert.equal(await t.run(), true);
  assert.deepEqual(t.calls, ['coordinates', 'before-dispatch', 'native-dispatch', 'audit']);
  assert.equal(t.contacts.get('jump').pointerId, 7);
});
test('settlement before coordinate retrieval stops without dispatching even though the button is covered', async () => {
  const t = timeline({ atMeasure: settled() });assert.equal(await t.run(), false);
  assert.deepEqual(t.calls, ['coordinates']);assert.equal(t.contacts.size, 0);
});
test('settlement between coordinates and dispatch precheck never sends the stale touch', async () => {
  const t = timeline({ before: settled() });assert.equal(await t.run(), false);
  assert.deepEqual(t.calls, ['coordinates', 'before-dispatch']);assert.equal(t.contacts.size, 0);
});
test('settlement after precheck but before native dispatch records the real supply contact for release', async () => {
  const menuEvent = event({ action: undefined, id: 'supply-1', state: settled() });
  const t = timeline({ after: audit({ events: [menuEvent], state: settled(), active: [] }) });
  assert.equal(await t.run(), false);assert.equal(t.contacts.get('jump').id, 'supply-1');
  const release = auditCombatTouch({ kind: 'up', action: 'jump', wave: 2, contact: t.contacts.get('jump'), heldActions: [],
    audit: audit({ events: [{ ...menuEvent, type: 'pointerup' }], state: settled(), active: [] }) });
  assert.equal(release.phase, 'settled');
});
test('settlement after a correctly targeted playing pointerdown is a legitimate stop', async () => {
  const t = timeline({ after: audit({ state: settled(), active: [] }) });
  assert.equal(await t.run(), false);assert.equal(t.contacts.get('jump').action, 'jump');
});
test('a missed playing touch cannot be laundered by settlement before the audit', async () => {
  const t = timeline({ after: audit({ events: [event({ action: undefined, id: 'supply-1' })], state: settled(), active: [] }) });
  await assert.rejects(t.run(), /missed its requested action/);
  assert.equal(t.contacts.size, 1, 'Failure must retain the dispatched contact for cleanup');
});
test('non-native, missing, duplicate and wrong-action playing events remain errors', async () => {
  for (const events of [[], [event(), event()], [event({ trusted: false })], [event({ action: 'fire' })]]) {
    await assert.rejects(timeline({ after: audit({ events }) }).run());
  }
  for (const extra of [{ active: [] }, { state: playing() }]) await assert.rejects(timeline({ after: audit(extra) }).run());
});
test('only the exact successful same-wave boundary is accepted', () => {
  for (const state of [settled({ hp: 0 }), settled({ survivalWave: 3 }), settled({ survivalCleared: 1 }),
    settled({ mode: 'campaign' }), settled({ phase: 'pause' }), settled({ phase: 'survivalOver' }), settled({ touchCount: 1 }),
    playing({ survivalCleared: 2 })]) assert.throws(() => combatPhase(state, 2));
  assert.throws(() => combatPhase(settled(), null), /Only the expected/);
});
test('a boundary may not hit Start, restart, home, reroll or an unrelated action', async () => {
  for (const id of ['start', 'restart', 'menu-home', 'supply-reroll', 'supply-3', undefined]) {
    await assert.rejects(timeline({ after: audit({ events: [event({ action: undefined, id, state: settled() })], state: settled(), active: [] }) }).run(), /unexpected menu control/);
  }
  await assert.rejects(timeline({ after: audit({ events: [event({ state: settled() })] }) }).run(), /silently advance/);
  await assert.rejects(timeline({ after: audit({ state: settled(), active: ['jump'] }) }).run(), /clear all active/);
});
test('native releases keep their exact actual target and pointer identity across settlement', () => {
  const contact = event(), base = { kind: 'up', action: 'jump', wave: 2, contact, heldActions: [] };
  const release = event({ type: 'pointerup', state: settled() });
  assert.equal(auditCombatTouch({ ...base, audit: audit({ events: [release], state: settled(), active: [] }) }).phase, 'settled');
  for (const change of [{ action: 'fire' }, { pointerId: 8 }, { id: 'supply-1' }, { trusted: false }]) {
    assert.throws(() => auditCombatTouch({ ...base, audit: audit({ events: [{ ...release, ...change }], state: settled(), active: [] }) }));
  }
});
