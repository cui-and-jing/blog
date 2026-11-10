/** Read-only, player-like inputs shared by VM and published-build combat checks. */
export function survivalTactics() {
  let facing = 1, retreat = 0, bossRetreat = false, lastGrenade = -Infinity;
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
    let move = '';
    if (state.bossWave) {
      if (state.x > 570) bossRetreat = true;
      if (state.x <= 500) bossRetreat = false;
      move = bossRetreat ? 'a' : state.x < 500 || facing < 0 ? 'd' : '';
    } else if (retreat) move = retreat < 0 ? 'a' : 'd';
    else if (distance > (airborne ? 170 : 210) || facing !== direction) move = direction > 0 ? 'd' : 'a';
    if (move && state.dashTime === 0) facing = move === 'd' ? 1 : -1;
    const nearby = state.hostiles.some(bullet => Math.abs(bullet.x - center) < 100 &&
      bullet.y > state.y - 15 && bullet.y < state.y + state.playerHeight + 15);
    const grenade = state.spawnTime === 0 && !retreat && !airborne && facing === direction &&
      state.grenades > 0 && distance > 150 && distance < 340 && state.survivalTime - lastGrenade > 1.4;
    if (grenade) lastGrenade = state.survivalTime;
    return { move, jump: airborne && !retreat, dash: state.dashCooldown === 0 && (nearby || gap < 65), grenade };
  };
}
