import { resolveLift } from '../lifts';
import type { SetEntry } from '../types';
import { BODY_SHARE } from './bodyweight';
import { rng } from './num';
import { overlap } from './tags';

// A synthetic lifter with KNOWN strength who trains a bodyweight lift beside a loaded one that shares its muscles (item 14), for
// the learning core's bodyweight tests. Reps to failure follow the capacity equation (learn/capacity) at the lift's share of a
// body mass the app is never told; sets are logged with the lifter's usual reps in reserve. Synthetic only; no personal data.

export interface BodyTruth {
  /** Body mass (lb), and the bodyweight lift's e1RM (lb, the body included) at the start. */
  mass: number; E: number;
  /** The loaded lift's e1RM (lb) at the start, and its weight step. */
  withE: number; step: number;
  /** ln e1RM per week, both lifts. */
  slope: (week: number) => number;
  kappa: number; aSame: number; aCross: number; gamma: number; tau: number; rho: number;
  /** Reps left in reserve on an ordinary set; day-to-day readiness SD (ln); set-to-set noise SD (reps). */
  habit: number; readySd: number; setSd: number;
}
export interface BodySimOptions {
  sessions: number;
  /** The bodyweight lift (a BODY_SHARE name) and the loaded one beside it. */
  lift?: string; with?: string;
  /** The bodyweight lift after the loaded one (tired by it), before it, or alternating. */
  order?: 'after' | 'before' | 'mixed';
  /** On every other session, each bodyweight set stops at this many reps by choice when it could do more, with that target logged. */
  targets?: number;
  /** After the bodyweight sets, two with help (15 and 30 lb), logged as signed weights or (`'note'`) as older imports kept them. */
  assisted?: 'weight' | 'note';
  /** On every other session, a first set with 25 lb added; the bodyweight sets after it stop at 8 by choice (no target logged). */
  weightedFirst?: boolean;
  /** Days between sessions: 3 or 4 by default. */
  gap?: () => number;
  truth?: Partial<BodyTruth>;
}
/** Per session date: the bodyweight lift's true level that day in units of body mass, ln(E/mass), readiness removed. */
export type Levels = Map<string, number>;

const iso = (day: number, t: number) => new Date(Date.UTC(2025, 0, 6, 17, 0, 0) + day * 864e5 + t * 1000).toISOString();
const date = (day: number) => new Date(Date.UTC(2025, 0, 6) + day * 864e5).toISOString().slice(0, 10);
/** The time between one set and the next (s). */
export const SET_GAP = 180;

export function bodyLog(seed: number, o: BodySimOptions): { entries: SetEntry[]; truth: BodyTruth; levels: Levels; share: number } {
  const r = rng(seed);
  const truth: BodyTruth = {
    mass: 180, E: 250, withE: 230, step: 5, slope: () => 0.003,
    kappa: 30, aSame: 0.9, aCross: 0.6, gamma: 0.08, tau: 75, rho: 0.25, habit: 2, readySd: 0.03, setSd: 0.7, ...o.truth,
  };
  const lift = o.lift ?? 'Forward-Lean Dips', other = o.with ?? 'Bench Press';
  const f = BODY_SHARE[lift];
  const o12 = overlap(resolveLift(other).m, resolveLift(lift).m), o21 = overlap(resolveLift(lift).m, resolveLift(other).m);
  let x = Math.log(truth.E), xw = Math.log(truth.withE);
  const entries: SetEntry[] = [];
  const levels: Levels = new Map();
  let day = 0, seq = 0;
  for (let s = 0; s < o.sessions; s++) {
    const step = o.gap ? o.gap() : r.pick([3, 4]);
    day += step;
    // Both lifts move by the week's slope, pro rata for the days since the last session.
    x += truth.slope(Math.floor(day / 7)) * step / 7; xw += truth.slope(Math.floor(day / 7)) * step / 7;
    const ready = r.normal(0, truth.readySd);
    levels.set(date(day), x - Math.log(truth.mass));
    const ww = truth.step * Math.round(Math.exp(xw) / (1 + 12 / truth.kappa) / truth.step);
    const bodyFirst = o.order === 'before' || (o.order === 'mixed' && s % 2 === 0);
    const even = s % 2 === 0, weighted = !!o.weightedFirst && even, aimed = o.targets != null && even;
    // The day's sets in order: [lift name, added lb, how it stops].
    type Plan = { name: string; added: number; stop: 'habit' | 'target' | 'easy' };
    const bw: Plan[] = [
      ...(weighted ? [{ name: lift, added: 25, stop: 'habit' as const }] : []),
      ...[0, 1, 2].map((): Plan => ({ name: lift, added: 0, stop: weighted ? 'easy' : aimed ? 'target' : 'habit' })),
      ...(o.assisted ? [-15, -30].map((a): Plan => ({ name: lift, added: a, stop: 'habit' })) : []),
    ];
    const loaded: Plan[] = [0, 1, 2].map(() => ({ name: other, added: ww, stop: 'habit' }));
    const plan = bodyFirst ? [...bw, ...loaded] : [...loaded, ...bw];
    const done: { body: boolean; t: number }[] = [];
    plan.forEach((p, i) => {
      const t = i * SET_GAP, body = p.name === lift;
      const K = (tj: number) => truth.rho + (1 - truth.rho) * Math.exp(-(t - tj) / truth.tau);
      let same = 0, cross = 0, others = 0;
      for (const d of done) { if (d.body === body) same += K(d.t); else { cross += (body ? o12 : o21) * K(d.t); others++; } }
      const E = Math.exp((body ? x : xw) + ready), load = body ? f * truth.mass + p.added : p.added;
      const F = truth.kappa * (E / load - 1) - (truth.aSame * same + truth.aCross * cross + truth.gamma * others) + r.normal(0, truth.setSd);
      let reps = Math.max(1, Math.round(F) - Math.max(0, Math.round(r.normal(truth.habit, 1))));
      if (p.stop === 'target') reps = Math.max(1, Math.min(o.targets!, Math.round(F)));
      if (p.stop === 'easy') reps = Math.min(8, Math.max(1, Math.round(F)));
      const weight = body && p.added < 0 && o.assisted === 'note' ? 0 : p.added;
      const setNo = entries.filter((e) => e.date === date(day) && e.exercise === p.name).length + 1;
      entries.push({
        id: `body|${date(day)}|${p.name.toLowerCase()}|${setNo}`, date: date(day), seq: seq++, loggedAt: iso(day, t), exercise: p.name, setNo, weight, reps,
        flags: weight <= 0 && body ? ['bodyweight'] : [], source: 'sim',
        ...(weight === 0 && p.added < 0 && { note: `assisted ${p.added} lb` }),
        ...(p.stop === 'target' && { target: { weight: 0, reps: o.targets!, sets: 3 } }),
      });
      done.push({ body, t });
    });
  }
  return { entries, truth, levels, share: f };
}
