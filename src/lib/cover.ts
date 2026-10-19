const PALETTES = [
  { c1: '#c9482a', c2: '#e8853f', c3: '#f5c274' },
  { c1: '#17514d', c2: '#37857a', c3: '#8bc4b0' },
  { c1: '#243a63', c2: '#456999', c3: '#9bbcda' },
  { c1: '#4e2c58', c2: '#855490', c3: '#c9a2c6' },
  { c1: '#6b4a1c', c2: '#a97a34', c3: '#dcbc7c' },
  { c1: '#27303a', c2: '#465662', c3: '#8b99a3' },
  { c1: '#7d2f39', c2: '#b4525a', c3: '#e0969a' },
  { c1: '#2c5a2e', c2: '#4f8a52', c3: '#96c194' },
];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export interface CoverStyle {
  c1: string;
  c2: string;
  c3: string;
  angle: number;
  glyph: string;
  variant: number;
}

/** Deterministic gradient cover derived from the post slug. */
export function coverStyle(seed: string, title = ''): CoverStyle {
  const h = hash(seed);
  // Shift before modulo: adjacent slugs otherwise cluster on the same hue.
  const palette = PALETTES[(h >>> 6) % PALETTES.length];
  const firstChar = Array.from(title.replace(/^[\s「『《"']+/, ''))[0] ?? '·';

  return {
    ...palette,
    angle: 108 + (h % 7) * 11,
    glyph: firstChar,
    variant: (h >>> 3) % 3,
  };
}

export function coverVars(style: CoverStyle): string {
  return `--c1:${style.c1};--c2:${style.c2};--c3:${style.c3};--angle:${style.angle}deg`;
}
