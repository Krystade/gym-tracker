import type { SetEntry } from '../types';
import { rng } from './num';

// Synthetic logs with a known whole-body shift, for item 06. Each lift is trained `perWeek` times a week, 3 sets at one weight:
// reps = κ·(E·readiness/w − 1) − set fatigue − the habitual RIR, plus set noise, rounded; up a step once the first set reaches 12.
// E = E0 · exp(Σ progress + shift(week, lift)): the shift is the known truth (every lift's for a systemic one, one lift's for a
// local one). `stopAt(week)`: that week he stops each set `short` reps before what he could do, at a target the app set (each
// set carries it, so it is a lower bound); `logTarget: false` leaves the targets out (the negative control).

export interface SimLift { name: string; E0: number; step: number }
export interface SimOptions {
  weeks: number; perWeek?: number; progress?: number;
  shift?: (week: number, lift: number) => number;
  stopAt?: (week: number) => boolean; short?: number; logTarget?: boolean;
  /** Days (from the start) with no training: sessions falling on them are left out. */
  off?: (day: number) => boolean;
}
const KAPPA = 30, HABIT = 2, A = 1, READY = 0.03, SET_SD = 0.7;
export const simDay = (n: number) => new Date(Date.UTC(2025, 0, 6) + n * 864e5).toISOString().slice(0, 10);

export const SIM_LIFTS: SimLift[] = [
  { name: 'Bench Press', E0: 250, step: 5 },
  { name: 'Lat Pulldown', E0: 200, step: 5 },
  { name: 'Leg Press', E0: 500, step: 10 },
  { name: 'Seated Cable Row', E0: 220, step: 5 },
  { name: 'Romanian Deadlift', E0: 260, step: 5 },
];

export function deloadLog(seed: number, lifts: SimLift[], o: SimOptions): SetEntry[] {
  const r = rng(seed);
  const per = o.perWeek ?? 2, short = o.short ?? 3, logTarget = o.logTarget ?? true;
  const out: SetEntry[] = [];
  let seq = 0;
  lifts.forEach((l, li) => {
    let x = Math.log(l.E0);
    let w = l.step * Math.floor(l.E0 / (1 + (10 + HABIT) / KAPPA) / l.step);
    for (let wk = 0; wk < o.weeks; wk++) {
      for (let k = 0; k < per; k++) {
        const d = wk * 7 + Math.round((k * 7) / per) + (li % 2);
        if (o.off?.(d)) continue;
        const E = Math.exp(x + (o.shift?.(wk, li) ?? 0) + r.normal(0, READY));
        const stop = o.stopAt?.(wk) ?? false;
        const got: number[] = [];
        for (let s = 0; s < 3; s++) {
          const can = Math.max(1, Math.round(KAPPA * (E / w - 1) - A * s - HABIT + r.normal(0, SET_SD)));
          const reps = stop ? Math.max(1, can - short) : can;
          got.push(reps);
          out.push({ id: `deload|${seed}|${li}|${d}|${s}`, date: simDay(d), seq: seq++, exercise: l.name, setNo: s + 1, weight: w, reps, flags: [], source: 'sim',
            ...(stop && logTarget && { target: { weight: w, reps, sets: 3 } }) });
        }
        if (!stop && got[0] >= 12) w += l.step;
      }
      x += o.progress ?? 0.002;
    }
  });
  return out;
}
