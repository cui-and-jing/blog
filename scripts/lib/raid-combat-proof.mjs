/** Capture once, before input release can advance the game. No mutable hooks. */
export function captureRaidCombatProof(bestBefore, state = window.__raidState,
  label = document.getElementById('combo-status')?.textContent) {
  if (!state || state.comboBest <= bestBefore) return false;
  const { phase, mode, stage, combo, comboBest, comboTime, combatText, hp, lives } = state;
  return { phase, mode, stage, combo, comboBest, comboTime, combatText, hp, lives, label };
}

// Judge the captured frame, not a later HUD poll. A real kill can be followed
// by damage in the same update; comboBest survives, the active combo does not.
export function validRaidCombatProof(proof, before) {
  if (!proof || proof.phase !== 'playing' || proof.mode !== before.mode || proof.stage !== before.stage ||
    proof.comboBest <= before.comboBest) return false;
  const multiplier = proof.combo >= 4 ? 3 : proof.combo >= 2 ? 2 : 1;
  if (proof.combo > 0) return proof.comboTime > 0 &&
    proof.label.startsWith(proof.combo + ' 连 · ×' + multiplier + ' · ') &&
    proof.combatText.startsWith(proof.combo + ' 连击 · +') && !proof.combatText.includes('中断');
  return proof.combo === 0 && proof.comboTime === 0 && proof.label === '待命' &&
    /^(敌方子弹|敌人接触) · 连击中断$/.test(proof.combatText) &&
    (proof.hp < before.hp || proof.lives < before.lives);
}
