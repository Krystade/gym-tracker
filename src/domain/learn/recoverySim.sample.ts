import { resolveLift } from '../lifts';
import { MUSCLES, type Muscle } from '../muscles';
import type { BodyDay } from '../body';
import type { SetEntry } from '../types';
import { rng } from './num';
import { overlap } from './tags';

// A synthetic lifter with KNOWN between-session recovery, for learn/recovery's tests. Synthetic only; no personal data.
// Within a session he tires as the capacity equation says (learn/capacity: A_same, ρ, τ_s, A_cross); each hard set leaves every
// muscle it works a deficit of β·ρ·A/(κ + reps) (ln e1RM) that decays with τ′·φ^s, s the share of that muscle's sets that session
// logged at RIR 0. A lift's capacity on a later day is cut by Σ_m u_m·D_m, u = v/Σv² (learn/recovery's reading).

export const REC_LIFTS: { name: string; start: number; step: number }[] = [
  { name: 'Bench Press', start: 230, step: 5 },
  { name: 'Incline DB Press', start: 85, step: 5 },
  { name: 'Cable Pushdown', start: 85, step: 2.5 },
  { name: 'Seated Cable Row', start: 190, step: 5 },
  { name: 'Lat Pulldown', start: 170, step: 5 },
  { name: 'DB Curl', start: 45, step: 5 },
  { name: 'Leg Press', start: 420, step: 5 },
  { name: 'DB Lateral Raise', start: 25, step: 2.5 },
];
const DAYS = [[0, 1, 2], [3, 4, 5], [6, 0, 2], [3, 4, 5, 7], [0, 1, 7], [6, 3, 5]];

export interface RecTruth {
  tau: number; phi: number; beta: number; aSame: number; rho: number; tauS: number; aCross: number; kappa: number;
  readySd: number; setSd: number; muR: number;
}
export interface RecSim {
  sessions: number;
  /** Days between sessions, drawn from (default: mostly 1–3). */
  gaps?: number[];
  /** Share of sessions taken to failure (every set logged RIR 0). */
  failFrac?: number;
  /** Share of other sets with a logged RIR. */
  pLog?: number;
  /** Share of sessions with set times. */
  timedFrac?: number;
  /**
   * Energy (learn/readiness): each session's energy, 1–5 uniform, logged on its day for the first `logged` sessions (default all),
   * moves that day's level by `slope`·(energy − 3) (ln e1RM). The draw is made for every session (slope 0 included), so the
   * rest of the log is the same at any slope or count.
   */
  energy?: { slope: number; logged?: number };
  truth?: Partial<RecTruth>;
}
export const REC_TRUTH: RecTruth = { tau: 32, phi: 8, beta: 1, aSame: 1.2, rho: 0.5, tauS: 90, aCross: 0.5, kappa: 30, readySd: 0.02, setSd: 0.6, muR: 2 };

const date = (day: number) => new Date(Date.UTC(2024, 0, 1) + day * 864e5).toISOString().slice(0, 10);

export function simulateRecovery(seed: number, o: RecSim): { entries: SetEntry[]; truth: RecTruth; body: BodyDay[] } {
  const r = rng(seed);
  const t = { ...REC_TRUTH, ...o.truth };
  const V = REC_LIFTS.map((l) => resolveLift(l.name).m!);
  const U = V.map((v) => { const n = Object.values(v).reduce((a, x) => a + (x as number) ** 2, 0); return Object.fromEntries(Object.entries(v).map(([m, x]) => [m, (x as number) / n])) as Partial<Record<Muscle, number>>; });
  const O = V.map((a) => V.map((b) => overlap(a, b)));
  let logE = REC_LIFTS.map((l) => Math.log(l.start));
  const deposits: { m: Muscle; t: number; a: number; tau: number }[] = [];
  const D = (m: Muscle, h: number) => { let s = 0; for (const d of deposits) if (d.m === m && d.t <= h) s += d.a * Math.exp(-(h - d.t) / d.tau); return s; };
  const gaps = o.gaps ?? [1, 1, 1, 2, 2, 3, 4], failFrac = o.failFrac ?? 0, pLog = o.pLog ?? 0.3, timedFrac = o.timedFrac ?? 1;
  const entries: SetEntry[] = [];
  const body: BodyDay[] = [];
  const er = rng(seed + 7919); // its own stream: energy never shifts the other draws
  let day = 0, seq = 0;
  for (let s = 0; s < o.sessions; s++) {
    day += r.pick(gaps);
    logE = logE.map((x) => x + r.normal(0, 0.004));
    let ready = r.normal(0, t.readySd);
    if (o.energy) {
      const e = (1 + Math.floor(er.next() * 5)) as 1 | 2 | 3 | 4 | 5;
      ready += o.energy.slope * (e - 3);
      if (s < (o.energy.logged ?? Infinity)) body.push({ date: date(day), energy: e });
    }
    const failing = r.next() < failFrac, timed = r.next() < timedFrac;
    let sec = Math.round(Math.min(21, Math.max(7, 17 + r.normal(0, 1.5))) * 3600);
    const done: { L: number; sec: number }[] = [];
    const today: { L: number; sec: number; reps: number; fail: boolean }[] = [];
    for (const L of r.shuffle([...DAYS[r.pick([0, 1, 2, 3, 4, 5])]])) {
      const lift = REC_LIFTS[L];
      const hour0 = day * 24 + sec / 3600;
      let def = 0;
      for (const [m, u] of Object.entries(U[L]) as [Muscle, number][]) def += u * D(m, hour0);
      const E = Math.exp(logE[L] + ready - def);
      const w = lift.step * Math.round(Math.exp(logE[L]) / (1 + 11 / t.kappa) / lift.step);
      const nset = r.pick([3, 3, 4]);
      for (let k = 0; k < nset; k++) {
        if (done.length) sec += Math.round(r.lognormal(Math.log(150), 0.3));
        let f = 0;
        for (const p of done) {
          const K = t.rho + (1 - t.rho) * Math.exp(-(sec - p.sec) / t.tauS);
          f += (p.L === L ? t.aSame : t.aCross * O[p.L][L]) * K;
        }
        const F = t.kappa * (E / w - 1) - f + r.normal(0, t.setSd);
        let reps: number, rir: number | undefined;
        if (failing) { reps = Math.max(1, Math.floor(F)); rir = 0; }
        else {
          const left = Math.max(1, Math.min(5, Math.round(r.normal(t.muR, 0.8))));
          reps = Math.max(1, Math.round(F) - left);
          if (r.next() < pLog) rir = Math.max(1, Math.min(4, Math.round(left - 0.9 + r.normal(0, 0.5))));
        }
        entries.push({
          id: `rsim|${date(day)}|${lift.name.toLowerCase()}|${k + 1}`, date: date(day), seq: seq++,
          ...(timed && { loggedAt: new Date(Date.UTC(2024, 0, 1) + day * 864e5 + sec * 1000).toISOString() }),
          exercise: lift.name, setNo: k + 1, weight: w, reps, ...(rir != null && { rir }), flags: [], source: 'sim',
        });
        done.push({ L, sec }); today.push({ L, sec, reps, fail: rir === 0 });
        sec += 35;
      }
    }
    // The session's deposits, each muscle's failure share s (by v), from its end on.
    const end = day * 24 + sec / 3600;
    for (const m of MUSCLES) {
      let sv = 0, sf = 0;
      for (const x of today) { const v = V[x.L][m] ?? 0; sv += v; if (x.fail) sf += v; }
      if (!sv) continue;
      const tau = t.tau * t.phi ** (sf / sv);
      for (const x of today) {
        const v = V[x.L][m] ?? 0;
        if (v) deposits.push({ m, t: end, a: v * t.beta * t.rho * t.aSame / (t.kappa + x.reps) * Math.exp(-(end - (day * 24 + x.sec / 3600)) / tau), tau });
      }
    }
  }
  return { entries, truth: t, body };
}

/** The same log with each session moved to another session's date (times of day kept): timing no longer says anything. */
export function shuffleSessions(entries: readonly SetEntry[], seed: number): SetEntry[] {
  const r = rng(seed);
  const dates = [...new Set(entries.map((e) => e.date))].sort();
  const perm = r.shuffle([...dates]);
  const to = new Map(dates.map((d, i) => [d, perm[i]]));
  return entries.map((e) => {
    const nd = to.get(e.date)!, shift = Date.parse(`${nd}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`);
    return { ...e, id: e.id.replace(e.date, nd), date: nd, ...(e.loggedAt && { loggedAt: new Date(Date.parse(e.loggedAt) + shift).toISOString() }) };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
}
