import { MUSCLES, muscleVector, type Muscle } from './muscles';
import type { Profile, Tier } from './profile';
import { defaultSettings, isWorking } from './progression';
import { sameExercise } from './stats';
import { addDays } from './analytics';
import type { SetEntry } from './types';

export interface Slot { exercise: string; sets: number; repMin: number; repMax: number }
export interface ProgramDay { name: string; slots: Slot[] }
export interface Program { key: 'program'; days: ProgramDay[]; perSession: number; createdAt: string }
/** What happened to the program on one date: which day was run, and what was skipped or swapped. */
/** `slots` is the day as planned when the session was logged, so later program edits don't rewrite history. */
export interface DayPlan { key: string; date: string; day: number; skips: string[]; swaps: Record<string, string>; slots?: Slot[] }

export const MAX_SETS_PER_DAY = 4;
/** Sets are allocated in pairs so no exercise is ever programmed for a single set. */
const UNIT = 2;
const TIER_WEIGHT: Record<Tier, number> = { 1: 4, 2: 3, 3: 2, 4: 1 };

/** Fallback exercise per muscle when the history has none that trains it directly. All are in CATALOG. */
export const DEFAULT_PICK: Record<Muscle, string> = {
  Chest: 'Machine Chest Press', Triceps: 'Cable Pushdown', Biceps: 'Cable Curl', 'Front Delts': 'Machine Shoulder Press',
  'Side Delts': 'Cable Lateral Raise', 'Rear Delts': 'Reverse Pec Deck', Lats: 'Lat Pulldown', 'Mid-Back': 'Chest-Supported Row',
  Traps: 'Face Pull', Erectors: 'Back Extension', Quads: 'Leg Press', Hamstrings: 'Seated Leg Curl', Glutes: 'Hip Thrust',
  Calves: 'Seated Calf Raise', Abs: 'Cable Crunch', Forearms: 'Wrist Curl', Adductors: 'Hip Adduction Machine', Abductors: 'Hip Abduction Machine',
};

/**
 * The exercise the user actually does for a muscle: among those that train it directly, the most-used
 * in the last year (older sets count a quarter), minus a heavy penalty for pain flags in the last 120 days.
 */
export function primaryExercise(m: Muscle, entries: SetEntry[], today = '9999-12-31'): string {
  const yearAgo = addDays(today, -365), painSince = addDays(today, -120);
  const score = new Map<string, number>();
  for (const e of entries) {
    if (e.flags.includes('warmup') || muscleVector(e.exercise)?.[m] !== 1) continue;
    let v = e.date >= yearAgo ? 1 : 0.25;
    if (e.flags.includes('pain') && e.date >= painSince) v -= 10;
    score.set(e.exercise, (score.get(e.exercise) ?? 0) + v);
  }
  let best = DEFAULT_PICK[m], n = 0;
  for (const [ex, c] of score) if (c > n) { best = ex; n = c; }
  return best;
}

const zero = (): Record<Muscle, number> => Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;

/** Best (lowest) tier among the muscles an exercise trains directly — decides its place in the session. */
function bestTier(ex: string, p: Profile): Tier {
  const v = muscleVector(ex) ?? {};
  const direct = (Object.entries(v) as [Muscle, number][]).filter(([, f]) => f === 1).map(([m]) => p.tiers[m]);
  return (direct.length ? Math.min(...direct) : 4) as Tier;
}

export function buildProgram(profile: Profile, entries: SetEntry[], opts: { days: number; perSession: number }, now: Date): Program {
  const { days, perSession } = opts;
  const today = now.toISOString().slice(0, 10);
  const achieved = zero();
  const weekly = new Map<string, number>();
  const saturated = new Set<Muscle>();
  const pick = new Map<Muscle, string>(MUSCLES.map((m) => [m, primaryExercise(m, entries, today)]));

  // Greedy, a pair of sets at a time: the muscle furthest below its tier's lower target *as a fraction of it*,
  // weighted by tier, goes next; once every lower target is met, the same toward the upper targets. Using the
  // fraction (not the raw gap) keeps priority 1's big targets from starving every other tier.
  const score = (m: Muscle, bound: 0 | 1) => {
    const goal = profile.targets[profile.tiers[m]][bound];
    return goal > 0 ? (TIER_WEIGHT[profile.tiers[m]] * (goal - achieved[m])) / goal : 0;
  };
  // Whole pairs per day, so an odd sets-per-session never pushes a day over it.
  const dayCap = Math.floor(perSession / UNIT) * UNIT;
  for (let pairs = days * Math.floor(perSession / UNIT); pairs > 0; pairs--) {
    const open = MUSCLES.filter((m) => !saturated.has(m));
    const below = (bound: 0 | 1) => open.filter((m) => score(m, bound) > 0).sort((a, b) => score(b, bound) - score(a, bound));
    const m = below(0)[0] ?? below(1)[0];
    if (!m) break;
    const ex = pick.get(m)!;
    if ((weekly.get(ex) ?? 0) + UNIT > MAX_SETS_PER_DAY * days) { saturated.add(m); pairs++; continue; }
    weekly.set(ex, (weekly.get(ex) ?? 0) + UNIT);
    for (const [mm, f] of Object.entries(muscleVector(ex) ?? {}) as [Muscle, number][]) achieved[mm] += f * UNIT;
  }

  const order = [...weekly.keys()].sort((a, b) => bestTier(a, profile) - bestTier(b, profile) || weekly.get(b)! - weekly.get(a)!);
  const perDay = Array.from({ length: days }, () => new Map<string, number>());
  const totals = Array(days).fill(0) as number[];
  // Pair by pair onto the lightest day that can still take one.
  for (const ex of order) {
    for (let k = weekly.get(ex)!; k > 0; k -= UNIT) {
      const d = totals.map((t, i) => [t, i]).filter(([t, i]) => t + UNIT <= dayCap && (perDay[i].get(ex) ?? 0) + UNIT <= MAX_SETS_PER_DAY).sort((a, b) => a[0] - b[0])[0]?.[1];
      if (d === undefined) break;
      perDay[d].set(ex, (perDay[d].get(ex) ?? 0) + UNIT);
      totals[d] += UNIT;
    }
  }
  return {
    key: 'program', perSession, createdAt: now.toISOString(),
    days: perDay.map((m, i) => ({
      name: `Day ${String.fromCharCode(65 + i)}`,
      slots: order.filter((ex) => m.has(ex)).map((ex) => { const st = defaultSettings(ex); return { exercise: ex, sets: m.get(ex)!, repMin: st.repMin, repMax: st.repMax }; }),
    })),
  };
}

/** Weekly fractional sets per muscle for one pass through every day. */
export function programVolume(p: Program): Record<Muscle, number> {
  const v = zero();
  for (const slot of p.days.flatMap((d) => d.slots)) {
    for (const [m, f] of Object.entries(muscleVector(slot.exercise) ?? {}) as [Muscle, number][]) v[m] += f * slot.sets;
  }
  return v;
}

const trainedOn = (entries: SetEntry[], date: string) => entries.some((e) => e.date === date && isWorking(e));

/** The day after the last one actually trained; a plan with nothing logged doesn't count. */
export function nextDay(p: Program, plans: DayPlan[], entries: SetEntry[], today: string): number {
  const last = plans.filter((x) => x.date < today && x.day < p.days.length && trainedOn(entries, x.date)).sort((a, b) => b.date.localeCompare(a.date))[0];
  return last ? (last.day + 1) % p.days.length : 0;
}

/** Planned vs done working sets over training days (dates with sets logged) since `since`. */
export function adherence(p: Program, plans: DayPlan[], entries: SetEntry[], since: string, today: string): { planned: number; done: number } {
  let planned = 0, done = 0;
  for (const x of plans) {
    const slots = x.slots ?? p.days[x.day]?.slots;
    if (x.date < since || x.date > today || !slots || !trainedOn(entries, x.date)) continue;
    // Each logged set counts toward one slot, so a swap onto an exercise already planned can't be counted twice.
    const left = entries.filter((e) => e.date === x.date && isWorking(e));
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

/** The plan to store for `date` once working sets are logged: fixes the rotation and snapshots the day's slots. Null when nothing needs saving. */
export function planToRecord(p: Program, plans: DayPlan[], entries: SetEntry[], date: string): DayPlan | null {
  if (!trainedOn(entries, date)) return null;
  const stored = plans.find((x) => x.date === date);
  if (stored?.slots) return null;
  const base = stored ?? { key: `day:${date}`, date, day: nextDay(p, plans, entries, date), skips: [], swaps: {} };
  const day = p.days[base.day] ?? p.days[0];
  return day ? { ...base, day: p.days[base.day] ? base.day : 0, slots: structuredClone(day.slots) } : null;
}
