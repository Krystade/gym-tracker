import { defaultSettings, isWorking, settingsKey } from './progression';
import { daySets, doneAt, perLog, sameExercise } from './stats';
import { addDays } from './analytics';
import type { Program, ProgramDay } from './program';
import type { SetEntry } from './types';
import { supersets, type Superset } from './superset';

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
 * `superSwitch`: inside a superset, the median time from a set of one lift to the next lift's set (once there are 3).
 * `perSet`: per lift, every gap's median, for a late set's time and telling a superset's switch from a rest. A lift's rest goes
 * by none of these (restFor): they describe the habit, not what's best. How long a session takes is learn/session's.
 */
export interface Paces { perSet: Map<string, number>; transition: number; superSwitch?: number }

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
 * (≤ 15 min). A superset's gaps are neither: its switches are learned apart (`superSwitch`), and the rest after its round is
 * no lift's own rest and no switch between lifts.
 */
export const paces: (entries: SetEntry[]) => Paces = perLog((entries) => pacesOf(entries));
// Once per log array: Today alone reads it in every card. Shared, so never changed by a caller.
function pacesOf(entries: readonly SetEntry[]): Paces {
  const days = timedDays(entries);
  // Which gaps are a superset's depends on each lift's usual time between sets: first without leaving any out.
  const raw = medians(gapLists(days), MIN_SAMPLES);
  const usual = (exercise: string) => raw.get(settingsKey(exercise)) ?? REST.isolation + SET_WORK;
  const sw: number[] = [], ss: number[] = [];
  const inside = new Map<SetEntry[], (i: number) => boolean>();
  for (const day of days) {
    const of = new Map<string, Superset>();
    for (const g of supersets(day, day[0].date, usual)) for (const id of g.after.keys()) of.set(id, g);
    // Set i follows a set of a superset with a set of one of its lifts.
    const within = (i: number) => !!of.get(day[i - 1].id)?.keys.includes(settingsKey(day[i].exercise));
    inside.set(day, within);
    for (let i = 1; i < day.length; i++) {
      const gap = secs(day[i]) - secs(day[i - 1]);
      if (gap <= 0 || gap > MAX_SWITCH || sameExercise(day[i].exercise, day[i - 1].exercise)) continue;
      if (!within(i)) sw.push(gap);
      else if (of.get(day[i - 1].id)!.after.get(day[i - 1].id) != null && isWorking(day[i])) ss.push(gap);
    }
  }
  const own = gapLists(days, (day, i) => inside.get(day)!(i));
  return {
    perSet: medians(own, MIN_SAMPLES), transition: sw.length >= MIN_SAMPLES ? median(sw) : DEFAULT_PACE.transition,
    ...(ss.length >= MIN_SAMPLES && { superSwitch: median(ss) }),
  };
}

export const perSetSeconds = (p: Paces, exercise: string): number =>
  p.perSet.get(settingsKey(exercise)) ?? (defaultSettings(exercise).repMin >= 10 ? DEFAULT_PACE.isolation : DEFAULT_PACE.compound);

/**
 * (a) About how long a set itself takes: ~10 reps at 2–4 s a rep is 20–40 s (Schoenfeld, Ogborn & Krieger 2015, Sports Med
 * 45:577: repetitions of 0.5–8 s in the trials); the upper end. The learned set-to-set time includes it.
 */
export const SET_WORK = 40;
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

/** Where a lift's base rest came from: his setting, kept from the timer's ±30 s; his own sets (item 17); or the research default. */
export type RestFrom = 'kept' | 'knee' | 'default';
function baseRest(exercise: string, kept?: number, knee?: number | null): { base: number; from: RestFrom } {
  return kept != null && kept > 0 ? { base: kept, from: 'kept' } : knee != null ? { base: knee, from: 'knee' } : { base: defaultRest(exercise), from: 'default' };
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
/** δ as the "?" says it: rounded up to a tenth, so "under" stays true. */
const repsOf = (d: number) => `${Math.ceil(d * 10) / 10}`;

/**
 * The rest after `set` (owner, 2026-10-19). A warm-up: 60 s (isolation) or 90 s (compound). Otherwise the lift's base rest
 * (restSeconds: his setting, else his knee once tight, else the research default), then effort, and the total kept within
 * 45 s – 5 min. Effort, with his knee: as learn/rest reads this set's RIR (a: Refalo 2023, nearer failure leaves more to
 * recover); without it: RIR 0 +30 s, RIR 3 or more −30 s (RIR 1–2 or not logged: nothing). The set's load moves nothing: no
 * evidence it should, 80 % and 50 % of 1RM alike (owner, 2026-10-20). `knee`: learn/rest kneeAfter's, null without timed sets.
 * `parts`: the same, line by line (RestPart), leaving out what moved nothing; his setting says what his sets (or research)
 * suggest, where that's different; the research default says how far his own sets have got.
 */
export function restFor(set: SetEntry, o: { kept?: number; knee?: KneeRest | null } = {}): { seconds: number; why: RestWhy; parts: RestPart[] } {
  const learned = o.knee?.use ? o.knee : null;
  const { base, from } = baseRest(set.exercise, o.kept, learned?.usual);
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
    : { what: 'Your setting', s: base, ...(base !== suggests.s && { note: `${suggests.by} ${mss(suggests.s)}` }) }];
  if (effort) parts.push({ what: `RIR ${set.rir}`, s: effort, add: true, ...(learned && { note: effort > 0 ? 'nearer failure: more to recover' : 'further from failure: less to recover' }) });
  if (seconds !== sum) parts.push({ what: seconds === REST_MIN_S ? `At least ${mss(REST_MIN_S)}` : `At most ${mss(REST_MAX_S)}`, s: seconds - sum, add: true });
  return { seconds, why: { base, from, effort }, parts };
}

/** A lift's usual time from one set to the next: learned, else the 2:00 rest and the set. A superset's switch is well under it. */
export const usualGap = (p: Paces, exercise: string): number => p.perSet.get(settingsKey(exercise)) ?? REST.isolation + SET_WORK;

/**
 * The timer after a set. Inside a superset with a lift still to go in the round (`next`): a short switch, the learned one less
 * the set itself (at least 10 s), else 0:20. Otherwise, the lift's full rest (`kept`: the one you set, see restSeconds).
 */
export function restAfter(p: Paces, exercise: string, next: string | null | undefined, kept?: number): { seconds: number; switchTo?: string } {
  if (!next) return { seconds: restSeconds(exercise, kept) };
  return { seconds: switchSeconds(p), switchTo: next };
}
/** Inside a superset, the switch to the round's next lift: the learned one less the set itself (at least 10 s), else 0:20. */
export const switchSeconds = (p: Paces): number => switchFor(p).seconds;
/** The same, with its line for the timer's "?" (RestPart). */
export function switchFor(p: Paces): { seconds: number; parts: RestPart[] } {
  const seconds = p.superSwitch == null ? 20 : Math.max(10, Math.round(p.superSwitch - SET_WORK));
  return { seconds, parts: [{ what: 'Superset switch', s: seconds, note: p.superSwitch == null ? 'default until 3 switches are timed' : 'your usual switch, less the set itself' }] };
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
export function planSeconds(steps: readonly Step[], o: { kept?: (ex: string) => number | undefined; overhead?: number; knee?: KneeAt } = {}): number {
  if (!steps.length) return 0;
  const work = (s: Step) => s.seconds ?? SET_WORK;
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
