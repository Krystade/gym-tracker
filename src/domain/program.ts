import { MUSCLES, muscleVector, type Muscle } from './muscles';
import { DEFAULT_LOW_SHARE, goalOf, type Profile, type Tier } from './profile';
import { liftKey, localDate } from './ids';
import { defaultSettings, isWorking } from './progression';
import { daySets, perLog, sameExercise } from './stats';
import { addDays } from './analytics';
import type { SetEntry } from './types';
import { PROGRAM_LIFTS } from './catalog';
import { CARDIO_TARGETS, cardioSlots, cardioTierOf, pickMachine, weeklyCardioMinutes } from './cardio';
import { weekStart } from './analytics';
import { perSessionForMinutes } from './timing';

/** `minutes`: a cardio slot (one bout of that long on `exercise`, a machine); its `sets` is 1 and the rep range is unused. */
export interface Slot { exercise: string; sets: number; repMin: number; repMax: number; minutes?: number }
export interface ProgramDay { name: string; slots: Slot[] }
/**
 * `aims`: the weekly sets each muscle was planned at (owner, 2026-10-20: learn/volume planAims), and `block` the day those were
 * read, which starts its 3-week block (programUpdateDue).
 */
export interface Program { key: 'program'; days: ProgramDay[]; perSession: number; createdAt: string; aims?: Partial<Record<Muscle, number>>; block?: string; /** Minutes per session it was built for; unset when built by sets. */ minutes?: number; /** Set once its days were hand-edited; a rebuild drops it. */ edited?: boolean; newToYou?: string[]; unavailable?: Muscle[]; /** Cardio has a weekly goal but this gym has no cardio machine. */ cardioUnavailable?: boolean;
  /** Why the days hold fewer sets than asked: every muscle at its range's top, or these still short with no lift here that has room. */
  short?: { why: 'tops' } | { why: 'lifts'; muscles: Muscle[] } }
/** What happened to the program on one date: which day was run, and what was skipped or swapped. */
/** `slots` is the day as planned when the session was logged, so later program edits don't rewrite history. */
/** `quick`: a one-off Quick day built for this many minutes; its `slots` are the day, and it doesn't move the rotation. */
export interface DayPlan { key: string; date: string; day: number; skips: string[]; swaps: Record<string, string>; slots?: Slot[]; quick?: number }

export const MAX_SETS_PER_DAY = 4;
/** Sets are allocated in pairs so no exercise is ever programmed for a single set. */
const UNIT = 2;
const TIER_WEIGHT: Record<Tier, number> = { 1: 4, 2: 3, 3: 2, 4: 1 };

/** Catalog lifts per muscle, most suitable first: the fallback when the history has no lift for it that this gym can do. All train the muscle directly, except Face Pull for Traps. */
export const PREFERENCE: Record<Muscle, string[]> = {
  Chest: ['Machine Chest Press', 'Flat DB Press', 'Bench Press', 'Incline DB Press', 'Smith Flat Press', 'Push-up'],
  Triceps: ['Cable Pushdown', 'Overhead Cable Extension', 'Rope Pushdown', 'Overhead DB Triceps Extension', 'DB Kickback', 'Triceps Press Machine'],
  Biceps: ['Cable Curl', 'DB Curl', 'Incline DB Curl', 'Hammer Curl', 'Preacher Curl', 'Machine Biceps Curl'],
  'Front Delts': ['Machine Shoulder Press', 'DB Shoulder Press', 'Arnold Press', 'Overhead Press', 'Landmine Press', 'Front Raise'],
  'Side Delts': ['Cable Lateral Raise', 'DB Lateral Raise', 'Machine Lateral Raise'],
  'Rear Delts': ['Reverse Pec Deck', 'Cable Rear Delt Fly', 'Face Pull'],
  Lats: ['Lat Pulldown', 'Pull-up', 'Close-Grip Lat Pulldown', 'Straight-Arm Pulldown', 'Lat Pull-In'],
  'Mid-Back': ['Chest-Supported Row', 'Seated Cable Row', 'Kneeling DB Row', 'T-Bar Row'],
  // Shrugs train them directly (added round 15, owner); Face Pull, the long-standing default, after them.
  Traps: ['DB Shrug', 'Barbell Shrug', 'Face Pull'],
  Erectors: ['Back Extension', 'Bird Dog'],
  Quads: ['Leg Press', 'Leg Extension', 'Smith Squat', 'Pendulum Squat', 'Bulgarian Split Squat', 'Barbell Squat', 'Front Squat'],
  Hamstrings: ['Seated Leg Curl', 'Lying Leg Curl', 'DB Romanian Deadlift', 'Romanian Deadlift'],
  Glutes: ['Hip Thrust', 'Glute Press'],
  Calves: ['Seated Calf Raise', 'Standing Calf Raise'],
  Abs: ['Cable Crunch', 'Ab Crunch Machine', 'Hanging Leg Raise', 'Decline Sit-up', 'Supported Leg Raise'],
  Forearms: ['Wrist Curl', 'Farmer’s Carry', 'Reverse Curl'],
  Adductors: ['Hip Adduction Machine'],
  Abductors: ['Hip Abduction Machine'],
};
export const DEFAULT_PICK: Record<Muscle, string> = Object.fromEntries(MUSCLES.map((m) => [m, PREFERENCE[m][0]])) as Record<Muscle, string>;

/** `available`: what the gym can do. `include`: lifts the user added to the gym — they know them. */
export interface BuildContext { available?: Set<string>; include?: string[] }

/** Every logged spelling's score as of `today`, in the order first logged: one pass per log array and day, for every muscle. */
const scoresOf = perLog(() => new Map<string, Map<string, number>>());
function exerciseScores(entries: SetEntry[], today: string): Map<string, number> {
  const byDay = scoresOf(entries);
  let score = byDay.get(today);
  if (!score) {
    const yearAgo = addDays(today, -365), painSince = addDays(today, -120);
    score = new Map<string, number>();
    for (const e of entries) {
      if (e.flags.includes('warmup')) continue;
      let v = e.date >= yearAgo ? 1 : 0.25;
      if (e.flags.includes('pain') && e.date >= painSince) v -= 10;
      score.set(e.exercise, (score.get(e.exercise) ?? 0) + v);
    }
    byDay.set(today, score);
  }
  return score;
}
// Whether a set counts for a muscle depends on its name alone, so this is the per-muscle pass: the same sums in the same order.
const historyScores = (m: Muscle, entries: SetEntry[], today: string): Map<string, number> =>
  new Map([...exerciseScores(entries, today)].filter(([ex]) => muscleVector(ex)?.[m] === 1));

/**
 * Lifts for a muscle, best first: the ones the user actually does (most-used in the last year, older sets a quarter,
 * minus a heavy penalty for recent pain), then lifts added to the gym, then catalog lifts in PREFERENCE order, then any
 * other program lift (PROGRAM_LIFTS) that trains it directly. Only what `available` allows.
 */
export function candidates(m: Muscle, entries: SetEntry[], today: string, ctx: BuildContext = {}): string[] {
  const ok = (ex: string) => !ctx.available || ctx.available.has(ex);
  const direct = (ex: string) => muscleVector(ex)?.[m] === 1;
  const out = [...historyScores(m, entries, today)].filter(([ex, c]) => c > 0 && ok(ex)).sort((a, b) => b[1] - a[1]).map(([ex]) => ex);
  const add = (xs: Iterable<string>) => { for (const ex of xs) if (ok(ex) && !out.some((u) => sameExercise(u, ex))) out.push(ex); };
  add((ctx.include ?? []).filter(direct));
  add(PREFERENCE[m]);
  if (m !== 'Traps') add([...(ctx.available ?? PROGRAM_LIFTS)].filter(direct));
  return out;
}

/** The exercise the user actually does for a muscle (see `candidates`), else the catalog default. */
export function primaryExercise(m: Muscle, entries: SetEntry[], today = '9999-12-31'): string {
  return candidates(m, entries, today)[0] ?? DEFAULT_PICK[m];
}

const zero = (): Record<Muscle, number> => Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;

/** Best (lowest) tier among the muscles an exercise trains directly — decides its place in the session. */
function bestTier(ex: string, p: Profile): Tier {
  const v = muscleVector(ex) ?? {};
  const direct = (Object.entries(v) as [Muscle, number][]).filter(([, f]) => f === 1).map(([m]) => p.tiers[m]);
  return (direct.length ? Math.min(...direct) : 4) as Tier;
}

/**
 * `opts.aims`: each muscle's weekly sets to plan at, [lower, upper] (learn/volume planAims: a +20 % step from his own volume,
 * owner 2026-10-20); a muscle without one is planned at its priority's range. The aims order the fill, they don't cap it (owner,
 * 2026-10-22: 3 days of 20 gave days of 8): once every aim is met, the sets left go toward each range the same way, up to its top.
 */
export function buildProgram(profile: Profile, entries: SetEntry[], opts: { days: number; perSession: number; aims?: Partial<Record<Muscle, [number, number]>> }, now: Date, ctx: BuildContext = {}): Program {
  const { days, perSession } = opts;
  const range = (m: Muscle): [number, number] => profile.targets[profile.tiers[m]];
  const goalFor = (m: Muscle): [number, number] => opts.aims?.[m] ?? range(m);
  // The goals in fill order: the aim's lower and upper, then the range's (never below the aim: an aim above the range is his own volume).
  const goals = (m: Muscle): number[] => { const [a, b] = goalFor(m), [lo, hi] = range(m); return [a, b, Math.max(lo, b), Math.max(hi, b)]; };
  const today = localDate(now);
  const achieved = zero();
  const weekly = new Map<string, number>();
  const saturated = new Set<Muscle>(); // no lift left with room this week
  const cands = new Map<Muscle, string[]>(MUSCLES.map((m) => [m, candidates(m, entries, today, ctx)]));
  const missing = MUSCLES.filter((m) => !cands.get(m)!.length && goalFor(m)[0] > 0);
  for (const m of missing) saturated.add(m);
  // Worth a warning only for priority 1–2: a gym that can't train a priority 3–4 muscle is no news.
  const unavailable = missing.filter((m) => profile.tiers[m] <= 2);

  // Greedy, a pair of sets at a time: the muscle furthest below its tier's lower target *as a fraction of it*,
  // weighted by tier, goes next; once every lower target is met, the same toward the upper targets. Using the
  // fraction (not the raw gap) keeps priority 1's big targets from starving every other tier.
  const score = (m: Muscle, bound: number) => {
    const goal = goals(m)[bound];
    return goal > 0 ? (TIER_WEIGHT[profile.tiers[m]] * (goal - achieved[m])) / goal : 0;
  };
  // Whole pairs per day, so an odd sets-per-session never pushes a day over it.
  const dayCap = Math.floor(perSession / UNIT) * UNIT;
  // Dedicated sets for priority 3–4 muscles are capped at a share of the week while any priority 1–2 muscle is still short.
  const lowBudget = (profile.lowShare ?? DEFAULT_LOW_SHARE) * days * dayCap;
  let low = 0;
  const isLow = (m: Muscle) => profile.tiers[m] >= 3;
  const prioritiesShort = () => MUSCLES.some((m) => !isLow(m) && !saturated.has(m) && achieved[m] < goals(m)[3]);
  const perDay = Array.from({ length: days }, () => new Map<string, number>());
  const totals = Array(days).fill(0) as number[];
  const room = (ex: string, d: number) => (perDay[d].get(ex) ?? 0) + UNIT <= MAX_SETS_PER_DAY;
  const known = new Set([...entries.map((e) => e.exercise), ...(ctx.include ?? [])].map(liftKey));
  const isKnown = (ex: string) => known.has(liftKey(ex));
  // The lift for muscle m on day d, best candidate first within each step: a lift you know that no other day uses,
  // then a lift you know (repeated), then a new one no other day uses, then any with room. Varied days, familiar lifts.
  const pick = (m: Muscle, d: number): string | undefined => {
    const cs = cands.get(m)!.filter((c) => room(c, d));
    const elsewhere = (c: string) => perDay.some((x, i) => i !== d && x.has(c));
    return cs.find((c) => isKnown(c) && !elsewhere(c)) ?? cs.find(isKnown) ?? cs.find((c) => !elsewhere(c)) ?? cs[0];
  };
  for (let pairs = days * Math.floor(perSession / UNIT); pairs > 0; pairs--) {
    const open = MUSCLES.filter((m) => !saturated.has(m));
    // Over the low-priority budget, priority 3–4 muscles wait — re-checked every pair, so they come back once priorities are covered.
    const capped = low + UNIT > lowBudget && prioritiesShort();
    const below = (bound: number) => open.filter((m) => score(m, bound) > 0 && !(capped && isLow(m))).sort((a, b) => score(b, bound) - score(a, bound));
    const m = below(0)[0] ?? below(1)[0] ?? below(2)[0] ?? below(3)[0];
    if (!m) break;
    // The pair goes on the day with the fewest sets for m (then the lightest) that has room and a lift for m with room,
    // so each muscle spreads over the days with its best lifts split between them; none means this muscle is done.
    const mSets = (i: number) => [...perDay[i]].reduce((a, [ex, n]) => a + (muscleVector(ex)?.[m] === 1 ? n : 0), 0);
    const d = totals.map((t, i) => [mSets(i), t, i]).filter(([, t, i]) => t + UNIT <= dayCap && pick(m, i)).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]?.[2];
    if (d === undefined) { saturated.add(m); pairs++; continue; }
    const ex = pick(m, d)!;
    if (isLow(m)) low += UNIT;
    perDay[d].set(ex, (perDay[d].get(ex) ?? 0) + UNIT);
    totals[d] += UNIT;
    weekly.set(ex, (weekly.get(ex) ?? 0) + UNIT);
    for (const [mm, f] of Object.entries(muscleVector(ex) ?? {}) as [Muscle, number][]) achieved[mm] += f * UNIT;
  }

  // Short of what was asked: say why (every muscle at its top, or some still short with no lift here that has room).
  const stuck = MUSCLES.filter((m) => saturated.has(m) && !missing.includes(m) && score(m, 3) > 0);
  const short: Program['short'] = totals.some((t) => t < dayCap) ? (stuck.length ? { why: 'lifts', muscles: stuck } : { why: 'tops' }) : undefined;
  const order = [...weekly.keys()].sort((a, b) => bestTier(a, profile) - bestTier(b, profile) || weekly.get(b)! - weekly.get(a)!);
  const newToYou = order.filter((ex) => !isKnown(ex) && perDay.some((d) => d.has(ex)));
  // Cardio: the priority's weekly minutes in slots of about 25, on the days with the fewest lifting sets, each last in its day.
  const goal = CARDIO_TARGETS[cardioTierOf(profile)][0];
  const cardioMachine = goal > 0 ? pickMachine(entries, today, (n) => !ctx.available || ctx.available.has(n)) : null;
  const cardio = new Map<number, number>();
  if (cardioMachine) {
    const lightest = totals.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
    cardioSlots(goal, days).forEach((min, k) => cardio.set(lightest[k], min));
  }
  return {
    key: 'program', perSession, createdAt: now.toISOString(), newToYou, unavailable,
    ...(opts.aims && { block: today, aims: Object.fromEntries(Object.entries(opts.aims).map(([m, [lo]]) => [m, lo])) }),
    ...(goal > 0 && !cardioMachine && { cardioUnavailable: true }),
    ...(short && { short }),
    days: perDay.map((m, i) => ({
      name: `Day ${String.fromCharCode(65 + i)}`,
      slots: [
        ...order.filter((ex) => m.has(ex)).map((ex) => { const st = defaultSettings(ex, undefined, goalOf(profile)); return { exercise: ex, sets: m.get(ex)!, repMin: st.repMin, repMax: st.repMax }; }),
        ...(cardio.has(i) ? [cardioSlot(cardioMachine!, cardio.get(i)!)] : []),
      ],
    })),
  };
}

/** A cardio slot of `minutes` on `machine`. */
export const cardioSlot = (machine: string, minutes: number): Slot => ({ exercise: machine, sets: 1, repMin: 0, repMax: 0, minutes });

/** (a) A volume block: Barsuhn 2025's 3 weeks (learn/volume BASE_WEEKS): the aims are read again after each. */
export const BLOCK_DAYS = 21;
/**
 * The 3-week blocks since the program's aims were read (`block`, a local day), or for one built before them its build day:
 * createdAt's LOCAL day (it's a UTC instant: built at 18:00 in California is already tomorrow in UTC), as cycleDone reads it.
 */
export const programBlock = (p: Program, today: string): number => {
  const built = new Date(p.createdAt);
  const from = p.block ?? (Number.isNaN(built.getTime()) ? p.createdAt.slice(0, 10) : localDate(built));
  return Math.max(0, Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5 / BLOCK_DAYS));
};

/**
 * A program built like `p` (its days, sets or minutes per session) at `aims`. By minutes: the most sets per session whose every
 * day `est`imates within them (minutes).
 */
export function rebuildLike(p: { days: number; perSession: number; minutes?: number }, profile: Profile, entries: SetEntry[], now: Date, ctx: BuildContext,
  aims: Partial<Record<Muscle, [number, number]>> | undefined, est: (day: ProgramDay) => number): Program {
  const { days } = p;
  const build = (perSession: number) => buildProgram(profile, entries, { days, perSession, aims }, now, ctx);
  return p.minutes != null ? { ...build(perSessionForMinutes(p.minutes, build, est)), minutes: p.minutes } : build(p.perSession);
}

/** Whether two programs' weekly sets differ by a set or more for any muscle: an update worth offering. */
export const volumeDiffers = (a: Program, b: Program): boolean => {
  const x = programVolume(a), y = programVolume(b);
  return MUSCLES.some((m) => Math.abs(x[m] - y[m]) >= 1);
};

/** Adds a slot to a day: a lift before the day's first cardio slot, so cardio stays last; cardio at the end. */
export function addSlot(day: ProgramDay, slot: Slot) {
  const at = slot.minutes == null ? day.slots.findIndex((x) => x.minutes != null) : -1;
  day.slots.splice(at < 0 ? day.slots.length : at, 0, slot);
}

/** Weekly fractional sets per muscle for one pass through every day. */
export function programVolume(p: Program): Record<Muscle, number> {
  const v = zero();
  for (const slot of p.days.flatMap((d) => d.slots)) {
    for (const [m, f] of Object.entries(muscleVector(slot.exercise) ?? {}) as [Muscle, number][]) v[m] += f * slot.sets;
  }
  return v;
}

/** A day counts as trained with a working set or a cardio bout, so a cardio-only day still moves the rotation. */
const counts = (e: SetEntry) => isWorking(e) || !!e.cardio;
const trainedDates = perLog((entries) => new Set(entries.filter(counts).map((e) => e.date)));
const trainedOn = (entries: SetEntry[], date: string) => trainedDates(entries).has(date);

/**
 * The program days done in the current cycle: the days trained before `today` (a plan with nothing logged, or a quick day, doesn't
 * count) since the program was built (readiness S4: a rebuilt program starts its cycle fresh; its day numbers are new days), in
 * date order, cut into cycles. A cycle closes once every day is done, or when a day comes round again before it is (so a
 * reordered week still counts each day once).
 */
export function cycleDone(p: Program, plans: readonly DayPlan[], entries: readonly SetEntry[], today: string): Set<number> {
  // createdAt is a UTC instant; plans are local days. Built at 18:00 in California is the next day in UTC: its local day.
  const built = new Date(p.createdAt);
  const since = Number.isNaN(built.getTime()) ? '' : localDate(built);
  const xs = plans.filter((x) => x.date < today && x.date >= since && x.quick == null && x.day < p.days.length && trainedOn(entries as SetEntry[], x.date)).sort((a, b) => a.date.localeCompare(b.date));
  let done = new Set<number>();
  for (const x of xs) {
    if (done.has(x.day)) done = new Set();
    done.add(x.day);
    if (done.size === p.days.length) done = new Set();
  }
  return done;
}

/** The first program day not yet done this cycle (readiness S3: so a day skipped or done out of order comes up next). */
export function nextDay(p: Program, plans: readonly DayPlan[], entries: readonly SetEntry[], today: string): number {
  const done = cycleDone(p, plans, entries, today);
  for (let i = 0; i < p.days.length; i++) if (!done.has(i)) return i;
  return 0;
}

/** Planned vs done working sets over training days (dates with sets logged) since `since`. */
export function adherence(p: Program, plans: DayPlan[], entries: SetEntry[], since: string, today: string): { planned: number; done: number } {
  let planned = 0, done = 0;
  for (const x of plans) {
    const slots = x.slots ?? p.days[x.day]?.slots;
    if (x.date < since || x.date > today || !slots || !trainedOn(entries, x.date)) continue;
    // Each logged set counts toward one slot, so a swap onto an exercise already planned can't be counted twice.
    const left = daySets(entries, x.date).filter(counts);
    for (const slot of slots) {
      planned += slot.sets;
      if (x.skips.includes(slot.exercise)) continue;
      const target = x.swaps[slot.exercise] ?? slot.exercise;
      for (let k = 0; k < slot.sets; k++) {
        const i = left.findIndex((e) => sameExercise(e.exercise, target));
        if (i < 0) break;
        left.splice(i, 1);
        done++;
      }
    }
  }
  return { planned, done };
}

/**
 * The plan to store for `date` once working sets are logged: fixes the rotation and snapshots the day's slots. Null when nothing
 * needs saving. `suggested`: the day Today suggested (readiness S4: the week's plan may put another day first), else nextDay.
 */
export function planToRecord(p: Program, plans: DayPlan[], entries: SetEntry[], date: string, suggested?: number | null): DayPlan | null {
  if (!trainedOn(entries, date)) return null;
  const stored = plans.find((x) => x.date === date);
  if (stored?.slots) return null;
  const pick = suggested != null && suggested >= 0 && suggested < p.days.length ? suggested : nextDay(p, plans, entries, date);
  const base = stored ?? { key: `day:${date}`, date, day: pick, skips: [], swaps: {} };
  const day = p.days[base.day] ?? p.days[0];
  return day ? { ...base, day: p.days[base.day] ? base.day : 0, slots: structuredClone(day.slots) } : null;
}

/**
 * A one-off day that fits the time you have: a pair of sets at a time to the muscle furthest behind its weekly target
 * over the last 7 days (as a fraction, weighted by priority, like the builder), ties to whatever was trained longest ago.
 * The day's own sets don't count, so the plan holds while you work through it. `fits`: whether the slots fit the time.
 */
export function quickDay(profile: Profile, entries: SetEntry[], date: string, fits: (slots: Slot[]) => boolean, ctx: BuildContext = {}): Slot[] {
  const weekAgo = addDays(date, -7);
  const achieved = zero();
  const last = new Map<Muscle, string>();
  for (const e of entries) {
    if (e.date >= date || !isWorking(e)) continue;
    for (const [m, f] of Object.entries(muscleVector(e.exercise) ?? {}) as [Muscle, number][]) {
      if (e.date >= weekAgo) achieved[m] += f;
      if (f > 0 && e.date > (last.get(m) ?? '')) last.set(m, e.date);
    }
  }
  const cands = new Map<Muscle, string[]>(MUSCLES.map((m) => [m, candidates(m, entries, date, ctx)]));
  const done = new Set<Muscle>(MUSCLES.filter((m) => !cands.get(m)!.length));
  const score = (m: Muscle, bound: 0 | 1) => {
    const goal = profile.targets[profile.tiers[m]][bound];
    return goal > 0 ? (TIER_WEIGHT[profile.tiers[m]] * (goal - achieved[m])) / goal : 0;
  };
  const day = new Map<string, number>();
  // Cardio at priority 1–2 that's behind for the week: its shortfall, 10–20 minutes, if it fits.
  const tier = cardioTierOf(profile), short = CARDIO_TARGETS[tier][0] - weeklyCardioMinutes(entries.filter((e) => e.date < date), weekStart(date));
  const m0 = tier <= 2 && short > 0 ? pickMachine(entries, date, (n) => !ctx.available || ctx.available.has(n)) : null;
  let cardio: Slot[] = m0 ? [cardioSlot(m0, Math.min(20, Math.max(10, Math.round(short / 5) * 5)))] : [];
  if (cardio.length && !fits(cardio)) cardio = [];
  const lifts = () => [...day].map(([exercise, sets]) => { const st = defaultSettings(exercise, undefined, goalOf(profile)); return { exercise, sets, repMin: st.repMin, repMax: st.repMax }; });
  const slots = () => [...lifts(), ...cardio];
  for (;;) {
    const open = MUSCLES.filter((m) => !done.has(m));
    const below = (bound: 0 | 1) => open.filter((m) => score(m, bound) > 0)
      .sort((a, b) => score(b, bound) - score(a, bound) || (last.get(a) ?? '').localeCompare(last.get(b) ?? ''));
    const m = below(0)[0] ?? below(1)[0];
    if (!m) break;
    const ex = cands.get(m)!.find((c) => (day.get(c) ?? 0) + UNIT <= MAX_SETS_PER_DAY);
    if (!ex) { done.add(m); continue; }
    day.set(ex, (day.get(ex) ?? 0) + UNIT);
    if (!fits(slots())) { day.set(ex, day.get(ex)! - UNIT); if (!day.get(ex)) day.delete(ex); break; }
    for (const [mm, f] of Object.entries(muscleVector(ex) ?? {}) as [Muscle, number][]) achieved[mm] += f * UNIT;
  }
  return [...lifts().sort((a, b) => bestTier(a.exercise, profile) - bestTier(b.exercise, profile) || b.sets - a.sets), ...cardio];
}
