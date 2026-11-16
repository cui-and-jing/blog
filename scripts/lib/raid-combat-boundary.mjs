/** Pure policy for the browser driver's observations, never a game-state fixture. */
import assert from 'node:assert/strict';

export function combatPhase(state, wave = null) {
  assert(state?.mode === 'survival' && state.hp > 0, 'Combat input requires a living survival run');
  if (wave !== null) assert.equal(state.survivalWave, wave, 'Unexpected wave transition during combat input');
  if (state.phase === 'playing') {
    if (wave !== null) assert.equal(state.survivalCleared, wave - 1, 'Unexpected cleared-wave count during combat');
    return 'playing';
  }
  assert(wave !== null && state.phase === 'waveClear' && state.survivalCleared === wave,
    'Only the expected successful wave settlement may interrupt combat input');
  assert.equal(state.touchCount, 0, 'Settlement must clear game touch state');
  return 'settled';
}

export function auditCombatTouch({ kind, action, contact, audit, heldActions, wave = null }) {
  const phase = combatPhase(audit.state, wave);
  assert.equal(audit.events.length, 1, 'Exactly one native pointer event is required');
  const event = audit.events[0];
  assert.equal(event.trusted, true, 'Pointer event must be native');
  assert(Number.isInteger(event.pointerId), 'Pointer event must identify its contact');
  const eventPhase = combatPhase(event.state, wave);
  assert(!(eventPhase === 'settled' && phase === 'playing'), 'Settlement cannot silently advance to a new fight');
  if (kind === 'down') {
    assert.equal(event.type, 'pointerdown');
    if (eventPhase === 'playing') assert.equal(event.action, action, 'Playing touch missed its requested action');
    else assert(event.action === action || /^supply-[0-2]$/.test(event.id ?? ''),
      'Settlement race touched an unexpected menu control');
  } else {
    assert(['pointerup', 'pointercancel'].includes(event.type), 'Contact did not end natively');
    assert.equal(event.pointerId, contact.pointerId, 'A different contact ended');
    assert.equal(event.action, contact.action, 'Release target changed from its actual pointerdown');
    assert.equal(event.id, contact.id, 'Release target identity changed');
  }
  if (phase === 'playing') {
    assert.equal(audit.state.touchCount, heldActions.length, 'Live contacts differ from game touch count');
    assert.deepEqual(audit.active, [...heldActions].sort(), 'Playing active buttons differ from real held contacts');
  } else assert.deepEqual(audit.active, [], 'Settlement must clear all active combat buttons');
  return { phase, event };
}

/** Re-check after each asynchronous observation; dispatch itself remains native. */
export async function dispatchCombatTouch({ action, wave, measure, beforeDispatch, dispatch, observe, track, heldActions }) {
  const point = await measure();
  if (combatPhase(point.state, wave) === 'settled') return false;
  assert(point.hit && point.w >= 42 && point.h >= 44 && point.x > 0 && point.x < 320 && point.y > 0 && point.y < 844,
    'Combat touch target is not reachable');
  const before = await beforeDispatch();
  if (combatPhase(before.state, wave) === 'settled') return false;
  const handle = await dispatch(point);
  // Even a failed audit must leave the actual native contact reachable by cleanup.
  track(handle, null);
  const audit = await observe(before.index), event = audit.events[0];
  track(handle, event);
  return auditCombatTouch({ kind: 'down', action, audit, heldActions: heldActions(), wave }).phase === 'playing';
}
