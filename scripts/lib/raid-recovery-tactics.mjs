/** Read-only route planning for the optional recovery objective, not a game hook. */
import { survivalTactics } from './raid-survival-tactics.mjs';

export function recoveryTactics() {
  const fight = survivalTactics();
  let targetIndex = 2;
  return state => {
    const nodes = state.fieldContract?.nodes;
    if (!nodes || nodes.every(node => node.done)) return { ...fight(state), fire: true };
    // Take the ledge first, its nearby flank second, then cross to the other
    // flank. Do not shoot the last enemy before the three nodes are recovered.
    if (nodes[targetIndex].done) targetIndex = [2, nodes[2].x > 480 ? 1 : 0, nodes[2].x > 480 ? 0 : 1]
      .find(index => !nodes[index].done);
    const target = nodes[targetIndex], center = state.x + 13.5, dx = target.x - center;
    const high = target.y < 350;
    // A body can still overlap a ledge even when its centre is horizontally
    // within the ground node's stop radius. Use the player's real descent
    // chord rather than waiting forever above that node at the platform edge.
    const down = !high && state.ground && state.y + state.playerHeight < target.y;
    const move = down ? '' : Math.abs(dx) > 8 ? dx > 0 ? 'd' : 'a' : '';
    const nearby = state.hostiles.some(bullet => Math.abs(bullet.x - center) < 85 &&
      bullet.y > state.y - 12 && bullet.y < state.y + state.playerHeight + 12);
    return {
      move, down,
      jump: down || high && Math.abs(dx) < 155 && state.ground && state.y > target.y - 10,
      // Stay on the jump arc near the ledge. On the long cross-field sprint,
      // dashing through incoming bullets is a real defensive player action.
      dash: !down && !high && Math.abs(dx) > 100 && state.dashCooldown === 0 && nearby,
      grenade: false,
      fire: false,
    };
  };
}
