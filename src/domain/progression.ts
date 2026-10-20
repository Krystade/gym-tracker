import { liftKey } from './ids';
import { resolveLift } from './lifts';
import { e1rm, estimateWeightForReps, sessionsFor } from './stats';
import type { SetEntry } from './types';
import { isHold, isHoldLift } from './care';
import { coreBefore, logBefore } from './learn';
import { dropsOf, type Drop } from './learn/jump';
import { ladderOf, nextRung, type Ladder } from './learn/ladder';
import { fitRange, type RangeFit } from './learn/range';

/**
 * A first target carried over from another variation when this lift was rotated in (domain/rotation): an estimate, used until
 * the lift has a session on or after `date`, the day of the switch.
 */
export interface Seed { weight: number; reps: number; from: string; date: string }
// testSnoozedUntil: the "time for a test" banner stays hidden until this day.
/** `like`: the catalog lift this one works like, chosen on its page (round 15); its muscles, pattern and gear are that lift's. */
/** `rest`: seconds, the rest last set for this lift with the timer's ±30 s; the timer starts there (domain/timing restSeconds). */
export interface ExerciseSettings { key: string; repMin: number; repMax: number; increment: number; testSnoozedUntil?: string; seed?: Seed; like?: string; rest?: number }

export const settingsKey = (name: string): string => liftKey(name);

/** `hold`: the lift is timed — known by name, or by its log (callers that have the log pass it). */
export function defaultSettings(name: string, hold = isHold(name)): ExerciseSettings {
  // Holds count seconds: 20–40 s, as in the back-resilience block.
  if (hold) return { key: settingsKey(name), repMin: 20, repMax: 40, increment: 5 };
  const iso = resolveLift(name).iso;
  return { key: settingsKey(name), repMin: iso ? 10 : 8, repMax: iso ? 15 : 12, increment: 5 };
}

export const isWorking = (s: SetEntry): boolean => !s.flags.includes('warmup') && !s.flags.includes('partial') && s.reps != null && s.reps > 0;

export function priorE1rm(entries: SetEntry[], exercise: string, beforeDate: string): number | null {
  const vals = sessionsFor(entries, exercise).filter((x) => x.date < beforeDate).slice(0, 3)
    .flatMap((x) => x.sets.map(e1rm)).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Reps the prior e1RM predicts at this weight, minus reps done: how far short of the recent best the set was. */
const shortfall = (set: SetEntry, prior: number): number => (set.weight >= prior ? 1 : 30 * (prior / set.weight - 1)) - (set.reps as number);

/** Recent bests are rarely taken to failure, so "matched my best" still leaves reps in reserve; ~2 is typical. */
export const DEFAULT_RIR_OFFSET = 2;

/** Sets done before this one: by position (callers pass sets in the order done); by set number if it isn't in the list. */
const doneBefore = (set: SetEntry, sessionSets: SetEntry[]): SetEntry[] => {
  const i = sessionSets.findIndex((x) => x.id === set.id);
  return i < 0 ? sessionSets.filter((x) => x.setNo < set.setNo) : sessionSets.slice(0, i);
};

const isFirstAtWeight = (set: SetEntry, sessionSets: SetEntry[]) =>
  !doneBefore(set, sessionSets).some((x) => x.weight === set.weight && isWorking(x));

/**
 * Learn the offset from first working sets where RIR was logged: mean(logged − shortfall), once there are 3,
 * clamped 0..3. Later sets at a weight are fatigue-confounded (the same reason `estimateRir` skips them).
 * One pass, oldest session first, carrying the last three sessions' best e1RM as the prior.
 */
export function rirOffset(entries: SetEntry[], exercise: string): number {
  const window: (number | null)[] = [];
  const diffs: number[] = [];
  for (const session of [...sessionsFor(entries, exercise)].reverse()) {
    const known = window.filter((v): v is number => v != null);
    const prior = known.length ? Math.max(...known) : null;
    if (prior != null) {
      for (const x of session.sets) {
        if (x.rir == null || !isWorking(x) || x.weight <= 0 || x.flags.includes('bodyweight') || !isFirstAtWeight(x, session.sets)) continue;
        diffs.push(x.rir - shortfall(x, prior));
      }
    }
    const vals = session.sets.map(e1rm).filter((v): v is number => v != null);
    window.push(vals.length ? Math.max(...vals) : null);
    if (window.length > 3) window.shift();
  }
  if (diffs.length < 3) return DEFAULT_RIR_OFFSET;
  return clamp(Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length), 0, 3);
}

/**
 * Estimated reps in reserve for a set without a logged RIR; null when it can't be estimated honestly.
 * Only the first working set at a weight gets a prior-based estimate: later sets lose reps to fatigue,
 * which would read as *more* reserve. `sessionSets` in the order done.
 */
export function estimateRir(set: SetEntry, sessionSets: SetEntry[], prior: number | null, offset = DEFAULT_RIR_OFFSET): number | null {
  if (set.rir != null || !isWorking(set) || set.weight <= 0 || set.flags.includes('bodyweight')) return null;
  const i = sessionSets.findIndex((x) => x.id === set.id);
  const after = i < 0 ? sessionSets.find((x) => x.setNo === set.setNo + 1) : sessionSets[i + 1];
  const next = after && after.weight === set.weight && after.reps != null ? after : undefined;
  if (next && (set.reps as number) - (next.reps as number) >= 3) return 1;
  if (prior == null) return null;
  if (!isFirstAtWeight(set, sessionSets)) return null;
  return clamp(Math.round(shortfall(set, prior) + offset), 0, 5);
}

/**
 * `done`: for an increase, the reps that earned it, over that many sets at the top weight. For 'reps': `perSet`, each set's
 * own target, in order (`reps` is the lowest of them); `why`, the rule that made them, in a few words.
 */
export interface Target {
  kind: 'increase' | 'reps' | 'repeat' | 'maxed' | 'test' | 'carry'; weight: number; reps: number; last: SetEntry[]; text: string; done?: { total: number; sets: number };
  perSet?: number[]; why?: string;
  /** The range progression used, when the learned drop moved it off the lift's own (learn/range). */
  range?: RangeFit;
  /** For an increase: the step (lb), and the learned drop behind each set's target, when there is one. */
  step?: number; drop?: Drop;
}

/** The default increment: an `increment` other than it was typed on the lift's page and wins over the learned ladder. */
const DEFAULT_INCREMENT = 5;
/**
 * What the log has learned for a lift (items 01–03): its loadable weights (learn/ladder) and the reps its next step costs
 * (learn/jump, fatigue-adjusted by the learning core). Null parts: nothing to learn from yet, so today's rules stand.
 */
export function learnedFor(log: readonly SetEntry[], exercise: string, date: string): { ladder: Ladder | null; drop: Drop | null } {
  // Only what was done before the day: a target doesn't move under you while you train.
  const entries = logBefore(log, date);
  return { ladder: ladderOf(entries, exercise), drop: dropsOf(entries, coreBefore(log, date))?.(exercise) ?? null };
}
const STEP_OF: Record<string, string> = { cable: 'your cable steps', dumbbell: 'your dumbbell steps', plates: 'your plate steps', kettlebell: 'your kettlebell steps' };
const r05 = (x: number) => Math.round(x * 2) / 2;

/** How last time's sets move: +1 (or 5 s) on every set, on the one set with the most room, or not at all. */
export type Step = 'all' | 'one' | 'repeat';
/**
 * Whether recent targets were hit, newest session first, for up to 3 sessions that had any: a session hit them when each of
 * its first `target.sets` training sets at the target's weight did at least its target reps.
 */
export function targetsHit(sessions: { sets: SetEntry[] }[]): boolean[] {
  const out: boolean[] = [];
  for (const x of sessions) {
    if (out.length === 3) break;
    const aimed = x.sets.filter((e) => isTraining(e) && e.target?.weight != null && e.target.weight === e.weight);
    if (!aimed.length) continue;
    out.push(aimed.slice(0, Math.max(1, aimed[0].target!.sets)).every((e) => (e.reps as number) >= e.target!.reps));
  }
  return out;
}
/** Hit last time (or nothing to go by): every set. Missed last time: one set. Missed twice in the last 3: repeat. */
export function stepFrom(hits: boolean[]): Step {
  if (!hits.length || hits[0]) return 'all';
  return hits.slice(1).some((h) => !h) ? 'repeat' : 'one';
}

/**
 * Each set's target from last time's same set (owner, 2026-10-19): reps fall across sets at a fixed load, so each set is
 * aimed at its own number, not the weakest one's. `step` says how they move; a set never goes past `max` (the top of the
 * range) or its capacity, reps + RIR where RIR was logged (so a set at RIR 0 gets no rep). "Most room": the most RIR left,
 * else (RIR not logged) as if 1, the weakest set first. No set with room: last time's reps again.
 */
export function perSetTargets(last: { reps: number; rir?: number }[], step: Step, max: number, by = 1): { perSet: number[]; step: Step } {
  const cap = last.map((x) => Math.min(max, x.rir != null ? x.reps + x.rir : Infinity));
  const up = (i: number) => Math.min(last[i].reps + by, cap[i]);
  const reps = last.map((x) => x.reps);
  if (step === 'all') {
    const all = reps.map((r, i) => Math.max(r, up(i)));
    if (all.some((r, i) => r > reps[i])) return { perSet: all, step };
  }
  if (step !== 'repeat') {
    const room = last.map((x, i) => (cap[i] <= x.reps ? 0 : Math.min(cap[i] - x.reps, x.rir ?? 1)));
    let best = -1;
    for (let i = 0; i < last.length; i++) if (room[i] > 0 && (best < 0 || room[i] > room[best] || (room[i] === room[best] && reps[i] < reps[best]))) best = i;
    if (best >= 0) return { perSet: reps.map((r, i) => (i === best ? up(i) : r)), step: 'one' };
  }
  return { perSet: reps, step: 'repeat' };
}

const lb = (w: number) => (w === 0 ? 'BW' : `${Math.round(w * 100) / 100} lb`);

export const isTest = (s: SetEntry): boolean => s.flags.includes('test');
/**
 * A set double progression works from: any working set, a test included (owner, 2026-10-19). A session of only tests
 * recalibrates instead (see `nextTarget`): a lone max-effort set isn't a session to add reps to.
 */
export const isProgressionSet = (s: SetEntry): boolean => isWorking(s);
const isTraining = (s: SetEntry) => isWorking(s) && !isTest(s);

/**
 * `planned`: the sets the plan has for this lift today, where known. Last time's extra sets at the top weight don't hold the
 * target down: it goes from the best that many (owner, 2026-10-19: 11, 11, 8 with 2 planned is 12+, not 9+).
 */
export function nextTarget(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned?: number | null): Target | null {
  const before = sessionsFor(entries, exercise).filter((x) => x.date < date);
  // Just rotated in: the carried-over estimate, until the first session since the switch.
  const seed = st.seed;
  if (seed && date >= seed.date && !before.some((x) => x.date >= seed.date && x.sets.some(isWorking))) {
    return { kind: 'carry', weight: seed.weight, reps: seed.reps, last: before[0]?.sets ?? [], text: `Estimate: ${lb(seed.weight)} × ${seed.reps}+` };
  }
  if (!before.length) return null;
  // The session to progress from: the last one that isn't only test sets.
  const at = before.findIndex((x) => x.sets.some(isTraining) || !x.sets.some(isTest));
  // A test newer than it resets the working weight: the weight its e1RM (reps in reserve counted) gives at the top of the range.
  const tests = (at < 0 ? before : before.slice(0, at)).flatMap((x) => x.sets.filter((t) => isTest(t) && isWorking(t)));
  const best = Math.max(0, ...tests.map((t) => e1rm({ ...t, reps: (t.reps as number) + (t.rir ?? 0) }) ?? 0));
  if (best > 0) {
    const w = Math.max(st.increment, Math.round(estimateWeightForReps(best, st.repMax) / st.increment) * st.increment);
    return { kind: 'test', weight: w, reps: st.repMin, last: before[0].sets, text: `From your test: ${lb(w)} × ${st.repMin}+` };
  }
  const last = before[Math.max(0, at)];
  const working = last.sets.filter(isProgressionSet);
  if (!working.length) {
    const w = Math.max(...last.sets.map((x) => x.weight));
    return { kind: 'repeat', weight: w, reps: st.repMin, last: last.sets, text: `Repeat ${lb(w)} and log every rep` };
  }
  const top = Math.max(...working.map((x) => x.weight));
  const unit = isHoldLift(exercise, entries) ? 's' : '';
  // Items 01–03 for loaded rep lifts: the learned step and drop, and the range fitted to them.
  const learned = !unit && top > 0 ? learnedFor(entries, exercise, date) : { ladder: null, drop: null };
  const fit = learned.drop ? fitRange(exercise, st, Math.max(0, learned.drop.mean)) : null;
  const range = fit && fit.how !== 'fits' && fit.how !== 'too-big' ? fit : null;
  const repMin = range?.repMin ?? st.repMin, repMax = range?.repMax ?? st.repMax;
  const all = working.filter((x) => x.weight === top);
  // The best N, kept in the order done.
  const bestN = planned != null && planned > 0 && all.length > planned ? new Set([...all].sort((a, b) => (b.reps as number) - (a.reps as number)).slice(0, planned)) : null;
  const atTop = bestN ? all.filter((x) => bestN.has(x)) : all;
  const minReps = Math.min(...atTop.map((x) => x.reps as number));
  // Up once the sets at the top weight total within 2 reps of all at the top of the range (12/12/10 at 3 × 8–12), none below its bottom.
  const total = atTop.reduce((a, x) => a + (x.reps as number), 0);
  const topped = total >= atTop.length * repMax - Math.min(2, atTop.length - 1) && minReps >= repMin; // one heavier top set gets no slack
  if (top > 0 && topped) {
    // The next loadable weight (item 01): a typed increment wins, else the learned ladder's next rung, else +increment.
    const typed = st.increment !== DEFAULT_INCREMENT;
    const w = !typed && learned.ladder ? nextRung(learned.ladder, top) : top + st.increment;
    const step = Math.round((w - top) * 100) / 100;
    const base = { kind: 'increase' as const, weight: w, last: last.sets, done: { total, sets: atTop.length }, step, ...(range && { range }) };
    const drop = learned.drop;
    if (!unit && drop) {
      // Item 02: each set from last time's same set, less the learned drop (floored: a miss costs more than an easy day), so
      // the sets keep their shape (12, 12, 11 → 10, 10, 9); never past the range's top.
      const aimed = atTop.map((x) => clamp(Math.floor((x.reps as number) - Math.max(0, drop.mean) + 1e-9), 1, repMax));
      const perSet = planned != null && planned > aimed.length ? [...aimed, ...Array<number>(planned - aimed.length).fill(aimed.at(-1)!)] : aimed;
      const ladder = learned.ladder;
      const stepWhy = typed || !ladder ? `+${lb(step)}` : `+${lb(step)}, ${ladder.pool && ladder.source === 'pool' ? STEP_OF[ladder.pool] ?? 'your steps' : ladder.pool ? 'its own steps' : 'this machine’s steps'}`;
      const why = `${stepWhy} · jumps cost you ${r05(Math.max(0, drop.mean))}`;
      return { ...base, reps: Math.min(...perSet), perSet, why, drop, text: `Go up: ${lb(w)} × ${perSet.join(' · ')}` };
    }
    return { ...base, reps: repMin, text: `Go up: ${lb(w)} × ${repMin}${unit}+` };
  }
  // A bodyweight hold at the top of its range has nowhere to go in time: add weight or a harder variation.
  if (unit && top === 0 && topped) {
    return { kind: 'maxed', weight: 0, reps: st.repMax, last: last.sets, text: `BW × ${st.repMax}s held: add weight or try a harder variation` };
  }
  // Bodyweight reps have no weight to add, so their target is not capped by the range. Holds step in 5 s, like the stepper,
  // and have no RIR.
  const by = unit ? 5 : 1;
  const hits = targetsHit(before.slice(Math.max(0, at)));
  const wanted = stepFrom(hits);
  const { perSet: aimed, step } = perSetTargets(atTop.map((x) => ({ reps: x.reps as number, ...(!unit && x.rir != null && { rir: x.rir }) })),
    wanted, top === 0 && !unit ? Infinity : repMax, by);
  // A plan with more sets than last time: the extra sets aim at the last one's number.
  const perSet = planned != null && planned > aimed.length ? [...aimed, ...Array<number>(planned - aimed.length).fill(aimed.at(-1)!)] : aimed;
  const plus = `+${by}${unit || (by === 1 ? ' rep' : ' reps')}`;
  const rule = step === 'all' ? (hits[0] ? `Targets hit last time: ${plus} a set` : `Last time ${plus} a set`)
    : step === 'one' ? (wanted === 'one' ? `Missed last time: ${plus} on one set` : `Most sets at their limit: ${plus} on one set`)
    : wanted === 'repeat' ? 'Missed twice lately: repeat last time' : 'Sets at their limit last time: repeat them';
  // Item 03: a range moved by the learned drop says so, in a few words.
  const why = range ? `${rule} · ${range.how === 'top' ? `to ${range.repMax} before going up` : `${range.repMin}+ is fine after going up`}` : rule;
  return { kind: 'reps', weight: top, reps: Math.min(...perSet), last: last.sets, perSet, why, ...(range && { range, drop: learned.drop! }), text: `${lb(top)} × ${perSet.join(' · ')}${unit ? ' s' : ''}` };
}
