import type { SetEntry } from '../types';
import type { Core } from './capacity';
import { simulate, SIM_LIFTS } from './coreSim.sample';
import { rng } from './num';
import type { Pace } from './pace';

// Synthetic logs and a numeric digest of what the learning core fits to them, for the equivalence test (capacity.equiv.test)
// and its golden values (capacity.golden: recorded from the stage-1 implementation, e9402be). Synthetic only; no personal data.

/** A log with every kind of set the core reads differently: warm-ups, pain, "4+", unsure and test RIR, bodyweight, partials,
 * past-30 reps, a lift spelt two ways, an untimed set in a timed day, a hold, cardio, a duplicate time, an unknown lift; shuffled. */
export function messy(seed: number, es: readonly SetEntry[]): SetEntry[] {
  const r = rng(seed * 77);
  const out = es.map((e) => {
    const x: SetEntry = { ...e, flags: [...e.flags] };
    const u = r.next();
    if (u < 0.03) x.flags.push('warmup');
    else if (u < 0.05) x.flags.push('pain');
    else if (u < 0.07) x.rir = 4;
    else if (u < 0.09) { x.rir = 1; x.flags.push('unsure'); }
    else if (u < 0.10) { x.rir = 0; x.flags.push('test'); }
    else if (u < 0.11) x.flags.push('bodyweight');
    else if (u < 0.12) x.flags.push('partial');
    else if (u < 0.13) x.exercise = 'bench  press';
    else if (u < 0.14) x.reps = 40;
    if (r.next() < 0.02) delete x.loggedAt;
    return x;
  });
  const d = out[out.length >> 1];
  out.push({ ...d, id: `${d.id}|hold`, exercise: 'Plank', reps: 60, flags: [] });
  out.push({ ...d, id: `${d.id}|cardio`, exercise: 'Treadmill', reps: 20, flags: [] });
  out.push({ ...d, id: `${d.id}|dup`, setNo: 9, seq: d.seq + 0.5 });
  out.push({ ...d, id: `${d.id}|new`, exercise: 'Mystery Lift', weight: 50, reps: 10, flags: [] });
  return r.shuffle(out);
}

/** The scenarios, each a log and the fit's options. */
export const SCENARIOS: Record<string, () => { log: SetEntry[]; censor?: boolean }> = {
  plain: () => ({ log: simulate(3, { sessions: 60 }).entries }),
  backoff: () => ({ log: simulate(4, { sessions: 150, backoff: true }).entries }),
  targets: () => ({ log: simulate(5, { sessions: 120, targets: true, backoff: true }).entries }),
  uncensored: () => ({ log: simulate(5, { sessions: 120, targets: true, backoff: true }).entries, censor: false }),
  untimed: () => ({ log: simulate(6, { sessions: 80, timedFrac: 0.5 }).entries }),
  messy: () => ({ log: messy(7, simulate(7, { sessions: 100, backoff: true }).entries) }),
  fiveYears: () => ({ log: simulate(11, { sessions: 1000 }).entries }),
};

const sum = (xs: Iterable<number>) => { let s = 0; for (const x of xs) s += x; return s; };

/** Every number the fit reports, condensed: the person level, the grid's weights, each lift, the features, and the pace. */
export function digest(c: Core, p: Pace | null): number[] {
  const est = (e: { mean: number; sd: number }) => [e.mean, e.sd];
  const out = [
    c.sets, c.obs, c.sessions, c.timed, ...est(c.aSame), ...est(c.aCross), ...est(c.gamma), ...est(c.tau), c.tau.lo, c.tau.hi,
    ...est(c.rho), ...est(c.habit), ...est(c.bias), c.noise, c.gap, c.drift, c.fit.tau, c.fit.kTau, c.fit.rho, ...c.fit.theta,
    c.cells.length, ...c.cells.map((x) => x.w),
    ...[0, 1, 2].map((j) => sum(c.cells.map((x) => x.w * x.theta[j]))),
    ...Array.from({ length: 9 }, (_, j) => sum(c.cells.map((x) => x.w * x.cov[j]))),
  ];
  for (const l of [...c.lifts.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    out.push(...est(l.kappa), ...est(l.aSame), l.sessions, l.sets, l.level.length, sum(l.level.map((x) => x.x)),
      sum(l.level.map((x) => x.sd)), sum(l.level.map((x) => x.day)), l.level[0]?.x ?? -1, l.level.at(-1)?.x ?? -1);
  }
  const f = [...c.features.values()];
  out.push(f.length, sum(f.map((x) => x.nS)), sum(f.map((x) => x.nC)), sum(f.map((x) => x.nY)), sum(f.map((x) => sum(x.eS))), sum(f.map((x) => sum(x.eC))));
  if (!p) out.push(-1);
  else {
    out.push(p.gap, p.logSd, p.n);
    for (const name of [...SIM_LIFTS.map((l) => l.name), 'Mystery Lift']) { const q = p.lift(name); out.push(q.gap, q.sd, q.n); }
  }
  return out;
}
