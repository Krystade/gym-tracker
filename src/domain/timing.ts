import { defaultSettings, settingsKey } from './progression';
import { daySets, doneAt, perLog, sameExercise } from './stats';
import { addDays } from './analytics';
import type { Program, ProgramDay } from './program';
import type { SetEntry } from './types';
import { supersets, type Gap, type Superset } from './superset';
import { gapModel, lastDate, type SwitchModel } from './learn/switch';

/** Seconds, until your own data takes over: a set plus its rest, a switch between lifts (paces: suggestTime's fallback). */
export const DEFAULT_PACE = { compound: 180, isolation: 120, transition: 120 } as const;
const MAX_SAME = 10 * 60, MAX_SWITCH = 15 * 60, MIN_SAMPLES = 3;

const secs = (e: SetEntry) => doneAt(e) / 1000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** One day's sets that have a time, in the order they were done. Sets added later without a time are left out. */
export const timedDay = (entries: SetEntry[], date: string): SetEntry[] =>
  daySets(entries, date).filter((e) => e.loggedAt).sort((a, b) => secs(a) - secs(b));

/**
 * `perSet`: per lift, every gap's median, for a late set's time. A lift's rest goes by none of these (restFor): they describe
 * the habit, not what's best. How long a session takes is learn/session's; a superset's switch, learn/switch's.
 */
export interface Paces {
  perSet: Map<string, number>; transition: number;
  /** Per lift class, the median of every same-lift gap of that class (MIN_SAMPLES or more): a lift's usual rest before it has its own. */
  byClass: { isolation?: number; compound?: number };
}

/** One timed day per date, each in the order done, the days oldest first. */
function timedDays(entries: readonly SetEntry[]): SetEntry[][] {
  const days = new Map<string, SetEntry[]>();
  for (const e of entries) if (e.loggedAt) { const d = days.get(e.date); if (d) d.push(e); else days.set(e.date, [e]); }
  return [...days.values()].map((d) => d.sort((a, b) => secs(a) - secs(b))).sort((a, b) => secs(a[0]) - secs(b[0]));
}

/** Per lift, the time from one set to the next (≤ 10 min), oldest first, leaving out the gaps `skip` says to. */
function gapLists(days: SetEntry[][], skip: (day: SetEntry[], i: number) => boolean = () => false): Map<string, number[]> {
  const same = new Map<string, number[]>();
  for (const day of days) {
    for (let i = 1; i < day.length; i++) {
      const gap = secs(day[i]) - secs(day[i - 1]);
      if (gap <= 0 || gap > MAX_SAME || !sameExercise(day[i].exercise, day[i - 1].exercise) || skip(day, i)) continue;
      const k = settingsKey(day[i].exercise);
      const xs = same.get(k);
      if (xs) xs.push(gap); else same.set(k, [gap]);
    }
  }
  return same;
}
/** Each lift's median gap, where it has `min` or more. */
const medians = (lists: Map<string, number[]>, min: number): Map<string, number> =>
  new Map([...lists].filter(([, xs]) => xs.length >= min).map(([k, xs]) => [k, median(xs)]));

/**
 * Your pace from timed days: per lift, the median time from one set to the next (≤ 10 min); between lifts, the median switch
 * (≤ 15 min). A superset's gaps are neither (learn/switch learns its switches), and the rest after its round is no lift's own
 * rest and no switch between lifts.
 */
export const paces: (entries: SetEntry[]) => Paces = perLog((entries) => pacesOf(entries));
// Once per log array: Today alone reads it in every card. Shared, so never changed by a caller.
function pacesOf(entries: readonly SetEntry[]): Paces {
  const days = timedDays(entries);
  // Which gaps are a superset's: each day read as Today read it, with his gap model as of the log's last day.
  const model = days.length ? gapModel(entries, lastDate(entries)) : null;
  const sw: number[] = [];
  const inside = new Map<SetEntry[], (i: number) => boolean>();
  for (const day of days) {
    const of = new Map<string, Superset>();
    for (const g of supersets(day, day[0].date, model!)) for (const id of g.after.keys()) of.set(id, g);
    // Set i follows a set of a superset with a set of one of its lifts.
    const within = (i: number) => !!of.get(day[i - 1].id)?.keys.includes(settingsKey(day[i].exercise));
    inside.set(day, within);
    for (let i = 1; i < day.length; i++) {
      const gap = secs(day[i]) - secs(day[i - 1]);
      if (gap <= 0 || gap > MAX_SWITCH || sameExercise(day[i].exercise, day[i - 1].exercise)) continue;
      if (!within(i)) sw.push(gap);
    }
  }
  const own = gapLists(days, (day, i) => inside.get(day)!(i));
  const iso: number[] = [], comp: number[] = [];
  for (const [k, xs] of own) (defaultSettings(k).repMin >= 10 ? iso : comp).push(...xs);
  return {
    perSet: medians(own, MIN_SAMPLES), transition: sw.length >= MIN_SAMPLES ? median(sw) : DEFAULT_PACE.transition,
    byClass: { ...(iso.length >= MIN_SAMPLES && { isolation: median(iso) }), ...(comp.length >= MIN_SAMPLES && { compound: median(comp) }) },
  };
}

export const perSetSeconds = (p: Paces, exercise: string): number =>
  p.perSet.get(settingsKey(exercise)) ?? (defaultSettings(exercise).repMin >= 10 ? DEFAULT_PACE.isolation : DEFAULT_PACE.compound);

/**
 * (a) About how long a set itself takes: 2–4 s a rep (Schoenfeld, Ogborn & Krieger 2015, Sports Med 45:577: repetitions of 0.5–8 s
 * in the trials), the upper end, which the backtest also found (round 2: about 4 s a rep, though its SE was near 5). His gaps can't
 * learn it (that would take ~466 superset sessions): the set's own start-to-save time can (SetEntry.workS, setWork).
 */
export const REP_S = 4;
/** The prior for a set of ~10 reps (REP_S a rep), where the reps aren't known: what plans and the learning core assume. */
export const SET_WORK = REP_S * 10;
/** A lift's own set time is used once it has this many timed sets (owner, 2026-11-22). */
export const WORK_MIN = 5;
/** A start-to-save time outside this (s) isn't a set: a start tapped after it, or a card left open. */
const WORK_LO = 5, WORK_HI = 300;
/** Per lift, the median of its timed sets' own time (SetEntry.workS; working sets, within WORK_LO–WORK_HI), and how many. */
export const setWorks: (entries: readonly SetEntry[]) => Map<string, { median: number; n: number }> = perLog((entries) => {
  const by = new Map<string, number[]>();
  for (const e of entries) {
    if (e.workS == null || e.workS < WORK_LO || e.workS > WORK_HI || e.flags.includes('warmup')) continue;
    const k = settingsKey(e.exercise), xs = by.get(k);
    if (xs) xs.push(e.workS); else by.set(k, [e.workS]);
  }
  return new Map([...by].map(([k, xs]) => [k, { median: median(xs), n: xs.length }]));
});
/**
 * How long a set of `exercise` takes, s: its own median set time once WORK_MIN of its sets are timed (`learned`: how many), else
 * REP_S a rep (`reps`, else ~10).
 */
export function setWork(works: ReadonlyMap<string, { median: number; n: number }> | null | undefined, exercise: string, reps?: number | null): { seconds: number; learned: number } {
  const w = works?.get(settingsKey(exercise));
  return w && w.n >= WORK_MIN ? { seconds: Math.round(w.median), learned: w.n } : { seconds: REP_S * (reps != null && reps > 0 ? reps : 10), learned: 0 };
}
/**
 * The research default rest (owner, 2026-10-19): 2:00 for an isolation (small) lift, 3:00 for a compound (big) one. It
 * prescribes; his own set-to-set gaps (5 – 7:30) are a habit, and never move it (owner, 2026-10-20).
 */
const REST = { isolation: 120, compound: 180 } as const;
/** A small (isolation) lift, by its default range: the rest timer's two classes, and the session forecast's two kinds. */
export const isIsolation = (exercise: string) => defaultSettings(exercise).repMin >= 10;
const defaultRest = (exercise: string) => (isIsolation(exercise) ? REST.isolation : REST.compound);

/** A set done earlier in the session, for a learned rest (learn/rest): its lift, seconds before the set just done, its RIR. */
export interface Prior { exercise: string; ago: number; rir?: number | null }
/** A learned rest for a plan (learn/rest kneePlan): lift `exercise`'s, after the session's sets so far; null: none to use. */
export type KneeAt = (exercise: string, prior: readonly Prior[]) => number | null;
/**
 * A rest learned from his own sets (item 17, learn/rest): `usual` the knee at his usual effort and `seconds` after this set's (its
 * RIR read), both as the timer would use them; `mid` its median and `lo`–`hi` its 90 % band, unrounded; `tight` whether that band
 * is narrow, `tried` whether the median sits inside the middle 90 % of the rests he has timed (`rests`), and `use` both (else the
 * research default stands); `delta` the reps 30 s more rest must buy to be worth it.
 */
export interface KneeRest {
  usual: number; seconds: number; mid: number; lo: number; hi: number;
  tight: boolean; tried: boolean; use: boolean; rests: { lo: number; hi: number }; delta: number;
}

/**
 * The rest timer starts shorter than his usual rest (owner, 2026-11-22, from the backtest's round 2 §F): his isolation rests run
 * a median 3.9 min and his compounds 6.3; starting them at about 3¼ and 5 min costs under half a rep (0.13 reps a minute cut,
 * not distinguishable from 0) and saves about 3½ min a session. The fit through both, (3.25·3.9 + 5·6.3) / (3.9² + 6.3²), is 0.80.
 */
export const SHORTER = 0.8;
/** The backtest's floors for that start (§F): a shortened rest never goes under 1:30 (isolation) or 2:30 (compound). */
export const SHORTER_FLOOR = { isolation: 90, compound: 150 } as const;
/** His usual rest for a lift: its own median set-to-set gap (paces), else his class's; null with no timed rests. */
export const usualRest = (p: Paces, exercise: string): number | null =>
  p.perSet.get(settingsKey(exercise)) ?? (isIsolation(exercise) ? p.byClass.isolation : p.byClass.compound) ?? null;
/** The timer's start from his usual rest: SHORTER of it, to 5 s, within its floor and the timer's 5:00; null without one. */
export function shorterRest(p: Paces, exercise: string): { seconds: number; usual: number } | null {
  const usual = usualRest(p, exercise);
  if (usual == null) return null;
  const floor = isIsolation(exercise) ? SHORTER_FLOOR.isolation : SHORTER_FLOOR.compound;
  return { seconds: Math.min(REST_MAX_S, Math.max(floor, Math.round(usual * SHORTER / 5) * 5)), usual };
}

/**
 * Where a lift's base rest came from: his setting, kept from the timer's ±30 s; his own sets (item 17); his usual rest,
 * shortened (shorterRest); or the research default.
 */
export type RestFrom = 'kept' | 'knee' | 'usual' | 'default';
function baseRest(exercise: string, kept?: number, knee?: number | null, usual?: number | null): { base: number; from: RestFrom } {
  return kept != null && kept > 0 ? { base: kept, from: 'kept' } : knee != null ? { base: knee, from: 'knee' }
    : usual != null ? { base: usual, from: 'usual' } : { base: defaultRest(exercise), from: 'default' };
}
/**
 * A lift's base rest: the one he kept for it with the timer's ±30 s (`kept`, ExerciseSettings.rest); else the knee his sets show
 * (`knee`, learn/rest: only once its band is tight); else the research default.
 */
export const restSeconds = (exercise: string, kept?: number, knee?: number | null): number => baseRest(exercise, kept, knee).base;

/** (c) A warm-up's rest: 60 s for an isolation lift, 90 s for a compound one (no study; 00-core §4.1). */
export const warmupRest = (exercise: string): number => (isIsolation(exercise) ? 60 : 90);

/** The rest's bounds, and what effort can move it by. */
export const REST_MIN_S = 45, REST_MAX_S = 300, REST_STEP = 30;
/** `effort`: seconds added (or taken off); `warmup`: a warm-up's fixed rest, base and the rest not read. */
export interface RestWhy { base: number; from: RestFrom; effort: number; warmup?: boolean }
/**
 * One line of why a rest (or a superset's switch) is its length, for the timer's "?": `s` seconds, a change to the line
 * above when `add`, and a `note` on where it came from. A rest's lines add up to it.
 */
export interface RestPart { what: string; s: number; add?: true; note?: string }
const mss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** A knee's band, as the "?" says it: past the timer's 5:00 it's "over 5:00". */
const band = (k: KneeRest) => k.hi > REST_MAX_S ? `${mss(k.lo)} to over ${mss(REST_MAX_S)}` : `${mss(k.lo)}–${mss(k.hi)}`;
/** Why his own knee isn't in use yet: its band is wide, or it sits outside the rests he has timed (a fit can't speak there). */
const unproven = (k: KneeRest) => !k.tight ? `your timed sets can’t pin your own yet: ${band(k)}`
  : k.mid < k.rests.lo ? `your sets point to under ${mss(k.rests.lo)}, shorter than the rests you’ve timed`
  : `your sets point to over ${mss(k.rests.hi)}, longer than the rests you’ve timed`;
/** The shortened start's cost and gain, as the backtest found them (owner, 2026-11-22). */
export const SHORTER_WHY = 'shorter than your usual: costs about 0.3 reps, saves ~3 min a session';
/** δ as the "?" says it: rounded up to a tenth, so "under" stays true. */
const repsOf = (d: number) => `${Math.ceil(d * 10) / 10}`;

/**
 * The rest after `set` (owner, 2026-10-19). A warm-up: 60 s (isolation) or 90 s (compound). Otherwise the lift's base rest
 * (restSeconds: his setting, else his knee once tight, else his usual rest shortened (`usual`, shorterRest: 0.8 of it), else the
 * research default, 2:00 / 3:00, only with no timed rests), then effort, and the total kept within
 * 45 s – 5 min. Effort, with his knee: as learn/rest reads this set's RIR (a: Refalo 2023, nearer failure leaves more to
 * recover); without it: RIR 0 +30 s, RIR 3 or more −30 s (RIR 1–2 or not logged: nothing). The set's load moves nothing: no
 * evidence it should, 80 % and 50 % of 1RM alike (owner, 2026-10-20). `knee`: learn/rest kneeAfter's, null without timed sets.
 * `parts`: the same, line by line (RestPart), leaving out what moved nothing; his setting says what his sets (or research)
 * suggest, where that's different; the research default says how far his own sets have got.
 */
export function restFor(set: SetEntry, o: { kept?: number; knee?: KneeRest | null; usual?: { seconds: number; usual: number } | null } = {}): { seconds: number; why: RestWhy; parts: RestPart[] } {
  const learned = o.knee?.use ? o.knee : null;
  const { base, from } = baseRest(set.exercise, o.kept, learned?.usual, o.usual?.seconds);
  const iso = isIsolation(set.exercise);
  if (set.flags.includes('warmup')) {
    const seconds = warmupRest(set.exercise);
    return { seconds, why: { base, from, effort: 0, warmup: true }, parts: [{ what: 'Warm-up', s: seconds, note: iso ? 'isolation lift' : 'compound lift' }] };
  }
  const effort = learned ? learned.seconds - learned.usual : set.rir === 0 ? REST_STEP : set.rir != null && set.rir >= 3 ? -REST_STEP : 0;
  const sum = base + effort, seconds = Math.min(REST_MAX_S, Math.max(REST_MIN_S, sum));
  const research = defaultRest(set.exercise), kind = iso ? 'small lift' : 'big lift';
  const suggests = learned ? { s: learned.usual, by: 'Your sets suggest' } : { s: research, by: 'Research suggests' };
  const parts: RestPart[] = [
    from === 'default' ? { what: 'Research default', s: base, note: o.knee ? `${kind} · ${unproven(o.knee)}` : kind }
    : from === 'knee' ? { what: 'Learned from your sets', s: base, note: `past it, 30 s more gains under ${repsOf(learned!.delta)} rep · likely ${band(learned!)}` }
    : from === 'usual' ? { what: 'Your usual, shortened', s: base, note: `usual ${mss(Math.round(o.usual!.usual))} · ${SHORTER_WHY}` }
    : { what: 'Your setting', s: base, ...(base !== suggests.s && { note: `${suggests.by} ${mss(suggests.s)}` }) }];
  if (effort) parts.push({ what: `RIR ${set.rir}`, s: effort, add: true, ...(learned && { note: effort > 0 ? 'nearer failure: more to recover' : 'further from failure: less to recover' }) });
  if (seconds !== sum) parts.push({ what: seconds === REST_MIN_S ? `At least ${mss(REST_MIN_S)}` : `At most ${mss(REST_MAX_S)}`, s: seconds - sum, add: true });
  return { seconds, why: { base, from, effort }, parts };
}

/**
 * The timer after a set. Inside a superset with a lift still to go in the round (`next`): the switch (switchFor). Otherwise,
 * the lift's full rest (`kept`: the one you set, see restSeconds).
 */
export function restAfter(model: SwitchModel, exercise: string, next: string | null | undefined, kept?: number): { seconds: number; switchTo?: string } {
  if (!next) return { seconds: restSeconds(exercise, kept) };
  return { seconds: switchFor(model, exercise, next).seconds, switchTo: next };
}
/**
 * Inside a superset, the switch from `from` to the round's next lift `to`, with its lines for the timer's "?" (RestPart). No
 * rest between the paired lifts (a: Zhang, Weakley et al. 2025, Sports Med: 15 of the 19 trials went straight on; Maia et al.
 * 2014, JSCR 28(9): the shortest rest between them did best), so the switch is only the time to get there: his switch, its
 * median (learn/switch, b: pooled person → family → pair; today's pace and switches move it), less the set itself (SET_WORK,
 * a); with none of his own, the trials' (a). Never under 0. `today`: the day's rests and this group's switches so far.
 */
export function switchFor(model: SwitchModel, from: string, to: string, today: { rests?: readonly Gap[]; switches?: readonly Gap[] } = {},
  work: { seconds: number; learned: number } = { seconds: SET_WORK, learned: 0 }): { seconds: number; parts: RestPart[] } {
  const gap = Math.round(model.switchSeconds(from, to, today)), sum = gap - work.seconds, seconds = Math.max(0, sum);
  const pair = Math.round(model.pairSwitches(from, to) + (today.switches?.filter((g) => (sameExercise(g.from, from) && sameExercise(g.to, to)) || (sameExercise(g.from, to) && sameExercise(g.to, from))).length ?? 0));
  const note = pair ? `from ${pair} timed, set included` : model.switches >= 0.5 || today.switches?.length ? 'like your other switches, set included' : 'trials go straight on, set included';
  const parts: RestPart[] = [{ what: pair || model.switches >= 0.5 || today.switches?.length ? 'Your switch' : 'Switch in trials', s: gap, note }, { what: 'Less the set itself', s: -work.seconds, add: true, note: work.learned ? `your median, ${work.learned} timed` : `about ${REP_S} s a rep` }];
  if (seconds !== sum) parts.push({ what: 'At least 0:00', s: seconds - sum, add: true });
  return { seconds, parts };
}

/**
 * One set of a session, in the order it's done: a lift's warm-up or working set, or a cardio bout (`seconds`: its planned
 * time). What a plan's length and the session forecast (learn/session) are summed over.
 */
export interface Step { exercise: string; warmup?: boolean; seconds?: number }
export interface PlanSlot { exercise: string; sets: number; minutes?: number }

/**
 * A day's slots as the sets they'll be done as: each lift's warm-ups, then its working sets; a cardio slot is one bout. Only
 * the session's first lift that warms up (`warmups(ex)` sets) does (the others are warm by then).
 */
export function stepsOf(slots: readonly PlanSlot[], warmups: (ex: string) => number = () => 0): Step[] {
  const first = slots.find((s) => s.minutes == null && warmups(s.exercise) > 0);
  return slots.flatMap((s): Step[] => s.minutes != null ? [{ exercise: s.exercise, seconds: s.minutes * 60 }]
    : [...Array.from({ length: s === first ? warmups(s.exercise) : 0 }, () => ({ exercise: s.exercise, warmup: true })),
      ...Array.from({ length: s.sets }, () => ({ exercise: s.exercise }))]);
}

/** The steps still to do: each slot's sets not done yet (`done(ex)`), the lift being done now (`now`) first; its warm-ups only if it isn't started. */
export function stepsLeft(slots: readonly PlanSlot[], done: (ex: string) => number, now: string | null, warmups: (ex: string) => number = () => 0): Step[] {
  const first = slots.find((s) => s.minutes == null && warmups(s.exercise) > 0);
  const left = slots.map((s) => ({ ...s, sets: s.minutes != null ? (done(s.exercise) > 0 ? 0 : 1) : Math.max(0, s.sets - done(s.exercise)) }))
    .filter((s) => s.sets > 0);
  const at = now == null ? -1 : left.findIndex((s) => s.exercise.toLowerCase() === now.toLowerCase());
  const order = at < 0 ? left : [left[at], ...left.filter((_, i) => i !== at)];
  return stepsOf(order, (ex) => (first && ex === first.exercise && done(ex) === 0 ? warmups(ex) : 0));
}

/**
 * How long a plan should take (owner, 2026-10-20: sized for good training, not his habit): the first set, then before each set
 * the rest the timer prescribes after the one before it (restSeconds: his ±30 s setting `kept(ex)`, else his knee `knee(ex, the
 * session's sets so far)` where learn/rest has one, else the research default; a warm-up's warmupRest; none after cardio, which
 * has no timer) and the set itself (SET_WORK, a cardio bout its minutes), plus `overhead` (learn/session, b: what a switch to
 * another lift takes him beyond a set-to-set gap) at each switch. Effort isn't known before a set, so the RIR's part is not in it:
 * a knee is at his usual effort.
 */
export function planSeconds(steps: readonly Step[], o: { kept?: (ex: string) => number | undefined; overhead?: number; knee?: KneeAt; work?: (ex: string) => number } = {}): number {
  if (!steps.length) return 0;
  // A set's own time: his for the lift where it's learned (setWork, `o.work`), else the prior.
  const work = (s: Step) => s.seconds ?? o.work?.(s.exercise) ?? SET_WORK;
  // The session's hard sets so far and when each would be done, for a knee (position- and session-aware).
  const hard = (s: Step) => s.seconds == null && !s.warmup;
  const done: { exercise: string; at: number }[] = [];
  let t = work(steps[0]);
  if (hard(steps[0])) done.push({ exercise: steps[0].exercise, at: t });
  for (let k = 1; k < steps.length; k++) {
    const a = steps[k - 1], b = steps[k];
    let rest = 0;
    if (a.seconds == null) {
      if (a.warmup) rest = warmupRest(a.exercise);
      else {
        const kept = o.kept?.(a.exercise);
        const knee = !(kept != null && kept > 0) && o.knee ? o.knee(a.exercise, done.map((d) => ({ exercise: d.exercise, ago: t - d.at }))) : null;
        rest = restSeconds(a.exercise, kept, knee);
      }
    }
    t += rest + work(b) + (a.exercise.toLowerCase() !== b.exercise.toLowerCase() ? o.overhead ?? 0 : 0);
    if (hard(b)) done.push({ exercise: b.exercise, at: t });
  }
  return t;
}

/**
 * How long a logged day took: from the start of its first timed set (its done-time less SET_WORK) to the done-time of its
 * last. Null with fewer than 2 timed sets. The session forecast (learn/session) predicts the same span.
 */
export function sessionMinutes(entries: SetEntry[], date: string): number | null {
  const day = timedDay(entries, date);
  if (day.length < 2) return null;
  return Math.round((secs(day.at(-1)!) - secs(day[0]) + SET_WORK) / 60);
}

/**
 * A "when" for a set entered late, as HH:MM: the middle of the day's unusually long gap (over twice the median and 2 min longer),
 * else one of the day's typical gaps after the last timed set (the long-run pace if it has one set), never after `now`. Null when the day has no timed sets.
 */
export function suggestTime(entries: SetEntry[], date: string, exercise: string, p: Paces, now: Date): string | null {
  const day = timedDay(entries, date);
  if (!day.length) return null;
  const gaps = day.slice(1).map((e, i) => [secs(day[i]), secs(e)] as const);
  // The day's own spacing beats the long-run pace for "one more set".
  const typical = gaps.length ? median(gaps.map(([a, b]) => b - a)) : perSetSeconds(p, exercise);
  if (gaps.length >= 2) {
    const [a, b] = gaps.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
    if (b - a > Math.max(2 * typical, typical + 120)) return hhmm(new Date(((a + b) / 2) * 1000));
  }
  const next = Math.min((secs(day.at(-1)!) + typical) * 1000, now.getTime());
  return hhmm(new Date(next));
}

/** The day a workout belongs to: past midnight, the previous day while its last timed set is under `hours` old. */
const lastTimed = perLog((entries) => entries.filter((e) => e.loggedAt).reduce<SetEntry | null>((a, e) => (!a || secs(e) > secs(a) ? e : a), null));
export function sessionDay(entries: SetEntry[], today: string, now: Date, hours = 3): string {
  const last = lastTimed(entries);
  return last && last.date === addDays(today, -1) && now.getTime() - secs(last) * 1000 <= hours * 3600e3 ? last.date : today;
}

/** The most sets per session (8–20) whose every day `est`imates within `minutes`; 8 if none fits. */
export function perSessionForMinutes(minutes: number, build: (per: number) => Program, est: (day: ProgramDay) => number): number {
  for (let per = 20; per > 8; per--) if (Math.max(...build(per).days.map(est)) <= minutes) return per;
  return 8;
}

/** How long your sessions usually run: the median over the last 8 weeks (today left out) with 3 or more timed, else 45; 15–120. */
export function usualMinutes(entries: SetEntry[], today: string): number {
  const from = addDays(today, -56);
  const dates = [...new Set(entries.filter((e) => e.date >= from && e.date < today && e.loggedAt).map((e) => e.date))];
  const mins = dates.map((d) => sessionMinutes(entries, d)).filter((m): m is number => m != null);
  return mins.length < 3 ? 45 : Math.min(120, Math.max(15, Math.round(median(mins))));
}
