import type { SetEntry } from '../types';
import { rng } from './num';

// Synthetic training logs with a known strength trend per lift, for the stall tests (item 12). Each lift is trained `perWeek`
// times a week, 3 sets at one weight: reps = κ·(E·readiness/w − 1) − set fatigue − the habitual RIR, plus set noise, rounded.
// The weight goes up a step once the first set reaches 12 (double progression). E follows exp(Σ slope) from E0.

export interface TrendLift {
  name: string; E0: number; step: number;
  /** ln e1RM per week, as a function of the week (0-based). */
  slope: (week: number) => number;
}
export interface TrendOptions {
  weeks: number; perWeek?: number;
  /** Day-to-day readiness SD (ln): 0.03 (a: Grgic 2020's test–retest CV is 4.2 %). */
  ready?: number;
  /** Set-to-set noise SD (reps). */
  setSd?: number;
}
const KAPPA = 30, HABIT = 2, A = 1;
const day = (n: number) => new Date(Date.UTC(2025, 0, 6) + n * 864e5).toISOString().slice(0, 10);

export function trendLog(seed: number, lifts: TrendLift[], o: TrendOptions): SetEntry[] {
  const r = rng(seed);
  const per = o.perWeek ?? 2, ready = o.ready ?? 0.03, setSd = o.setSd ?? 0.7;
  const out: SetEntry[] = [];
  let seq = 0;
  lifts.forEach((l, li) => {
    let x = Math.log(l.E0);
    let w = l.step * Math.floor(l.E0 / (1 + (10 + HABIT) / KAPPA) / l.step);
    for (let wk = 0; wk < o.weeks; wk++) {
      for (let k = 0; k < per; k++) {
        const d = wk * 7 + Math.round((k * 7) / per) + (li % 2);
        const E = Math.exp(x + r.normal(0, ready));
        const got: number[] = [];
        for (let s = 0; s < 3; s++) {
          const reps = Math.max(1, Math.round(KAPPA * (E / w - 1) - A * s - HABIT + r.normal(0, setSd)));
          got.push(reps);
          out.push({ id: `trend|${seed}|${li}|${d}|${s}`, date: day(d), seq: seq++, exercise: l.name, setNo: s + 1, weight: w, reps, flags: [], source: 'sim' });
        }
        if (got[0] >= 12) w += l.step;
      }
      x += l.slope(wk);
    }
  });
  return out;
}

/** The date of the last session in week `wk` (0-based) of a trendLog. */
export const weekEnd = (wk: number): string => day(wk * 7 + 6);
