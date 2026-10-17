import { gearOf } from './equipment';
import { fmtWeight } from './format';

// What goes on each side of the bar. Assumes a 45 lb bar, Smith machine included.

export const BAR = 45;
// No 35s: plenty of gyms (and plate trees) only have 45, 25, 10, 5 and 2.5.
const PLATES = [45, 25, 10, 5, 2.5];

/** A lift loaded on a bar from both ends: barbell and Smith machine lifts, by gear or by name. */
export const isBarLift = (exercise: string): boolean => {
  const g = gearOf(exercise);
  return g === 'barbell' || g === 'Smith machine' || (g == null && /\b(barbell|smith)\b/i.test(exercise));
};

/** Weight per side and the plates for it, heaviest first; null when it isn't a bar lift or there's nothing to add. */
export function perSide(weight: number, exercise: string): { side: number; plates: number[] } | null {
  if (!isBarLift(exercise) || !(weight > BAR)) return null;
  const side = (weight - BAR) / 2;
  const plates: number[] = [];
  let left = side;
  for (const p of PLATES) while (left >= p - 1e-9) { plates.push(p); left -= p; }
  return { side, plates };
}

/** "37.5 a side · 25 + 10 + 2.5"; the plates are left off when they don't add up exactly. */
export function fmtPerSide(weight: number, exercise: string): string | null {
  const s = perSide(weight, exercise);
  if (!s) return null;
  const exact = Math.abs(s.plates.reduce((a, p) => a + p, 0) - s.side) < 1e-9;
  return `${fmtWeight(s.side)} a side${exact && s.plates.length ? ` · ${s.plates.map(fmtWeight).join(' + ')}` : ''}`;
}
