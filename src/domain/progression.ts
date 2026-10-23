import { liftKey } from './ids';
import { resolveLift } from './lifts';
import { e1rm, estimateWeightForReps, sessionsFor } from './stats';
import type { SetEntry } from './types';
import { isHold, isHoldLift } from './care';
import { coreBefore, logBefore } from './learn';
import { dropsOf, type Drop } from './learn/jump';
import { floorRung, ladderOf, nextRung, prevRung, type Ladder } from './learn/ladder';
import { isLight, LIGHT } from './learn/deload';
import { fitRange, type RangeFit } from './learn/range';
import { painGate, painWhy, type PainGate } from './painPlan';
import { addedLoad, bodyShare } from './learn/bodyweight';
import { tagsOf } from './learn/tags';
import type { TrainingGoal } from './profile';

/**
 * A first target carried over from another variation when this lift was rotated in (domain/rotation): an estimate, used until
 * the lift has a session on or after `date`, the day of the switch.
 */
export interface Seed { weight: number; reps: number; from: string; date: string;
  /** The old lift's fatigue-adjusted e1RM carried over (lb), and what the ratio between the two came from (rotation.carryOver). */
  e1rm?: number; basis?: 'history' | 'catalog' }
// testSnoozedUntil: the "time for a test" banner stays hidden until this day.
/** `like`: the catalog lift this one works like, chosen on its page (round 15); its muscles, pattern and gear are that lift's. */
/** `rest`: seconds, the rest last set for this lift with the timer's ±30 s; the timer starts there (domain/timing restSeconds). */
/** `ownRange`: repMin–repMax were typed on the lift's page, so they win over the training goal's default (resolveSettings). */
/**
 * `rangeFrom`: where repMin–repMax came from, set by defaultSettings and resolveSettings as they pick it (never saved: see
 * useSettings): typed on the lift's page, the training goal's (only a barbell compound's range moves with it), or the class default.
 */
export interface ExerciseSettings { key: string; repMin: number; repMax: number; increment: number; testSnoozedUntil?: string; seed?: Seed; like?: string; rest?: number; ownRange?: true; rangeFrom?: RangeFrom }
export type RangeFrom = 'own' | 'strength' | 'size' | 'default';

export const settingsKey = (name: string): string => liftKey(name);

/** A barbell compound: what the 'strength' goal moves to 5–8 (profile.goalOf). */
export const isBarbellCompound = (name: string): boolean => !resolveLift(name).iso && tagsOf(name).imp === 'barbell';

/**
 * `hold`: the lift is timed — known by name, or by its log (callers that have the log pass it). `goal`: the profile's training
 * goal (profile.goalOf): 'strength' gives a barbell compound 5–8 (a: Currier 2026, ACSM, load ≥ 80 % 1RM ✔ for strength, QoE
 * 79 %, 6 reviews, n=6,574; learn/range's envelope floor for the class is 5). 'size' keeps 8–12 / 10–15 (c: neutral, within
 * the 5–30 reps growth is alike over).
 */
export function defaultSettings(name: string, hold = isHold(name), goal: TrainingGoal = 'size'): ExerciseSettings {
  // Holds count seconds: 20–40 s, as in the back-resilience block.
  if (hold) return { key: settingsKey(name), repMin: 20, repMax: 40, increment: 5, rangeFrom: 'default' };
  const goalMoves = isBarbellCompound(name);
  if (goal === 'strength' && goalMoves) return { key: settingsKey(name), repMin: 5, repMax: 8, increment: 5, rangeFrom: 'strength' };
  const iso = resolveLift(name).iso;
  return { key: settingsKey(name), repMin: iso ? 10 : 8, repMax: iso ? 15 : 12, increment: 5, rangeFrom: goalMoves ? 'size' : 'default' };
}

/**
 * A lift's settings as used: its saved row, with the goal's default range unless the range is its own. Own: typed on its page
 * (`ownRange`), or, for a row saved before that mark, a range that is no goal's default (a typed one). A row saved for its rest
 * or a seed carries whatever default it was shown, which is not a choice.
 */
export function resolveSettings(saved: ExerciseSettings | undefined, name: string, hold: boolean | undefined, goal: TrainingGoal): ExerciseSettings {
  const d = defaultSettings(name, hold, goal);
  if (!saved) return d;
  const isDefault = (g: TrainingGoal) => { const x = defaultSettings(name, hold, g); return x.repMin === saved.repMin && x.repMax === saved.repMax; };
  if (saved.ownRange || (!isDefault('size') && !isDefault('strength'))) return { ...saved, rangeFrom: 'own' };
  return { ...saved, repMin: d.repMin, repMax: d.repMax, rangeFrom: d.rangeFrom };
}

/** Where a lift's range came from: as resolved (`rangeFrom`), else, for settings built by hand, read off the defaults. */
function rangeFromOf(st: ExerciseSettings, name: string, hold: boolean): RangeFrom {
  if (st.rangeFrom) return st.rangeFrom;
  if (st.ownRange) return 'own';
  for (const g of ['size', 'strength'] as const) { const d = defaultSettings(name, hold, g); if (d.repMin === st.repMin && d.repMax === st.repMax) return d.rangeFrom!; }
  return 'own';
}

export const isWorking = (s: SetEntry): boolean => !s.flags.includes('warmup') && !s.flags.includes('partial') && s.reps != null && s.reps > 0;

/** A light week's session (item 06): its working sets all light. Progression goes on from the session before it. */
const lightSession = (sets: SetEntry[]): boolean => { const w = sets.filter(isWorking); return w.length > 0 && w.every(isLight); };

export function priorE1rm(entries: SetEntry[], exercise: string, beforeDate: string): number | null {
  // A light week's sets (item 06) are stopped short on purpose: not a reading of the recent best.
  const vals = sessionsFor(entries, exercise).filter((x) => x.date < beforeDate && !lightSession(x.sets)).slice(0, 3)
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
  kind: 'increase' | 'reps' | 'repeat' | 'maxed' | 'test' | 'carry' | 'hold' | 'ease' | 'light'; weight: number; reps: number; last: SetEntry[]; text: string; done?: { total: number; sets: number };
  perSet?: number[]; why?: string;
  /** The range progression used, when the learned drop moved it off the lift's own (learn/range). */
  range?: RangeFit;
  /** For an increase: the step (lb), and the learned drop behind each set's target, when there is one. */
  step?: number; drop?: Drop;
  /** 'hold' and 'ease': the pain behind it (item 08, painPlan). */
  pain?: PainGate;
  /** 'ease': how it's eased: load off, more help (an assisted bodyweight lift), or a rep off each set (bodyweight, no help known). */
  easeBy?: 'load' | 'help' | 'reps';
  /**
   * The inputs that made this target, one line each, for the card's "Why this weight": pushed by the branch that used them, as
   * it used them, so a line is there exactly when its input moved the number.
   */
  parts: TargetPart[];
}

/**
 * Where a line of "Why this weight" comes from: (a) research, with its citation; (b) learned or read from his log, with how;
 * (c) a neutral default, with what it stands in for.
 */
export type Evidence = { ev: 'a'; cite: string } | { ev: 'b'; method: string } | { ev: 'c'; note: string };
/** Which input a line is. */
export type TargetInput = 'last' | 'seed' | 'test' | 'range' | 'goal' | 'progress' | 'hits' | 'rir' | 'step' | 'drop' | 'fit'
  | 'pain' | 'light' | 'plan' | 'sets' | 'bodyweight' | 'new';
/** One input to a target: `what` it is (and the `date` it's from), its `value` here, and its evidence. */
export interface TargetPart { key: TargetInput; what: string; value: string; evidence: Evidence; date?: string }

const PLOTKIN = 'Plotkin 2022 (PeerJ 10:e14142): adding reps, then load, grows muscle as well as adding load';
const LOG: Evidence = { ev: 'b', method: 'your log' };
const TYPED: Evidence = { ev: 'b', method: 'you set it on the lift’s page' };
/** A session's sets as one value: "135 lb × 12 · 12 · 10" at one weight, else each set. */
function setsText(sets: SetEntry[], load: (x: SetEntry) => number, unit: string): string {
  if (!sets.length) return 'no complete sets';
  const ws = sets.map(load), reps = sets.map((x) => `${x.reps ?? 0}${unit}`);
  return ws.every((w) => w === ws[0]) ? `${lb(ws[0])} × ${reps.join(' · ')}` : sets.map((_, i) => `${lb(ws[i])} × ${reps[i]}`).join(' · ');
}
const lastPart = (s: { date: string; sets: SetEntry[] }, load: (x: SetEntry) => number, unit: string): TargetPart => {
  const w = s.sets.filter(isWorking);
  return { key: 'last', what: 'Last time', date: s.date, value: setsText(w.length ? w : s.sets, load, unit), evidence: LOG };
};
/** The rep range as used: typed, the training goal's (a barbell compound's moves with it), or the class default. */
export function rangePart(st: ExerciseSettings, exercise: string, hold: boolean, range: { repMin: number; repMax: number } = st): TargetPart {
  const value = `${range.repMin}–${range.repMax}${hold ? ' s' : ' reps'}`;
  switch (rangeFromOf(st, exercise, hold)) {
    case 'own': return { key: 'range', what: 'Rep range', value, evidence: TYPED };
    case 'strength': return { key: 'goal', what: 'Strength goal', value,
      evidence: { ev: 'a', cite: 'Currier 2026 (ACSM position stand): 80 % of 1RM or more for strength, so 5–8 on a barbell compound' } };
    case 'size': return { key: 'goal', what: 'Size goal', value, evidence: { ev: 'c', note: 'neutral: muscle grows alike from about 5 to 30 reps a set' } };
    default: return { key: 'range', what: 'Rep range', value,
      evidence: { ev: 'c', note: hold ? 'default for a timed hold' : resolveLift(exercise).iso ? 'default for an isolation lift' : 'default for a compound lift' } };
  }
}
const STEP_POOL: Record<string, string> = { cable: 'cable', dumbbell: 'dumbbell', plates: 'plate', kettlebell: 'kettlebell' };
/** The step a weight moved by: typed, the learned ladder's rung, or the default 5 lb. */
function stepPart(what: string, value: string, typed: boolean, ladder: Ladder | null): TargetPart {
  if (typed) return { key: 'step', what, value, evidence: TYPED };
  if (!ladder) return { key: 'step', what, value, evidence: { ev: 'c', note: 'default 5 lb until your log shows the weights this lift loads' } };
  const whose = ladder.source === 'pool' && ladder.pool ? `every ${STEP_POOL[ladder.pool] ?? ladder.pool} weight you’ve logged` : ladder.pool ? 'the weights you’ve logged on it' : 'this machine’s weights you’ve logged';
  return { key: 'step', what, value, evidence: { ev: 'b', method: `learned from ${whose} (${ladder.n}), as ${lb(ladder.step)} steps` } };
}
const planPart = (value: string): TargetPart => ({ key: 'plan', what: 'Today’s plan', value, evidence: { ev: 'b', method: 'your program' } });
/** Pain's rule, with its evidence: (a) the pain-monitoring model; pain of unknown size only holds (c). */
function painPart(g: PainGate, value: string): TargetPart {
  const what = g.spill ? `${g.region[0].toUpperCase()}${g.region.slice(1)} pain on ${g.from}` : `Pain last time (${g.region})`;
  const evidence: Evidence = g.unknown && !g.spill ? { ev: 'c', note: 'how bad wasn’t logged: it only holds' }
    : g.why === 'settled' || g.why === 'sore' || g.why === 'worse' ? { ev: 'a', cite: 'Silbernagel 2007 (AJSM 35:897): pain should settle by the next morning' }
    : { ev: 'a', cite: 'Silbernagel & Crossley 2015 (JOSPT 45:876): load goes on within 5/10 and not rising; above it, it comes down' };
  return { key: 'pain', what, date: g.date, value, evidence };
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
export function perSetTargets(last: { reps: number; rir?: number }[], step: Step, max: number, by = 1): { perSet: number[]; step: Step; rir: boolean } {
  const cap = last.map((x) => Math.min(max, x.rir != null ? x.reps + x.rir : Infinity));
  const up = (i: number) => Math.min(last[i].reps + by, cap[i]);
  const reps = last.map((x) => x.reps);
  // `rir`: a logged RIR moved a set's target: capped it below +by (and the top), or, once not every set could go up, chose the set.
  const capped = last.some((x) => x.rir != null && x.reps + x.rir < Math.min(max, x.reps + by));
  const logged = last.some((x) => x.rir != null);
  if (step === 'all') {
    const all = reps.map((r, i) => Math.max(r, up(i)));
    if (all.some((r, i) => r > reps[i])) return { perSet: all, step, rir: capped };
  }
  if (step !== 'repeat') {
    const room = last.map((x, i) => (cap[i] <= x.reps ? 0 : Math.min(cap[i] - x.reps, x.rir ?? 1)));
    let best = -1;
    for (let i = 0; i < last.length; i++) if (room[i] > 0 && (best < 0 || room[i] > room[best] || (room[i] === room[best] && reps[i] < reps[best]))) best = i;
    if (best >= 0) return { perSet: reps.map((r, i) => (i === best ? up(i) : r)), step: 'one', rir: logged };
    return { perSet: reps, step: 'repeat', rir: logged };
  }
  return { perSet: reps, step: 'repeat', rir: false };
}

const r2 = (w: number) => Math.round(w * 100) / 100;
/** A weight as the target says it: BW, help below it (an assisted bodyweight lift, item 14), or lb. */
const lb = (w: number) => (w === 0 ? 'BW' : w < 0 ? `BW − ${r2(-w)} lb` : `${r2(w)} lb`);

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
 * `light`: a light week is on (item 06): the target it would be, lightened (see `lighten`). Sessions of a light week are never
 * progressed from: the first target after it is the one before it.
 */
export function nextTarget(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned?: number | null, light = false): Target | null {
  const t = baseTarget(entries, exercise, st, date, planned);
  return light && t ? lighten(t, entries, exercise, st, date, planned) : t;
}

/**
 * A light week's target (item 06; a: Bell 2025, SCJ, moderate recovery need): half the sets (volume down 40–60 %), the weight
 * about 10 % lighter on the lift's loadable weights (a typed increment wins), the range's bottom, stopping about 3 short (1–3 RIR
 * further from failure). Help or bodyweight keeps its load (the body can't be made lighter); a hold, its seconds' bottom.
 */
function lighten(t: Target, entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned?: number | null): Target {
  const unit = isHoldLift(exercise, entries) ? ' s' : '';
  const n = planned ?? t.perSet?.length ?? Math.max(1, t.last.filter((x) => isWorking(x) && !isTest(x)).length);
  const sets = Math.max(1, Math.round(n * LIGHT.volume));
  let w = t.weight, down: TargetPart | null = null;
  if (!unit && t.weight > 0) {
    const want = t.weight * (1 - LIGHT.load);
    const typed = st.increment !== DEFAULT_INCREMENT;
    const ladder = !typed ? learnedFor(entries, exercise, date).ladder : null;
    const x = ladder ? floorRung(ladder, want) : Math.floor(want / st.increment + 1e-9) * st.increment;
    if (x > 0 && x < t.weight) { w = x; down = stepPart('Down to a weight that loads', `${lb(t.weight)} → ${lb(w)}`, typed, ladder); }
  }
  const perSet = Array<number>(sets).fill(st.repMin);
  // The week's own lines first, then what made the weight it lightens (not its reps or sets: the week sets those). The reps are
  // the range's bottom, so the range is always a line.
  const parts: TargetPart[] = [{ key: 'light', what: 'Light week', value: `about ${Math.round(LIGHT.load * 100)} % lighter, ${sets} of ${n} sets, stop about ${LIGHT.rir} short`,
    evidence: { ev: 'a', cite: 'Bell 2025 (SCJ): a deload cuts volume 40–60 %, load about 10 %, or stops 1–3 reps further from failure' } },
  ...(down ? [down] : []), ...t.parts.filter((p) => !LIGHT_DROPS.has(p.key))];
  if (!parts.some((p) => p.key === 'range' || p.key === 'goal')) parts.push(rangePart(st, exercise, !!unit));
  if (planned != null) parts.push(planPart(`${planned} sets, halved`));
  return { kind: 'light', weight: w, reps: st.repMin, perSet, last: t.last, why: `Light week: about ${Math.round(LIGHT.load * 100)} % lighter, half the sets, stop about ${LIGHT.rir} short`,
    text: `Light week: ${lb(w)} × ${perSet.join(' · ')}${unit}`, parts };
}
/** A light week's reps and sets are its own: the lines that set them in the target it lightens don't carry over. */
const LIGHT_DROPS = new Set<TargetInput>(['hits', 'rir', 'drop', 'plan', 'bodyweight']);

function baseTarget(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned?: number | null): Target | null {
  const before = sessionsFor(entries, exercise).filter((x) => x.date < date && !lightSession(x.sets));
  const hold = isHoldLift(exercise, entries);
  // Just rotated in: the carried-over estimate, until the first session since the switch.
  const seed = st.seed;
  if (seed && date >= seed.date && !before.some((x) => x.date >= seed.date && x.sets.some(isWorking))) {
    // (b) rotation.carryOver: the old lift's fatigue-adjusted e1RM (the learning core) times the two lifts' ratio, at its low end.
    const ratio = seed.basis === 'catalog' ? 'the catalog’s ratio between the two' : seed.basis === 'history' ? 'the ratio your sessions of both show' : 'the ratio between the two';
    const parts: TargetPart[] = [{ key: 'seed', what: `Carried over from ${seed.from}`, date: seed.date,
      value: seed.e1rm ? `e1RM ${seed.e1rm} lb → ${lb(seed.weight)} × ${seed.reps}+` : `${lb(seed.weight)} × ${seed.reps}+`,
      evidence: { ev: 'b', method: `its fatigue-adjusted e1RM (the learning core) × ${ratio}, on the light side` } }];
    return { kind: 'carry', weight: seed.weight, reps: seed.reps, last: before[0]?.sets ?? [], text: `Estimate: ${lb(seed.weight)} × ${seed.reps}+`, parts };
  }
  if (!before.length) return null;
  // The session to progress from: the last one that isn't only test sets.
  const at = before.findIndex((x) => x.sets.some(isTraining) || !x.sets.some(isTest));
  // A test newer than it resets the working weight: the weight its e1RM (reps in reserve counted) gives at the top of the range.
  const tests = (at < 0 ? before : before.slice(0, at)).flatMap((x) => x.sets.filter((t) => isTest(t) && isWorking(t)));
  const testE1rm = (t: SetEntry) => e1rm({ ...t, reps: (t.reps as number) + (t.rir ?? 0) }) ?? 0;
  const best = Math.max(0, ...tests.map(testE1rm));
  if (best > 0) {
    const w = Math.max(st.increment, Math.round(estimateWeightForReps(best, st.repMax) / st.increment) * st.increment);
    const t = tests.find((x) => testE1rm(x) === best)!;
    const parts: TargetPart[] = [
      { key: 'test', what: 'Your test set', date: t.date, value: `${lb(t.weight)} × ${t.reps}${t.rir ? `, ${t.rir} in reserve` : ''} → e1RM ${Math.round(best)} lb`,
        evidence: { ev: 'b', method: 'its e1RM by Epley, reps in reserve counted; the weight for the top of the range' } },
      rangePart(st, exercise, hold),
      stepPart('Rounded to', `${lb(st.increment)} steps`, st.increment !== DEFAULT_INCREMENT, null),
    ];
    return { kind: 'test', weight: w, reps: st.repMin, last: before[0].sets, text: `From your test: ${lb(w)} × ${st.repMin}+`, parts };
  }
  const last = before[Math.max(0, at)];
  const working = last.sets.filter(isProgressionSet);
  // Item 14: a lift whose load is the body reads each set's weight as what was added to it, help kept in an older import's note
  // counted below bodyweight (learn/bodyweight), so "BW × 10" and "BW − 30 × 10" are different sets.
  const unit = hold ? 's' : '';
  const body = !unit && bodyShare(exercise) != null;
  const load = (x: SetEntry) => (body ? addedLoad(x) : x.weight);
  const parts: TargetPart[] = [lastPart(last, load, unit ? ' s' : '')];
  if (!working.length) {
    const w = Math.max(...last.sets.map(load));
    parts.push({ key: 'progress', what: 'No complete sets last time', value: 'repeat the weight', evidence: { ev: 'c', note: 'nothing whole to add reps to' } },
      rangePart(st, exercise, hold));
    return { kind: 'repeat', weight: w, reps: st.repMin, last: last.sets, text: `Repeat ${lb(w)} and log every rep`, parts };
  }
  const top = Math.max(...working.map(load));
  // Items 01–03 for loaded rep lifts: the learned step and drop, and the range fitted to them.
  const learned = !unit && top > 0 ? learnedFor(entries, exercise, date) : { ladder: null, drop: null };
  const fit = learned.drop ? fitRange(exercise, st, Math.max(0, learned.drop.mean)) : null;
  const range = fit && fit.how !== 'fits' && fit.how !== 'too-big' ? fit : null;
  const repMin = range?.repMin ?? st.repMin, repMax = range?.repMax ?? st.repMax;
  const all = working.filter((x) => load(x) === top);
  // The best N, kept in the order done.
  const bestN = planned != null && planned > 0 && all.length > planned ? new Set([...all].sort((a, b) => (b.reps as number) - (a.reps as number)).slice(0, planned)) : null;
  const atTop = bestN ? all.filter((x) => bestN.has(x)) : all;
  const minReps = Math.min(...atTop.map((x) => x.reps as number));
  /** A plan with more sets than last time: the extra sets aim at the last one's number. */
  const extend = (aimed: number[]) => (planned != null && planned > aimed.length ? [...aimed, ...Array<number>(planned - aimed.length).fill(aimed.at(-1)!)] : aimed);
  /** The plan's line, when it moved this target: the best N of more sets, or, for a target a set, sets added past last time's `n`. */
  const planLine = (n?: number) => {
    if (bestN) parts.push(planPart(`${planned} sets: from your best ${planned} of ${all.length} at ${lb(top)}`));
    else if (n != null && planned != null && planned > n) parts.push(planPart(`${planned} sets: the extra ${planned - n === 1 ? 'one aims' : `${planned - n} aim`} at the last one’s number`));
  };
  // Item 08: pain last time (or in a region this lift loads, lately) holds the lift, or eases it a step after sharp pain (a:
  // painPlan). Same reps as last time: a hold progresses nothing; an ease takes the load off, not the reps.
  const gate = painGate(entries, exercise, date);
  if (gate) {
    const reps = atTop.map((x) => x.reps as number);
    const perSet = extend(reps);
    // One step lighter: the smallest change the gear allows (a typed increment, else the learned ladder's rung below), so the
    // next session says whether it was enough. A bodyweight lift (item 14) can go down to bodyweight, and below it with help:
    // one rung more on its assisted machine's stack (learned like any stack, item 01), or, at bodyweight, the first rung where he
    // has used help on this lift at this gym. With no help known, the load can't come down, so the dose does: one rep off each
    // set, the smallest change the log can express (the same rule as one rung; a: Silbernagel & Crossley 2015, above 5/10 the load
    // must come down; here, how close each set goes to failure). A hold, with nothing to take off, is held.
    const typed = st.increment !== DEFAULT_INCREMENT;
    let down: number | null = null, easeBy: Target['easeBy'] = 'load', stepLadder: Ladder | null = null;
    if (gate.kind === 'ease' && top > 0) {
      stepLadder = !typed ? learned.ladder : null;
      const w = stepLadder ? prevRung(stepLadder, top) : top - st.increment;
      down = body ? Math.max(0, w) : w > 0 ? w : null;
    } else if (gate.kind === 'ease' && body) {
      const help = !typed ? ladderOf(entries, exercise, undefined, true) : null;
      if (top < 0 || help?.known.length) { stepLadder = help; down = -(help ? nextRung(help, -top) : -top + st.increment); easeBy = 'help'; }
    }
    const fewer = gate.kind === 'ease' && body && down == null && perSet.some((r) => r > 1);
    const kind = down != null || fewer ? 'ease' as const : 'hold' as const;
    const w = down ?? top;
    const aimed = fewer ? perSet.map((r) => Math.max(1, r - 1)) : perSet;
    if (fewer) easeBy = 'reps';
    const why = painWhy(gate, kind === 'hold' ? 'hold' : easeBy ?? 'load', lb(w));
    parts.push(painPart(gate, kind === 'hold' ? `hold ${lb(w)} and last time’s reps` : easeBy === 'reps' ? 'one rep fewer a set' : easeBy === 'help' ? 'a step more help' : 'one step lighter'));
    if (down != null) parts.push(stepPart(easeBy === 'help' ? 'More help' : 'Down', `${lb(top)} → ${lb(w)}`, typed, stepLadder));
    planLine(reps.length);
    return { kind, weight: w, reps: Math.min(...aimed), perSet: aimed, last: last.sets, why, pain: gate, ...(kind === 'ease' && { easeBy }), text: `${lb(w)} × ${aimed.join(' · ')}${unit ? ' s' : ''}`, parts };
  }
  // Up once the sets at the top weight total within 2 reps of all at the top of the range (12/12/10 at 3 × 8–12), none below its bottom.
  const total = atTop.reduce((a, x) => a + (x.reps as number), 0);
  const topped = total >= atTop.length * repMax - Math.min(2, atTop.length - 1) && minReps >= repMin; // one heavier top set gets no slack
  // The range, and the fit that moved it (item 03: a, growth alike over 5–30 reps; b, his drop, on its own line), as read here.
  const rangeLines = (): TargetPart[] => [rangePart(st, exercise, hold), ...(range ? [{ key: 'fit' as const, what: range.how === 'top' ? 'Range raised for your jumps' : 'Range lowered for your jumps',
    value: `${range.repMin}–${range.repMax} reps, so the next weight lands inside it`,
    evidence: { ev: 'a' as const, cite: 'Schoenfeld 2017 (JSCR 31:3508), Lopez 2021 (MSSE 53:1206): growth is alike from 5 to 30 reps, so the range can move' } }] : [])];
  // Topped: the total that went up; not yet, the total it goes up at (and every set at the bottom, when one wasn't).
  const need = atTop.length * repMax - Math.min(2, atTop.length - 1);
  const progress = (what: string): TargetPart => ({ key: 'progress', what, evidence: { ev: 'a', cite: PLOTKIN },
    value: `${total}${unit ? ' s' : ' reps'} over ${atTop.length} × ${repMax}${unit ? ' s' : ''}${topped ? '' : `: up at ${need}${minReps < repMin ? `, every set ${repMin}+` : ''}`}` });
  // Item 14: an assisted bodyweight lift whose range is topped takes a step less help: the rung below on its assisted machine's
  // stack (learned, item 01; a typed increment wins), up to bodyweight.
  if (body && top < 0 && topped) {
    const typed = st.increment !== DEFAULT_INCREMENT;
    const help = !typed ? ladderOf(entries, exercise, undefined, true) : null;
    const w = Math.min(0, help ? -prevRung(help, -top) : top + st.increment) || 0;
    const step = Math.round((w - top) * 100) / 100;
    parts.push(progress('Range topped last time'), ...rangeLines(), stepPart('Less help', `${lb(top)} → ${lb(w)}`, typed, help));
    planLine();
    return { kind: 'increase', weight: w, reps: repMin, last: last.sets, done: { total, sets: atTop.length }, step, text: `Go up: ${lb(w)} × ${repMin}+`, parts };
  }
  if (top > 0 && topped) {
    // The next loadable weight (item 01): a typed increment wins, else the learned ladder's next rung, else +increment.
    const typed = st.increment !== DEFAULT_INCREMENT;
    const w = !typed && learned.ladder ? nextRung(learned.ladder, top) : top + st.increment;
    const step = Math.round((w - top) * 100) / 100;
    const base = { kind: 'increase' as const, weight: w, last: last.sets, done: { total, sets: atTop.length }, step, ...(range && { range }) };
    parts.push(progress('Range topped last time'), ...rangeLines(), stepPart('Up', `${lb(top)} → ${lb(w)}`, typed, typed ? null : learned.ladder));
    const drop = learned.drop;
    if (!unit && drop) {
      // Item 02: each set from last time's same set, less the learned drop (floored: a miss costs more than an easy day), so
      // the sets keep their shape (12, 12, 11 → 10, 10, 9); never past the range's top.
      const aimed = atTop.map((x) => clamp(Math.floor((x.reps as number) - Math.max(0, drop.mean) + 1e-9), 1, repMax));
      const perSet = extend(aimed);
      const ladder = learned.ladder;
      const stepWhy = typed || !ladder ? `+${lb(step)}` : `+${lb(step)}, ${ladder.pool && ladder.source === 'pool' ? STEP_OF[ladder.pool] ?? 'your steps' : ladder.pool ? 'its own steps' : 'this machine’s steps'}`;
      const why = `${stepWhy} · jumps cost you ${r05(Math.max(0, drop.mean))}`;
      parts.push({ key: 'drop', what: 'Reps a jump costs you', value: `${r05(Math.max(0, drop.mean))} a set, off last time’s same set`,
        evidence: { ev: 'b', method: `learned from ${drop.all} weight increase${drop.all === 1 ? '' : 's'}${drop.n ? ` (${drop.n} on this lift)` : ''}, fatigue-adjusted by the learning core` } });
      planLine(aimed.length);
      return { ...base, reps: Math.min(...perSet), perSet, why, drop, text: `Go up: ${lb(w)} × ${perSet.join(' · ')}`, parts };
    }
    planLine();
    return { ...base, reps: repMin, text: `Go up: ${lb(w)} × ${repMin}${unit}+`, parts };
  }
  // A bodyweight hold at the top of its range has nowhere to go in time: add weight or a harder variation.
  if (unit && top === 0 && topped) {
    parts.push(progress('Range topped last time'), rangePart(st, exercise, hold));
    planLine();
    return { kind: 'maxed', weight: 0, reps: st.repMax, last: last.sets, text: `BW × ${st.repMax}s held: add weight or try a harder variation`, parts };
  }
  // Bodyweight reps have no weight to add, so their target is not capped by the range. Holds step in 5 s, like the stepper,
  // and have no RIR.
  const by = unit ? 5 : 1;
  const hits = targetsHit(before.slice(Math.max(0, at)));
  const wanted = stepFrom(hits);
  const uncapped = top === 0 && !unit;
  const { perSet: aimed, step, rir } = perSetTargets(atTop.map((x) => ({ reps: x.reps as number, ...(!unit && x.rir != null && { rir: x.rir }) })),
    wanted, uncapped ? Infinity : repMax, by);
  // A plan with more sets than last time: the extra sets aim at the last one's number.
  const perSet = extend(aimed);
  const plus = `+${by}${unit || (by === 1 ? ' rep' : ' reps')}`;
  const rule = step === 'all' ? (hits[0] ? `Targets hit last time: ${plus} a set` : `Last time ${plus} a set`)
    : step === 'one' ? (wanted === 'one' ? `Missed last time: ${plus} on one set` : `Most sets at their limit: ${plus} on one set`)
    : wanted === 'repeat' ? 'Missed twice lately: repeat last time' : 'Sets at their limit last time: repeat them';
  // Item 03: a range moved by the learned drop says so, in a few words.
  // Item 14: at bodyweight with the range topped there's no weight to go up to here (without his body weight the app can't say how
  // much to add), so the reps keep climbing, and the card says the range is done (display only).
  const atBw = body && top === 0 && topped ? ' · range topped at bodyweight: add weight or a harder variation' : '';
  const why = (range ? `${rule} · ${range.how === 'top' ? `to ${range.repMax} before going up` : `${range.repMin}+ is fine after going up`}` : rule) + atBw;
  // The range read for "topped" (and, loaded, each set's cap). Hits: the stall rule, when there were targets to go by; it moved
  // the step only when one was missed (all hit is what no targets gives too).
  // Bodyweight reps aren't capped, so the range moves no number there: its own line says what it does.
  if (!uncapped) parts.push(progress(topped ? 'Range topped last time' : 'Range not topped yet'), ...rangeLines());
  if (hits.some((h) => !h)) parts.push({ key: 'hits', what: `Targets, last ${hits.length === 1 ? 'session' : `${hits.length} sessions`}`, value: `${hits.map((h) => (h ? 'hit' : 'missed')).join(' · ')}: ${wanted === 'repeat' ? 'repeat last time' : `${plus} on one set`}`,
    evidence: { ev: 'c', note: 'a fixed rule: missed once, one set goes up; missed twice in 3, repeat' } });
  if (rir) parts.push({ key: 'rir', what: 'Reps in reserve you logged', value: 'no set aims past its reps + RIR', evidence: { ev: 'b', method: 'your log: a set at RIR 0 gets no rep' } });
  if (uncapped) parts.push({ key: 'bodyweight', what: 'Bodyweight reps', value: topped ? `past ${repMax}: add weight or a harder variation` : 'not capped by the range',
    evidence: { ev: 'c', note: 'no weight to add here without your body weight' } });
  planLine(aimed.length);
  return { kind: 'reps', weight: top, reps: Math.min(...perSet), last: last.sets, perSet, why, ...(range && { range, drop: learned.drop! }), text: `${lb(top)} × ${perSet.join(' · ')}${unit ? ' s' : ''}`, parts };
}
