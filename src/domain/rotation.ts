import { addDays } from './analytics';
import { isCardio } from './cardio';
import { isHoldLift, similarity } from './care';
import { VARIATIONS, type Pattern } from './catalog';
import { liftKey } from './ids';
import { resolveLift } from './lifts';
import { MUSCLES, muscleVector, type Muscle } from './muscles';
import type { Program } from './program';
import { coreBefore } from './learn';
import { aheadVar, dayOf, KAPPA_PRIOR, type Core } from './learn/capacity';
import { floorRung, ladderOf } from './learn/ladder';
import { strengthOf } from './learn/strength';
import { addedLoad, bodyShare } from './learn/bodyweight';
import { painRisk } from './learn/pain';
import { flatness, REACCLIMATION, runIndex, type Flatness } from './learn/trend';
import { isLight, systemic } from './learn/deload';
import type { BodyDay } from './body';
import { painShaped, spillOver } from './painPlan';
import { isProgressionSet, isWorking, type ExerciseSettings } from './progression';
import { renameInProgram } from './rename';
import { e1rm, exerciseNames, sameExercise, sessionsFor, learnable } from './stats';
import type { SetEntry } from './types';

// Rotating a plateaued lift to another variation of the same movement (round 13). Six movement patterns, a few variations
// each: keep a variation while it progresses; once it has stalled for a couple of weeks, move to the next one in the same
// pattern, aimed at the same muscles. Strength carries over, so coming back round to the first one finds you stronger.
// Nothing here changes a thing by itself: Today and the lift's screen offer the switch, and a tap takes it.

const key = liftKey;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Which of the six movement patterns a lift is (see resolveLift); null for anything outside them: isolation, holds, cardio. */
export const patternOf = (name: string): Pattern | null => resolveLift(name).p;

/** The muscle a lift trains most (the first at its top weight in muscles.ts): what "the same muscle bias" compares. */
export function mainMuscle(name: string): Muscle | null {
  const v = muscleVector(name);
  if (!v) return null;
  let best: Muscle | null = null;
  for (const m of MUSCLES) if ((v[m] ?? 0) > (best ? v[best] ?? 0 : 0)) best = m;
  return best;
}

/** A muscle trained at this much or more is part of a lift's bias, beside its main muscle. */
const BIAS = 0.75;
/**
 * A lift's bias: its main muscle, then any other it trains at ¾ or more (muscles.ts order). A chin-up is lats and biceps; a
 * pull-up, lats alone. Same bias is what a rotation keeps. Empty for a lift muscles.ts can't place.
 */
export function biasOf(name: string): Muscle[] {
  const v = muscleVector(name), main = mainMuscle(name);
  if (!v || !main) return [];
  return [main, ...MUSCLES.filter((m) => m !== main && (v[m] ?? 0) >= BIAS)];
}

/** A session is judged against the up-to-3 sessions before it within 6 weeks; with none (a first session, a break), it's a fresh start. */
const LOOKBACK = 3;
const WINDOW_DAYS = 42;
/** A plateau whose last session is older than this is stale: after a break, see how the lift goes first. */
const STALE_DAYS = 42;

const bestE1rm = (sets: SetEntry[]) => Math.max(-Infinity, ...sets.map(e1rm).filter((v): v is number => v != null));
// Weights as added to the body (item 14: learn/bodyweight addedLoad): the same as logged, but help kept in an older import's note
// is less than bodyweight, not bodyweight.
const topWeight = (sets: SetEntry[]) => Math.max(...sets.map(addedLoad));
const repsAt = (sets: SetEntry[], w: number) => sets.filter((s) => addedLoad(s) === w).map((s) => s.reps as number).sort((a, b) => b - a);
const sum = (xs: number[], k: number) => xs.slice(0, k).reduce((a, b) => a + b, 0);

/**
 * Whether a session's working sets beat the sessions before it: a new best e1RM, a heavier top weight (a weight step-up), or at
 * its top weight more reps than those sessions did there (a rep step-up: one set with more reps, or more reps in all over the
 * same number of sets). A lighter session with more reps isn't a step-up unless its e1RM is a best.
 */
function progressed(sets: SetEntry[], before: SetEntry[][]): boolean {
  if (!before.length) return true;
  if (bestE1rm(sets) > Math.max(...before.map(bestE1rm))) return true;
  const w = topWeight(sets);
  if (w > Math.max(...before.map(topWeight))) return true;
  const mine = repsAt(sets, w);
  const theirs = before.map((b) => repsAt(b, w)).filter((r) => r.length);
  if (!theirs.length) return false;
  if (mine[0] > Math.max(...theirs.map((r) => r[0]))) return true;
  return theirs.every((r) => { const k = Math.min(r.length, mine.length); return sum(mine, k) > sum(r, k); });
}

/**
 * `since`: the last session that progressed (a plateau's start: one plateau, one dismissal). `sessions`: how many since, with
 * nothing better. `last`: the latest session. `weeks`: how long the level has read flat, the trend window's span (learn/trend).
 * `flat`: the trend's evidence: P(plateau) and the window's fatigue-adjusted slope.
 */
export interface Stall { since: string; sessions: number; weeks: number; last: string; flat: Flatness }

/**
 * The lift's sessions since its last progress (see `progressed`): the last session that beat the sessions before it, and how many
 * after it had nothing better; null when there are none, or the latest session itself progressed. A lift's first 2 sessions, and
 * the first 2 after a layoff, re-adapt (owner rule, learn/trend): each counts as a fresh start. Working sets only, as double
 * progression reads them: warm-ups and partials are left out, and a session of only those isn't a session here; test sets count.
 * A session pain shaped (it hurt, or the pain gate held or eased it: item 08) isn't counted among those with nothing better: its
 * sets are lower bounds, or the app held it on purpose, so it says nothing of a plateau (c: it can only withhold a stall). It still
 * counts as progress when it beat the sessions before it. A light week's session (item 06: its sets all light) isn't a session here:
 * stopped short on purpose, it neither progressed nor stalled.
 */
export function sinceProgress(entries: SetEntry[], exercise: string, today: string): { since: string; sessions: number; last: string } | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const ss = sessionsFor(entries, exercise).filter((x) => x.date <= today)
    .map((x) => ({ date: x.date, sets: x.sets.filter(isProgressionSet) })).filter((x) => x.sets.length && !x.sets.every(isLight)).reverse();
  if (!ss.length) return null;
  const run0 = runIndex(ss.map((x) => dayOf(x.date)));
  let last = 0;
  ss.forEach((x, i) => {
    const before = ss.slice(Math.max(0, i - LOOKBACK), i).filter((b) => days(b.date, x.date) <= WINDOW_DAYS).map((b) => b.sets);
    if (run0[i] < REACCLIMATION || progressed(x.sets, before)) last = i;
  });
  const n = ss.slice(last + 1).filter((x) => !painShaped(entries, exercise, x.date)).length;
  return n ? { since: ss[last].date, sessions: n, last: ss[ss.length - 1].date } : null;
}

/**
 * A lift that has stopped progressing (item 12): its fatigue-adjusted level is more likely on a plateau than progressing (learn/trend
 * `flatness`, P > STALL_P: b, his own plateau share and progress rates), its latest session set no new best (c: only withholds, so
 * the card never calls a lift flat on the day it moved), and that session is within 6 weeks (a plateau before a layoff is stale).
 * The trend replaces the old 3 sessions over 2 weeks with no best: on synthetic plateaus under a 3 % day-to-day noise that rule
 * missed a third outright, as chance bests keep resetting it. Holds, cardio and bodyweight-only lifts (no level yet) never stall.
 * Sessions pain shaped (item 08) don't count toward it (see `sinceProgress`); the trend reads their pain sets as lower bounds
 * (learn/capacity) and a held session as the reading it is.
 */
/**
 * How likely a plateau must be to call a stall (owner, 2026-10-28: stricter). At P > 0.5, replayed on his log, 3 of 15 calls held
 * (no new best in the next 3 sessions); at P > 0.6, 2 of 6 held: 2 of the 3 true calls kept, 8 of the 12 false ones gone. A default:
 * `stall` and `rotation` (`stallP`) take another, for a learned one later.
 */
export const STALL_P = 0.6;

export function stall(entries: SetEntry[], exercise: string, today: string, minP = STALL_P): Stall | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  if (isHoldLift(exercise, entries) || isCardio(exercise)) return null;
  const run = sinceProgress(entries, exercise, today);
  if (!run || days(run.last, today) > STALE_DAYS) return null;
  const core = coreBefore(entries, addDays(today, 1));
  const flat = core && flatness(core, exercise, today);
  return flat && flat.p > minP ? { ...run, weeks: Math.floor(flat.slope.days / 7), flat } : null;
}

/**
 * `available`: what this gym can do. `include`: lifts added to the gym by hand. `program`: its lifts aren't offered (no lift twice).
 * `body`: his energy, and `light`: a light week he started on this phone, for item 06 (see `rotation`).
 */
export interface RotationContext { available?: Set<string>; include?: string[]; program?: Program | null; body?: readonly BodyDay[]; light?: { from: string; end?: string } | null;
  /** The P(plateau) a stall needs (`STALL_P` by default). */ stallP?: number }

/** Variations in a rotation: the lift and the two others. */
const ROTATION = 3;

/**
 * A variation to leave out of a rotation for pain (item 08), in place of the flat 60 days: more likely than not to be worse than
 * its region's other lifts next time (b: learn/pain's `worse` > ½, so the lockout lasts as long as his own pain history says pain
 * lingers, and clean sessions since release it sooner), or a region it loads hurt (moderate or worse) on another lift in the last
 * SETTLE_DAYS (a: painPlan `spillOver`). A lift never done, with no pain of its own, is never worse than its region.
 */
export const sore = (entries: SetEntry[], n: string, today: string): boolean =>
  spillOver(entries, n, today) != null || painRisk(entries, n, today).worse > 0.5;

/**
 * The next variation for a lift: same pattern, same bias when the gym has one (a lats-led pull to a lats-led pull, a chin-up
 * to a close-grip pulldown; else the closest muscle profile, which keeps the main muscle where the pattern can), one this gym can do, not already in the program, not sore (see `sore`). The rotation is the lift plus the two others you
 * trained most recently, topped up with ones you haven't (closest muscles, then the pattern's order); the next is the one of
 * those trained longest ago, never trained first. So it goes A → B → C and back to A.
 */
export function nextVariation(entries: SetEntry[], lift: string, today: string, ctx: RotationContext = {}): string | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const pattern = patternOf(lift);
  if (!pattern) return null;
  const ok = ctx.available ? new Set([...ctx.available].map(key)) : null;
  const programmed = new Set((ctx.program?.days ?? []).flatMap((d) => d.slots.map((s) => key(s.exercise))));
  const pool: string[] = [];
  for (const n of [...VARIATIONS[pattern], ...exerciseNames(entries), ...(ctx.include ?? [])]) {
    const k = key(n);
    if (k === key(lift) || pool.some((x) => key(x) === k) || patternOf(n) !== pattern) continue;
    if ((ok && !ok.has(k)) || programmed.has(k) || sore(entries, n, today)) continue;
    pool.push(n);
  }
  const bias = biasOf(lift).join();
  const same = pool.filter((n) => biasOf(n).join() === bias);
  // Sorts are stable: ties keep the pattern's order.
  const closest = (xs: string[]) => [...xs].sort((a, b) => similarity(lift, b) - similarity(lift, a));
  const group = same.length ? same : closest(pool);
  const lastDone = new Map<string, string>();
  for (const e of entries) {
    if (e.date > today || !isWorking(e)) continue;
    const k = key(e.exercise);
    if (e.date > (lastDone.get(k) ?? '')) lastDone.set(k, e.date);
  }
  const last = (n: string) => lastDone.get(key(n)) ?? '';
  const known = group.filter(last).sort((a, b) => last(b).localeCompare(last(a)));
  const fresh = closest(group.filter((n) => !last(n)));
  const others = [...known, ...fresh].slice(0, ROTATION - 1);
  return others.sort((a, b) => last(a).localeCompare(last(b)))[0] ?? null;
}

/**
 * A stalled lift and the variation to switch to. `bias`: the lift's (see `biasOf`). `sameBias`: false when the gym had none
 * of the same bias; `sameMuscle`: false when it had none with the same main muscle either.
 */
export interface Rotation { from: string; to: string; pattern: Pattern; muscle: Muscle | null; bias: Muscle[]; sameMuscle: boolean; sameBias: boolean; stall: Stall }

export function rotation(entries: SetEntry[], lift: string, today: string, ctx: RotationContext = {}): Rotation | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const pattern = patternOf(lift);
  if (!pattern) return null;
  const s = stall(entries, lift, today, ctx.stallP);
  if (!s) return null;
  // Item 06: while he is down across lifts with a second signal (a deload is suggested), or in a light week, a stall is his
  // fatigue's, not the lift's: rotating would blame the wrong cause (a: Grandou 2020; 06 §3.2). Its offer waits.
  const sys = systemic(entries, ctx.body ?? [], today, ctx.light);
  if (sys && (sys.verdict === 'deload' || sys.verdict === 'light')) return null;
  const to = nextVariation(entries, lift, today, ctx);
  if (!to) return null;
  const muscle = mainMuscle(lift), bias = biasOf(lift);
  return { from: lift, to, pattern, muscle, bias, sameMuscle: mainMuscle(to) === muscle, sameBias: biasOf(to).join() === bias.join(), stall: s };
}

/** Why this variation, in a phrase: the two muscles a chin-up's bias keeps, else the main muscle, else the closest there was. */
export function rotationReason(r: Rotation): string {
  const lower = (m: Muscle | null) => m?.toLowerCase();
  if (r.sameBias && r.bias.length > 1) return `same pattern and muscles (${r.bias.map(lower).join(' and ')})`;
  return r.sameMuscle ? `same pattern and main muscle (${lower(r.muscle)})` : 'same pattern, the closest muscles this gym has';
}

/**
 * Rough e1RM of each lift against the others in its pattern, only where loads compare: the barbell lifts and their Smith
 * versions (a front squat about 0.8 of a back squat), and the two pulldowns on one stack. Dumbbells, machines and bodyweight vary too much (per hand or both, stack
 * and lever ratios) to guess; those carry over only from your own history.
 */
const LOAD: Record<string, number> = {
  'bench press': 1, 'smith flat press': 1, 'close-grip bench press': 0.9, 'incline bench press': 0.8, 'smith incline press': 0.8,
  'lat pulldown': 1, 'close-grip lat pulldown': 1, 'barbell squat': 1, 'smith squat': 1, 'front squat': 0.8, deadlift: 1, 'romanian deadlift': 0.75,
};
/**
 * (c) The SD of a catalog ratio (ln), as a prior: 0.1 is the old fixed 0.9 discount when the level is sure. (b) Re-estimated from
 * the person's own pairs of catalog lifts trained close together (`catalogSpread`), worth two pairs.
 */
const CATALOG_SD = { sd: 0.1, k: 2 } as const;
/** The default increment: a typed one wins over the learned ladder (as in progression). */
const DEFAULT_INCREMENT = 5;
/** The new lift's own history counts as current within this many days: then its own progression stands. */
const FRESH_DAYS = 42;
/** How far apart a session of each lift may be for the two to be compared. */
const NEAR_DAYS = 42;

/** A starting point for the new lift. `basis`: your own history of both lifts, or the catalog's ratio. */
export interface Carry { weight: number; reps: number; e1rm: number; basis: 'history' | 'catalog' }

/** The two lifts' levels at their nearest sessions within NEAR_DAYS (the new lift's latest): ln(e1RM_to / e1RM_from) and its variance. */
function historyRatio(core: Core, from: string, to: string): { mean: number; v: number } | null {
  const lt = core.lifts.get(key(to))?.level.at(-1), lf = core.lifts.get(key(from))?.level;
  if (!lt || !lf?.length) return null;
  let best: (typeof lf)[number] | null = null;
  for (const p of lf) if (Math.abs(p.day - lt.day) <= NEAR_DAYS && (!best || Math.abs(p.day - lt.day) < Math.abs(best.day - lt.day))) best = p;
  if (!best) return null;
  // The levels' own variances, and the drift between the two days.
  return { mean: lt.x - best.x, v: lt.sd ** 2 + best.sd ** 2 + aheadVar(core, Math.abs(lt.day - best.day)) };
}

const SPREAD = new WeakMap<Core, number>();
/**
 * The variance of a catalog ratio (ln): the prior (CATALOG_SD) shrunk toward how far the person's own pairs of catalog lifts, trained
 * within NEAR_DAYS of each other, sit from the catalog's ratio beyond their levels' noise (b, method of moments).
 */
function catalogSpread(core: Core): number {
  const hit = SPREAD.get(core);
  if (hit != null) return hit;
  const lifts = [...core.lifts.values()].filter((l) => LOAD[l.key] && patternOf(l.name) && l.level.length);
  let n = 0, ss = 0;
  for (let i = 0; i < lifts.length; i++) for (let j = i + 1; j < lifts.length; j++) {
    const a = lifts[i], b = lifts[j];
    if (patternOf(a.name) !== patternOf(b.name)) continue;
    const r = historyRatio(core, a.name, b.name);
    if (!r) continue;
    ss += Math.max(0, (r.mean - Math.log(LOAD[b.key] / LOAD[a.key])) ** 2 - r.v); n++;
  }
  const v = (CATALOG_SD.k * CATALOG_SD.sd ** 2 + ss) / (CATALOG_SD.k + n);
  SPREAD.set(core, v);
  return v;
}

/**
 * The new lift's first target, carried over from the old one's strength (00-core 1.1): the old lift's level now (learn/strength),
 * times the ratio between the two (from both lifts' levels when you trained the new one within 6 weeks of a session of the old
 * one, b; else the catalog's, c, with a spread learned from your pairs) taken at its lower bound, exp(mean - 1 SD), the SD being
 * the level's uncertainty and the ratio's. The weight is the one that leaves the bottom of the range plus your usual reps in
 * reserve (the habit, b) on the new lift's reps-load slope (a: Epley's 30 until it has its own), at or under it on the lift's
 * learned ladder (a typed increment wins). Null when there's no ratio, or the new lift was trained lately.
 */
export function carryOver(entries: SetEntry[], from: string, to: string, today: string, st: ExerciseSettings): Carry | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  // A bodyweight lift's load is its share of his body plus what's added (item 14): without his body weight there's no lb to aim at.
  if (bodyShare(to) != null) return null;
  const core = coreBefore(entries, addDays(today, 1));
  const now = core && strengthOf(core, from, today);
  if (!core || !now) return null;
  const lastTo = sessionsFor(entries, to).find((x) => x.date <= today && x.sets.some(isWorking))?.date;
  if (lastTo && days(lastTo, today) <= FRESH_DAYS) return null;
  let ratio = lastTo ? historyRatio(core, from, to) : null, basis: Carry['basis'] = 'history';
  if (!ratio) {
    const a = LOAD[key(from)], b = LOAD[key(to)];
    if (a && b && patternOf(from) === patternOf(to)) { ratio = { mean: Math.log(b / a), v: catalogSpread(core) }; basis = 'catalog'; }
  }
  if (!ratio) return null;
  const est = Math.exp(now.x + ratio.mean - Math.sqrt(now.u ** 2 + ratio.v));
  const kappa = core.lifts.get(key(to))?.kappa.mean ?? KAPPA_PRIOR.mean;
  const want = est / (1 + (st.repMin + core.habit.mean) / kappa);
  const ladder = st.increment === DEFAULT_INCREMENT ? ladderOf(entries, to) : null;
  const weight = ladder ? floorRung(ladder, want) : Math.floor(want / st.increment + 1e-9) * st.increment;
  return weight > 0 ? { weight, reps: st.repMin, e1rm: est, basis } : null;
}

/** The program with every slot of `from` now `to`, in `to`'s rep range: a hand edit, so a rebuild drops it like any other. */
export function rotateProgram(p: Program, from: string, to: string, range: { repMin: number; repMax: number }): Program {
  const r = renameInProgram(p, from, to);
  if (!r) return p;
  return { ...r, edited: true, days: r.days.map((d) => ({ ...d, slots: d.slots.map((s) => (sameExercise(s.exercise, to) ? { ...s, ...range } : s)) })) };
}
