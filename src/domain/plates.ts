import { gearOf, type Gym } from './equipment';
import { fmtWeight } from './format';

// What goes on each side of the bar. Assumes a 45 lb bar, Smith machine included.

export const BAR = 45;
/** The plate sizes a gym can have, heaviest first, and every gym's default (owner, 2026-10-22: 35s too; a gym without turns them off). */
export const PLATE_SIZES = [45, 35, 25, 10, 5, 2.5];
/** The plates at this gym (Gym.plates), else the default. */
export const platesOf = (gym: Gym | null | undefined): number[] => gym?.plates ?? PLATE_SIZES;

/** A lift loaded on a bar from both ends: barbell and Smith machine lifts, by gear or by name. */
export const isBarLift = (exercise: string): boolean => {
  const g = gearOf(exercise);
  return g === 'barbell' || g === 'Smith machine' || (g == null && /\b(barbell|smith)\b/i.test(exercise));
};

/** Weight per side and the plates for it, heaviest first; null when it isn't a bar lift or there's nothing to add. */
export function perSide(weight: number, exercise: string, sizes: readonly number[] = PLATE_SIZES): { side: number; plates: number[] } | null {
  if (!isBarLift(exercise) || !(weight > BAR)) return null;
  const side = (weight - BAR) / 2;
  const desc = [...sizes].sort((a, b) => b - a);
  const plates: number[] = [];
  let left = side;
  for (const p of desc) while (left >= p - 1e-9) { plates.push(p); left -= p; }
  // Heaviest first can miss with some plates gone (70 from 45 and 35s): then the fewest plates that make it, if any do.
  return { side, plates: Math.abs(left) < 1e-9 ? plates : fewest(side, desc) ?? plates };
}

/** The fewest plates (heaviest first) adding up to `side` exactly, in quarter-pound steps; null when none do. */
function fewest(side: number, desc: number[]): number[] | null {
  const q = (x: number) => Math.round(x * 4);
  const n = q(side), sizes = desc.filter((p) => Math.abs(q(p) - p * 4) < 1e-9 && q(p) > 0);
  if (Math.abs(n - side * 4) > 1e-9 || n > 4000) return null;
  const best: (number[] | null)[] = [[]];
  for (let i = 1; i <= n; i++) {
    best[i] = null;
    for (const p of sizes) { const prev = best[i - q(p)]; if (prev && (!best[i] || prev.length + 1 < best[i]!.length)) best[i] = [...prev, p]; }
  }
  return best[n]?.sort((a, b) => b - a) ?? null;
}

/** "37.5 a side · 25 + 10 + 2.5"; the plates are left off when they don't add up exactly. */
export function fmtPerSide(weight: number, exercise: string, sizes?: readonly number[]): string | null {
  const s = perSide(weight, exercise, sizes);
  if (!s) return null;
  const exact = Math.abs(s.plates.reduce((a, p) => a + p, 0) - s.side) < 1e-9;
  return `${fmtWeight(s.side)} a side${exact && s.plates.length ? ` · ${s.plates.map(fmtWeight).join(' + ')}` : ''}`;
}
