import { addDays } from './analytics';
import { isHoldLift } from './care';
import { liftKey } from './ids';
import { coreBefore, testSd } from './learn';
import { floorRung, ladderOf, nextRung } from './learn/ladder';
import { bodyRepsSeries, bodyStrengthOf, levelSeries, strengthOf, weightFor, type BodyStrength, type Strength } from './learn/strength';
import { dayOf, MAX_REPS } from './learn/capacity';
import { liftSets, type SeriesPoint, learnable } from './stats';
import type { SetEntry } from './types';
import { isCardio } from './cardio';

export type Formula = 'epley' | 'wd';
const KG = 0.45359237;

/**
 * Epley below 10 kg, the weight-dependent formula above 30 kg, and a linear blend between. The weight-dependent
 * formula's denominator shrinks toward zero at light loads (a 10 lb raise × 12 would "estimate" 27 lb), and a hard
 * cutoff makes the curve jump, which breaks the rep-max inversion. The blend keeps it continuous and increasing.
 */
export function oneRm(f: Formula, w: number, r: number): number | null {
  if (!(w > 0) || !(r >= 1) || r > 30) return null;
  if (r === 1) return w;
  const epley = w * (1 + r / 30);
  if (f === 'epley') return epley;
  const kg = w * KG;
  const t = Math.min(1, Math.max(0, (kg - 10) / 20));
  if (t === 0) return epley;
  const wd = w * (1 + Math.pow(r - 1, 0.85) / (-2.55 + 4.58 * Math.log(kg)));
  return (1 - t) * epley + t * wd;
}

export function weightForReps(f: Formula, oneRmLb: number, r: number): number {
  if (r <= 1) return oneRmLb;
  let lo = 0.01, hi = oneRmLb;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if ((oneRm(f, mid, r) ?? 0) > oneRmLb) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

/**
 * A lift's strength on `date` from everything logged up to and including it (learn/strength: the learning core's fatigue-adjusted
 * level, with its uncertainty); null when the core has no level for it (a hold, bodyweight only, cardio, nothing logged).
 */
export function strength(entries: readonly SetEntry[], exercise: string, date: string): Strength | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const core = coreBefore(entries, addDays(date, 1));
  return core && strengthOf(core, exercise, date);
}

/** Item 14: a bodyweight lift's level on `date`, in body mass, read as the reps it leaves fresh at bodyweight; null without one. */
export function bodyStrength(entries: readonly SetEntry[], exercise: string, date: string): BodyStrength | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const core = coreBefore(entries, addDays(date, 1));
  return core && bodyStrengthOf(core, exercise, date);
}

/** Item 14: those fresh reps at bodyweight at each session up to `date`, oldest first, as chart points (the value in `e1rm`). */
export function bodyRepsPoints(entries: readonly SetEntry[], exercise: string, date: string): SeriesPoint[] {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const core = coreBefore(entries, addDays(date, 1));
  return core ? bodyRepsSeries(core, exercise).map((p) => ({ date: p.date, e1rm: p.reps, pr: false })) : [];
}

/** The lift's level at each session up to `date`, oldest first, as chart points (no records: a level isn't a set); null without one. */
export function strengthSeries(entries: readonly SetEntry[], exercise: string, date: string): SeriesPoint[] | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const core = coreBefore(entries, addDays(date, 1));
  const pts = core ? levelSeries(core, exercise) : [];
  return pts.length ? pts.map((p) => ({ date: p.date, e1rm: p.e1rm, pr: false })) : null;
}

/** (a) The reps a test reads the level best at: the RIR error model (04 §3: 0.5 reps, +0.3 per rep past 10) over κ + reps is least at 10. */
export const TEST_REPS = 10;

/**
 * Item 05, as a cadence (owner, 2026-11-22): a lift's test is due every TEST_EVERY_DAYS, counted from its last test, or from its
 * first session when it has never been tested. Nothing else holds it back: not pain, not a light week, not a lift's first 2
 * sessions (a tap on "Not now" puts it off 2 weeks). One test a day at most (a: sets to failure need longer recovery, Morán-Navarro
 * 2017), and only where the app can say what to lift: a level to read the weight from (learn/strength), never a hold or cardio.
 * `weight`: the loadable weight for TEST_REPS to failure; `jump`: today's target is an increase, and its first set at the new
 * weight is the test (no extra set). `u`: the lift's uncertainty (its level's SD on the day, grown by drift and layoffs, with the
 * systematic SD only tests fix: learn/strength), and `after`: u once the test is in (u·σ/√(u² + σ²), σ: what one test reads the
 * level to, learn testSd). `body` (item 14, a bodyweight lift): the test is a set at bodyweight (`weight` 0) to failure, and its
 * uncertainty in reps. `since`: the day the cadence counts from, `tested` whether that was a test, `days` how long ago it was.
 */
export interface TestDue {
  weight: number; reps: number; u: number; after: number; jump: boolean; body?: { u: number; after: number };
  since: string; tested: boolean; days: number;
}
/** A test every this many days (owner, 2026-11-21: 4 weeks, down from 6; 2026-11-22: a plain cadence). */
export const TEST_EVERY_DAYS = 28;

/** `st`: the lift's settings (a typed increment wins over the learned ladder); `target`: today's target, when known. `every`: days between tests. */
export function testDue(entries: readonly SetEntry[], exercise: string, today: string, st?: { increment: number },
  target?: { kind: string; weight: number | null } | null, every = TEST_EVERY_DAYS): TestDue | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  if (isCardio(exercise) || isHoldLift(exercise, entries)) return null;
  if (entries.some((e) => e.date === today && e.flags.includes('test'))) return null;
  const when = testClock(entries, exercise, today);
  if (!when) return null;
  const days = dayOf(today) - dayOf(when.since);
  if (days < every) return null;
  const core = coreBefore(entries, addDays(today, 1));
  if (!core) return null;
  const clock = { since: when.since, tested: when.tested, days };
  // Item 14: a bodyweight lift has one load, its share of the body, so its test is a set at bodyweight to failure: about the reps
  // its level leaves fresh, when that is a set the core reads (1 to MAX_REPS).
  const b = bodyStrengthOf(core, exercise, today);
  if (b) {
    const reps = Math.round(b.reps);
    if (reps < 1 || reps > MAX_REPS) return null;
    const sb = testSd(core, liftKey(exercise), reps);
    const after = b.u * sb / Math.hypot(b.u, sb), perU = b.repsSd / b.u;
    return { weight: 0, reps, u: b.u, after, jump: false, body: { u: b.repsSd, after: after * perU }, ...clock };
  }
  const s = strengthOf(core, exercise, today);
  if (!s) return null;
  // The loadable weight either side of the one for TEST_REPS (the learned ladder; a typed increment wins), whichever reads the
  // level more precisely at the reps it should take.
  const want = weightFor(s, TEST_REPS);
  const lad = st && st.increment !== 5 ? null : ladderOf(entries, exercise);
  const inc = st?.increment ?? 5;
  const lo = lad ? floorRung(lad, want) : Math.floor(want / inc + 1e-9) * inc;
  const hi = lad ? nextRung(lad, lo) : lo + inc;
  const repsAt = (w: number) => Math.round(s.kappa * (s.e1rm / w - 1));
  const sdAt = (w: number) => (w > 0 && repsAt(w) >= 1 && repsAt(w) <= MAX_REPS ? testSd(core, liftKey(exercise), repsAt(w)) : Infinity);
  const weight = sdAt(hi) < sdAt(lo) ? hi : lo;
  if (!Number.isFinite(sdAt(weight))) return null;
  const sigma = sdAt(weight), after = s.u * sigma / Math.hypot(s.u, sigma);
  // Today's increase is the test when it at least halves what the app doesn't know (u above what it reads the level to, as item
  // 05 first had it): the same test, without an extra set.
  if (target?.kind === 'increase' && target.weight != null && target.weight > 0 && s.u > sdAt(target.weight)) {
    const jsd = sdAt(target.weight);
    return { weight: target.weight, reps: repsAt(target.weight), u: s.u, after: s.u * jsd / Math.hypot(s.u, jsd), jump: true, ...clock };
  }
  return { weight, reps: repsAt(weight), u: s.u, after, jump: false, ...clock };
}

/** Why it's due, said plainly (owner, 2026-11-22): the cadence, and where it counts from. */
export function testWhy(d: Pick<TestDue, 'tested' | 'days'>): string {
  const w = Math.floor(d.days / 7), ago = `${w} week${w === 1 ? '' : 's'} ago`;
  return `A test every ${TEST_EVERY_DAYS / 7} weeks, whatever the week: ${d.tested ? `your last was ${ago}` : `you started this lift ${ago} and haven’t tested it yet`}.`;
}

/** The day a lift's test cadence counts from: its last test, else its first session (a working set with reps); null: never done. */
function testClock(entries: readonly SetEntry[], exercise: string, today: string): { since: string; tested: boolean } | null {
  let first: string | null = null, last: string | null = null;
  for (const e of liftSets(entries, exercise)) {
    if (e.date > today || e.reps == null || e.flags.includes('warmup')) continue;
    if (first == null || e.date < first) first = e.date;
    if (e.flags.includes('test') && (last == null || e.date > last)) last = e.date;
  }
  return last ? { since: last, tested: true } : first ? { since: first, tested: false } : null;
}
