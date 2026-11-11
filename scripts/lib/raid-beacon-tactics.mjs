import { mortarJump } from './raid-mortar-tactics.mjs';
/** Read-only platform route planning. Returned actions use ordinary player controls. */
export function beaconTactics() {
  let waypoint = null;
  return state => {
    const beacon = state.fieldContract?.beacon;
    const idle = { move: '', down: false, jump: false, dash: false, grenade: false, fire: false };
    if (!beacon || beacon.progress >= 5) return idle;
    const center = state.x + 13.5, floor = state.y + state.playerHeight;
    if (state.ground) {
      waypoint = { x: beacon.x, y: beacon.y };
      // A normal jump rises ~110px. The bridge beacon is 120px above the
      // ground, so first climb a reachable lower ledge, not the high marker.
      if (floor - beacon.y > 105) {
        const steps = state.platforms.filter(([, y]) => y > beacon.y && y < floor && floor - y <= 105)
          .map(([x, y, width]) => ({ x: x + width / 2, y }));
        steps.sort((a, b) => Math.abs(a.x - beacon.x) - Math.abs(b.x - beacon.x));
        if (steps.length) waypoint = steps[0];
      }
    }
    waypoint ??= { x: beacon.x, y: beacon.y };
    const dx = waypoint.x - center;
    return {
      ...idle,
      move: Math.abs(dx) > 9 ? dx > 0 ? 'd' : 'a' : '',
      jump: mortarJump(state) || state.ground && floor > waypoint.y + 1 && Math.abs(dx) < 150,
    };
  };
}
