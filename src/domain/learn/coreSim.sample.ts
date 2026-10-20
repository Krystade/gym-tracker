import { resolveLift } from '../lifts';
import type { SetEntry } from '../types';
import { rng, type Rng } from './num';
import { overlap } from './tags';

// A synthetic lifter with KNOWN session-fatigue parameters, for the learning core's recovery tests: a TypeScript port of the
// stage-0 prototype (scratchpad core_sim.py). Synthetic only; no personal data. Ten catalog lifts, five day templates, the
// order shuffled each day; reps to failure follow the capacity equation (learn/capacity) and are logged with the lifter's
// usual reps in reserve.

export const SIM_LIFTS: { name: string; start: number; step: number }[] = [
  { name: 'Bench Press', start: 230, step: 5 },
  { name: 'Incline DB Press', start: 85, step: 5 },
  { name: 'Seated Cable Row', start: 190, step: 5 },
  { name: 'Lat Pulldown', start: 170, step: 5 },
  { name: 'DB Curl', start: 45, step: 5 },
  { name: 'Cable Curl', start: 80, step: 2.5 },
  { name: 'Preacher Curl', start: 40, step: 5 },
  { name: 'Cable Pushdown', start: 85, step: 2.5 },
  { name: 'DB Lateral Raise', start: 25, step: 2.5 },
  { name: 'Leg Press', start: 420, step: 5 },
];
const DAYS = [[0, 1, 7, 8], [2, 3, 4, 5, 6], [9, 7, 8, 4], [1, 0, 2, 3, 8], [4, 5, 6, 7, 3]];

export interface Truth {
  aSame: number; aLift: number[]; aCross: number; gamma: number; tau: number; rho: number;
  kappa: number[]; muR: number; b: number; readySd: number; setSd: number;
}
export interface SimOptions {
  sessions: number; timedFrac?: number; pLog?: number; gapMedian?: number; gapSd?: number;
  /** Stop each set at a target (double progression, 8–12 or 10–15) instead of at the habitual RIR: censored sets. */
  targets?: boolean;
  /** Drop the last set's weight by 15–25 % (a back-off set): the same day's strength at two loads, which identifies κ. */
  backoff?: boolean;
  truth?: Partial<Truth>;
}
/** Per set id: the true fresh e1RM that day (readiness removed), the true reps to failure, and its fatigue Δ. */
export interface SetTruth { E: number; F: number; fatigue: number; kappa: number; fSame: number; fCross: number }

export function defaultTruth(r: Rng): Truth {
  const uL = SIM_LIFTS.map(() => r.normal(0, 0.12));
  return {
    aSame: 0.9, aLift: SIM_LIFTS.map(() => 0.9 + r.normal(0, 0.3)), aCross: 0.6, gamma: 0.08, tau: 75, rho: 0.25,
    kappa: uL.map((u) => 30 * Math.exp(0.1 + u)), muR: 1.5, b: 0.9, readySd: 0.03, setSd: 0.7,
  };
}

const iso = (day: number, t: number) => new Date(Date.UTC(2024, 0, 1, 17, 0, 0) + day * 864e5 + t * 1000).toISOString();
const date = (day: number) => new Date(Date.UTC(2024, 0, 1) + day * 864e5).toISOString().slice(0, 10);

export function simulate(seed: number, o: SimOptions): { entries: SetEntry[]; truth: Truth; sets: Map<string, SetTruth> } {
  const r = rng(seed);
  const truth = { ...defaultTruth(r), ...o.truth };
  const V = SIM_LIFTS.map((l) => resolveLift(l.name).m);
  const O = V.map((vj) => V.map((vs) => overlap(vj, vs)));
  let logE = SIM_LIFTS.map((l) => Math.log(l.start));
  const entries: SetEntry[] = [];
  const sets = new Map<string, SetTruth>();
  const timedFrac = o.timedFrac ?? 1, pLog = o.pLog ?? 0.3, gapMedian = o.gapMedian ?? 240, gapSd = o.gapSd ?? 0.45;
  // Double progression state per lift (targets mode): the working weight and each set's target.
  const work = SIM_LIFTS.map((l, i) => ({ w: l.step * Math.round(Math.exp(logE[i]) / (1 + 10 / truth.kappa[i]) / l.step), reps: [8, 8, 8, 8] }));
  let day = 0, seq = 0;
  for (let d = 0; d < o.sessions; d++) {
    day += r.pick([2, 3, 4]);
    logE = logE.map((x) => x + 0.002 * 3 / 7 + r.normal(0, 0.008));
    const ready = r.normal(0, truth.readySd);
    const tmpl = r.shuffle([...DAYS[d % DAYS.length]]);
    const timed = r.next() < timedFrac;
    let t = 0;
    const done: { L: number; t: number }[] = [];
    for (const L of tmpl) {
      const lift = SIM_LIFTS[L];
      const E = Math.exp(logE[L] + ready);
      // The weight comes from the plan (the latent level), not from the day's readiness, which nobody sees before lifting.
      // (The prototype chose it from the day's E, so heavier days cost no reps; that hides the reps–load slope.)
      const w0 = o.targets ? work[L].w : lift.step * Math.round(Math.exp(logE[L]) / (1 + r.uniform(10, 14) / truth.kappa[L]) / lift.step);
      const nset = r.pick([2, 3, 3, 4]);
      const range = L >= 4 && L <= 8 ? [10, 15] : [8, 12];
      const got: number[] = [];
      for (let k = 0; k < nset; k++) {
        const w = o.backoff && k === nset - 1 && nset > 1 ? lift.step * Math.max(1, Math.round(w0 * (1 - r.uniform(0.15, 0.25)) / lift.step)) : w0;
        if (done.length) t += r.lognormal(Math.log(gapMedian), gapSd);
        const K = (tj: number) => truth.rho + (1 - truth.rho) * Math.exp(-(t - tj) / truth.tau);
        let fSame = 0, fCross = 0, fSys = 0;
        for (const p of done) {
          if (p.L === L) fSame += K(p.t);
          else { fCross += O[p.L][L] * K(p.t); fSys += 1; }
        }
        const fresh = truth.kappa[L] * (E / w - 1);
        const fatigue = truth.aLift[L] * fSame + truth.aCross * fCross + truth.gamma * fSys;
        const F = fresh - fatigue + r.normal(0, truth.setSd);
        const rir = Math.max(0, Math.min(5, Math.round(r.normal(truth.muR, 1))));
        let reps = Math.max(1, Math.round(F) - rir);
        let target: SetEntry['target'];
        if (o.targets) {
          const tg = work[L].reps[Math.min(k, 3)];
          target = { weight: w, reps: tg, sets: nset };
          // Stop at the target when there are reps to spare; else as many as there are (near failure).
          reps = Math.max(1, Math.min(tg, Math.round(F)));
        }
        const logged = !o.targets && r.next() < pLog;
        const k4 = logged ? Math.max(0, Math.min(4, Math.round(rir - truth.b + r.normal(0, 0.8)))) : undefined;
        const id = `sim|${date(day)}|${lift.name.toLowerCase()}|${k + 1}`;
        entries.push({
          id, date: date(day), seq: seq++, ...(timed && { loggedAt: iso(day, t) }), exercise: lift.name, setNo: k + 1,
          weight: w, reps, ...(k4 != null && { rir: k4 }), flags: [], source: 'sim', ...(target && { target }),
        });
        sets.set(id, { E: E / Math.exp(ready), F: F + truth.kappa[L] * (E / Math.exp(ready) / w - 1) - fresh, fatigue, kappa: truth.kappa[L], fSame, fCross });
        got.push(reps);
        done.push({ L, t });
        t += 40;
      }
      if (o.targets) {
        // Double progression: every set at the top of the range → +1 step; else +1 rep on each set short of it.
        const top = range[1];
        if (got.every((x) => x >= top)) { work[L].w += lift.step; work[L].reps = [range[0], range[0], range[0], range[0]]; }
        else work[L].reps = work[L].reps.map((x, i) => Math.min(top, (got[i] ?? x) >= x ? x + 1 : x));
      }
    }
  }
  return { entries, truth, sets };
}
