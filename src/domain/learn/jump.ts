import { liftKey } from '../ids';
import { exerciseNames, perLog, sessionsFor } from '../stats';
import type { SetEntry } from '../types';
import { fatigueOf, type Core } from './capacity';
import { truncBelow } from './num';
import { pool } from './pool';
import { liftSimilarity } from './tags';

// Item 02: how many reps the first heavier session loses, learned from his own weight increases (02-reps-after-increase).
//
// (b) Method: every increase between two consecutive sessions of a lift at most 21 days apart (owner, 2026-10-20), first
// working set at the top weight in each (the fresh one), not pain-flagged, bodyweight or a hold, ≤ 20 reps, and both on the
// same pulley. The drop is the fatigue-adjusted difference (r_A + Δ_A) − (r_B + Δ_B), with Δ the learning core's session
// fatigue for that set (other lifts before it, its position), so a lift done later in the heavier session isn't read as a
// bigger drop. A heavier set that stopped exactly at its target is censored: it could have done more, so its drop is an upper
// bound (Tobit, by expectation–maximisation). Per-lift means pooled person → similar lifts → lift (learn/pool).
//
// Why a drop and not a reps–load curve: on his log the first-set drop is about 2 reps whatever the jump (Epley predicts
// 2.5–8.8), and in a replay a learned drop beat both today's repMin and Epley (scratch backtest, private). The curve is the
// learning core's job (item 04); this is the number the next target needs.

/** (a) Prior on the drop: Epley's loss for one 5–10 % rung at 10–15 reps, ≈ 2.5 reps; between-person SD 2.5 reps (Nuzzo 2024, Sports Med 54:303). */
export const DROP_PRIOR = { mean: 2.5, personSd: 2.5 } as const;
/** (c) Prior scale of how far one lift's drop sits from the person's: shapes the pooling prior only (the pool learns the spread). */
const LIFT_SD = 1.5;
/** (c) Per-jump noise before his own is known, worth 4 jumps; (b) then his residual spread. */
const NOISE = { sd: 2.5, k: 4 } as const;
/** (b, owner) Consecutive sessions further apart than this aren't a jump: strength moved in between. */
export const MAX_GAP_DAYS = 21;

export interface Jump { lift: string; date: string; from: number; to: number; drop: number; censored: boolean }
export interface Drop {
  /** Reps fewer per set at the next rung: the posterior mean, and its SD. */
  mean: number; sd: number;
  /** This lift's jumps; all jumps behind the person's value. */
  n: number; all: number;
}

const ok = (e: SetEntry) => !e.flags.some((f) => f === 'warmup' || f === 'partial' || f === 'pain' || f === 'bodyweight' || f === 'hold' || f === 'cardio')
  && e.reps != null && e.reps > 0 && e.reps <= 20 && e.weight > 0;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Every qualifying increase in the log, oldest first, fatigue-adjusted with `core` when it scores both sets. */
export function jumpsOf(entries: readonly SetEntry[], core: Core | null): Jump[] {
  const out: Jump[] = [];
  const delta = (e: SetEntry) => { const f = core?.features.get(e.id); return f ? fatigueOf(core!, liftKey(e.exercise), f) : 0; };
  for (const name of exerciseNames(entries as SetEntry[])) {
    const ss = [...sessionsFor(entries as SetEntry[], name)].reverse().map((x) => ({ date: x.date, w: x.sets.filter(ok) })).filter((x) => x.w.length);
    for (let i = 1; i < ss.length; i++) {
      const A = ss[i - 1], B = ss[i];
      if (days(A.date, B.date) > MAX_GAP_DAYS) continue;
      const ta = Math.max(...A.w.map((e) => e.weight)), tb = Math.max(...B.w.map((e) => e.weight));
      if (!(tb > ta)) continue;
      const a = A.w.find((e) => e.weight === ta)!, b = B.w.find((e) => e.weight === tb)!;
      if (a.flags.includes('double_pulley') !== b.flags.includes('double_pulley')) continue;
      const censored = b.rir == null && b.target?.weight === tb && b.reps === b.target.reps;
      out.push({ lift: name, date: B.date, from: ta, to: tb, drop: (a.reps! + delta(a)) - (b.reps! + delta(b)), censored });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

/** The pooled drop per lift from a list of jumps; null when there are none. */
export function dropsFrom(jumps: readonly Jump[]): ((exercise: string) => Drop) | null {
  if (!jumps.length) return null;
  const keyOf = jumps.map((j) => liftKey(j.lift));
  const d = jumps.map((j) => j.drop);
  let fit: ReturnType<typeof pool> | null = null;
  let s2 = NOISE.sd ** 2;
  // EM: censored drops are replaced by their expectation below the observed bound, given the current lift estimate.
  for (let round = 0; round < 4; round++) {
    const by = new Map<string, number[]>();
    d.forEach((x, i) => { const k = keyOf[i]; const xs = by.get(k); if (xs) xs.push(x); else by.set(k, [x]); });
    const means = new Map([...by].map(([k, xs]) => [k, xs.reduce((a, b) => a + b, 0) / xs.length]));
    // (b) His per-jump spread: within-lift residuals, shrunk to the prior with the weight of NOISE.k jumps.
    let rss = 0, dof = 0;
    for (const [k, xs] of by) { const m = means.get(k)!; for (const x of xs) rss += (x - m) ** 2; dof += xs.length - 1; }
    s2 = (NOISE.k * NOISE.sd ** 2 + rss) / (NOISE.k + dof);
    fit = pool([...by].map(([key, xs]) => ({ key, est: means.get(key)!, v: s2 / xs.length })), liftSimilarity,
      { mean: DROP_PRIOR.mean, personSd: DROP_PRIOR.personSd, liftSd: LIFT_SD });
    const s = Math.sqrt(s2 + 0);
    jumps.forEach((j, i) => {
      if (!j.censored) return;
      const mu = fit!.lift(keyOf[i]).mean;
      d[i] = -truncBelow(-mu, s, -j.drop).mean; // drop ≤ observed
    });
  }
  const counts = new Map<string, number>();
  for (const k of keyOf) counts.set(k, (counts.get(k) ?? 0) + 1);
  const f = fit!;
  return (exercise) => { const k = liftKey(exercise); const p = f.lift(k); return { mean: p.mean, sd: p.sd, n: counts.get(k) ?? 0, all: jumps.length }; };
}

/** The learned drop for each lift of this log (core: the learning core's fit of the same log, for the fatigue adjustment). */
export const dropsOf: (entries: readonly SetEntry[], core: Core | null) => ((exercise: string) => Drop) | null = (() => {
  const by = perLog(() => ({ core: null as Core | null, v: undefined as ReturnType<typeof dropsFrom> | undefined }));
  return (entries, core) => {
    const hit = by(entries);
    if (hit.v === undefined || hit.core !== core) { hit.v = dropsFrom(jumpsOf(entries, core)); hit.core = core; }
    return hit.v;
  };
})();
