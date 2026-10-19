import { addDays } from './analytics';
import { isCardio } from './cardio';
import { isHoldLift, recentPain, similarity } from './care';
import { VARIATIONS, type Pattern } from './catalog';
import { liftKey } from './ids';
import { resolveLift } from './lifts';
import { MUSCLES, muscleVector, type Muscle } from './muscles';
import type { Program } from './program';
import { isProgressionSet, isWorking, priorE1rm, type ExerciseSettings } from './progression';
import { renameInProgram } from './rename';
import { e1rm, estimateWeightForReps, exerciseNames, liftSets, sameExercise, sessionsFor } from './stats';
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

/** How many sessions in a row with nothing better make a stall, and how long they must span. */
export const STALL_SESSIONS = 3;
export const STALL_DAYS = 14;
/** A session is judged against the up-to-3 sessions before it within 6 weeks; with none (a first session, a break), it's a fresh start. */
const LOOKBACK = 3;
const WINDOW_DAYS = 42;
/** A plateau whose last session is older than this is stale: after a break, see how the lift goes first. */
const STALE_DAYS = 42;

const bestE1rm = (sets: SetEntry[]) => Math.max(-Infinity, ...sets.map(e1rm).filter((v): v is number => v != null));
const topWeight = (sets: SetEntry[]) => Math.max(...sets.map((s) => s.weight));
const repsAt = (sets: SetEntry[], w: number) => sets.filter((s) => s.weight === w).map((s) => s.reps as number).sort((a, b) => b - a);
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

/** `since`: the last session that progressed. `sessions`: how many since, with nothing better. `weeks`: from `since` to `last`. */
export interface Stall { since: string; sessions: number; weeks: number; last: string }

/**
 * A lift that has stopped progressing: 3 or more sessions in a row, spanning 2 weeks or more, none better than the sessions
 * before it (see `progressed`), the latest within 6 weeks of `today`. Working sets only, as double progression reads them:
 * warm-ups and partials are left out, and a session of only those isn't a session here; test sets count. Holds and cardio never stall.
 */
export function stall(entries: SetEntry[], exercise: string, today: string): Stall | null {
  if (isHoldLift(exercise, entries) || isCardio(exercise)) return null;
  const ss = sessionsFor(entries, exercise).filter((x) => x.date <= today)
    .map((x) => ({ date: x.date, sets: x.sets.filter(isProgressionSet) })).filter((x) => x.sets.length).reverse();
  if (!ss.length) return null;
  let last = 0;
  ss.forEach((x, i) => {
    const before = ss.slice(Math.max(0, i - LOOKBACK), i).filter((b) => days(b.date, x.date) <= WINDOW_DAYS).map((b) => b.sets);
    if (progressed(x.sets, before)) last = i;
  });
  const run = ss.slice(last + 1);
  const end = run.at(-1)?.date;
  if (run.length < STALL_SESSIONS || !end || days(run[0].date, end) < STALL_DAYS || days(end, today) > STALE_DAYS) return null;
  return { since: ss[last].date, sessions: run.length, weeks: Math.floor(days(ss[last].date, end) / 7), last: end };
}

/** `available`: what this gym can do. `include`: lifts added to the gym by hand. `program`: its lifts aren't offered (no lift twice). */
export interface RotationContext { available?: Set<string>; include?: string[]; program?: Program | null }

/** Variations in a rotation: the lift and the two others. */
const ROTATION = 3;
const PAIN_DAYS = 60;

/**
 * The next variation for a lift: same pattern, same bias when the gym has one (a lats-led pull to a lats-led pull, a chin-up
 * to a close-grip pulldown; else the closest muscle profile, which keeps the main muscle where the pattern can), one this gym can do, not already in the program, no pain logged on it lately. The rotation is the lift plus the two others you
 * trained most recently, topped up with ones you haven't (closest muscles, then the pattern's order); the next is the one of
 * those trained longest ago, never trained first. So it goes A → B → C and back to A.
 */
export function nextVariation(entries: SetEntry[], lift: string, today: string, ctx: RotationContext = {}): string | null {
  const pattern = patternOf(lift);
  if (!pattern) return null;
  const ok = ctx.available ? new Set([...ctx.available].map(key)) : null;
  const programmed = new Set((ctx.program?.days ?? []).flatMap((d) => d.slots.map((s) => key(s.exercise))));
  const hurt = recentPain(entries, today, PAIN_DAYS).byExercise;
  const pool: string[] = [];
  for (const n of [...VARIATIONS[pattern], ...exerciseNames(entries), ...(ctx.include ?? [])]) {
    const k = key(n);
    if (k === key(lift) || pool.some((x) => key(x) === k) || patternOf(n) !== pattern) continue;
    if ((ok && !ok.has(k)) || programmed.has(k) || hurt.has(k)) continue;
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
  const pattern = patternOf(lift);
  if (!pattern) return null;
  const s = stall(entries, lift, today);
  if (!s) return null;
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
/** Every carried-over estimate is taken down this much: a first session a little light costs one session, one too heavy costs more. */
export const CONSERVATIVE = 0.9;
/** The new lift's own history counts as current within this many days: then its own progression stands. */
const FRESH_DAYS = 42;
/** How far apart a session of each lift may be for the two to be compared. */
const NEAR_DAYS = 42;

/** A starting point for the new lift. `basis`: your own history of both lifts, or the catalog's ratio. */
export interface Carry { weight: number; reps: number; e1rm: number; basis: 'history' | 'catalog' }

/**
 * The new lift's first target, carried over from the old one's strength: the old lift's current e1RM (best of its last 3
 * sessions) times the ratio between the two — from your history when you trained the new one within 6 weeks of a session of
 * the old one, else the catalog's — times 0.9. The weight is the one that estimate gives at the top of the range, rounded
 * down to the lift's step, for the bottom of the range. Null when there's no ratio, or the new lift was trained lately.
 */
export function carryOver(entries: SetEntry[], from: string, to: string, today: string, st: ExerciseSettings): Carry | null {
  const now = priorE1rm(entries, from, addDays(today, 1));
  if (now == null) return null;
  const lastTo = sessionsFor(entries, to).find((x) => x.date <= today && x.sets.some(isWorking))?.date;
  if (lastTo && days(lastTo, today) <= FRESH_DAYS) return null;
  let ratio: number | null = null, basis: Carry['basis'] = 'history';
  if (lastTo) {
    const toBest = priorE1rm(entries, to, addDays(lastTo, 1));
    const near = liftSets(entries, from).filter((e) => Math.abs(days(e.date, lastTo)) <= NEAR_DAYS)
      .map(e1rm).filter((v): v is number => v != null);
    if (toBest != null && near.length) ratio = toBest / Math.max(...near);
  }
  if (ratio == null) {
    const a = LOAD[key(from)], b = LOAD[key(to)];
    if (a && b && patternOf(from) === patternOf(to)) { ratio = b / a; basis = 'catalog'; }
  }
  if (ratio == null) return null;
  const est = now * ratio * CONSERVATIVE;
  const weight = Math.floor(estimateWeightForReps(est, st.repMax) / st.increment + 1e-9) * st.increment;
  return weight > 0 ? { weight, reps: st.repMin, e1rm: est, basis } : null;
}

/** The program with every slot of `from` now `to`, in `to`'s rep range: a hand edit, so a rebuild drops it like any other. */
export function rotateProgram(p: Program, from: string, to: string, range: { repMin: number; repMax: number }): Program {
  const r = renameInProgram(p, from, to);
  if (!r) return p;
  return { ...r, edited: true, days: r.days.map((d) => ({ ...d, slots: d.slots.map((s) => (sameExercise(s.exercise, to) ? { ...s, ...range } : s)) })) };
}
