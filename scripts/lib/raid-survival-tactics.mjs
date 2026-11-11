import { mortarJump } from './raid-mortar-tactics.mjs';
/** Read-only, player-like inputs shared by VM and published-build combat checks. */
export function survivalTactics() {
  // Wave setup preserves facing, so orient with a real movement key first.
  let facing = 0, retreat = 0, descend = 0, descendY = 0, bossRetreat = false, lastGrenade = -Infinity;
  return state => {
    const center = state.x + 13;
    const groundThreats = state.enemies.filter(enemy => enemy.type !== 'drone' &&
      enemy.y < state.y + state.playerHeight + 24 && enemy.y + enemy.h > state.y - 24);
    const nearest = [...groundThreats].sort((a, b) =>
      Math.abs(a.x + a.w / 2 - center) - Math.abs(b.x + b.w / 2 - center))[0];
    const gap = nearest ? Math.abs(nearest.x + nearest.w / 2 - center) : Infinity;
    // Keep retreating until there is room to turn and fire. Otherwise a target
    // crossing the player's center flips direction every sample and traps the
    // controller inside its contact box, beyond either side of the muzzle.
    if (!retreat && gap < 100) retreat = nearest.x + nearest.w / 2 >= center ? -1 : 1;
    if (retreat && gap > 180) retreat = 0;
    if (retreat < 0 && state.x < 30) retreat = 1;
    if (retreat > 0 && state.x > 880) retreat = -1;
    const target = state.bossWave ? { x: state.bossX, w: 105, type: 'boss' } :
      [...state.enemies].sort((a, b) => Math.abs(a.x - state.x) - Math.abs(b.x - state.x))[0];
    if (!target) return { move: '', jump: false, dash: false, grenade: false };
    const direction = target.x + target.w / 2 > center ? 1 : -1;
    const distance = Math.abs(target.x - state.x), airborne = target.type === 'drone';
    // A ground target below a ledge cannot be hit by horizontal fire. Walk off
    // the ledge instead of waiting above its head and oscillating left/right.
    if (descend && state.y + 20 >= descendY) descend = 0;
    if (!state.bossWave && !airborne && !descend && state.y + 20 < target.y) {
      // Against a stationary mortar, leave the ledge away from its contact
      // body rather than trapping the player between it and the arena wall.
      descend = target.type === 'mortar' ? -direction : state.x < 480 ? -1 : 1; descendY = target.y;
    }
    let move = '';
    if (state.bossWave) {
      if (state.x > 570) bossRetreat = true;
      if (state.x <= 500) bossRetreat = false;
      move = bossRetreat ? 'a' : state.x < 500 || facing < 0 ? 'd' : '';
    } else if (descend) move = descend < 0 ? 'a' : 'd';
    else if (retreat) move = retreat < 0 ? 'a' : 'd';
    else if (distance > (airborne ? 170 : 210) || facing !== direction) move = direction > 0 ? 'd' : 'a';
    if (move && state.dashTime === 0) facing = move === 'd' ? 1 : -1;
    const nearby = state.hostiles.some(bullet => Math.abs(bullet.x - center) < 100 &&
      bullet.y > state.y - 15 && bullet.y < state.y + state.playerHeight + 15);
    let grenade = state.spawnTime === 0 && !retreat && !descend && !airborne && facing === direction &&
      state.grenades > 0 && ['shield', 'boss', 'mortar'].includes(target.type) && distance > 200 && distance < 340 && state.survivalTime - lastGrenade > 1.4;
    if (state.survivalWave >= 5 && !descend && !airborne && state.spawnTime === 0 && state.grenades > 0 &&
      ['shield', 'mortar'].includes(target.type) && distance > 90 && distance < 300 && state.survivalTime - lastGrenade > 1.4) {
      // Turn with movement before throwing, then resume retreat on the next
      // sample. Do not sit on six grenades while pinned behind a shield.
      move = direction > 0 ? 'd' : 'a'; facing = direction; grenade = true;
    }
    if (grenade) lastGrenade = state.survivalTime;
    const chargerJump = state.survivalWave >= 5 && state.ground && state.enemies.some(e =>
      e.type === 'charger' && e.chargerPhase === 'windup' && e.chargerTime <= .45 &&
      state.y + state.playerHeight > e.y && state.x + 27 > Math.min(e.x, e.chargerEnd) &&
      state.x < Math.max(e.x, e.chargerEnd) + e.w);
    const tactical = state.survivalWave >= 5 && state.spawnTime === 0 && state.tacticalCharge >= 100 &&
      state.tacticalTime === 0 && gap < 210;
    return { tactical, move, jump: mortarJump(state) || chargerJump || airborne && !retreat && !descend, dash: state.dashCooldown === 0 && (nearby || gap < 65), grenade };
  };
}
