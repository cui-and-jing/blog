/** Observe the visible impact warning and time an ordinary jump, never edit state. */
export function mortarJump(state) {
  if (!state.ground) return false;
  const warnings = [
    ...state.enemies.filter(e => e.type === 'mortar' && e.windup > 0)
      .map(e => ({ x: e.aimX - 58, y: e.aimY - 64, w: 116, h: 64, remaining: e.windup + .85 })),
    ...(state.shells ?? []).map(shot => ({ ...shot.zone, remaining: .85 - shot.elapsed })),
  ];
  return warnings.some(zone => zone.remaining <= .55 && zone.remaining > 0 &&
    state.x < zone.x + zone.w && state.x + 27 > zone.x &&
    state.y < zone.y + zone.h && state.y + state.playerHeight > zone.y);
}
