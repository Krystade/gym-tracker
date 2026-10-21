import { isCardioEntry } from './cardio';
import { muscleVector, MUSCLES, type Muscle } from './muscles';
import type { SetEntry } from './types';

const toDate = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)); };
const fromDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number): string => { const x = toDate(d); x.setUTCDate(x.getUTCDate() + n); return fromDate(x); };
// Read for every set in weekly passes (Stats, the digest, push activity): a pure function of the date, so each date is
// worked out once. Bounded: a log has a few thousand dates.
const WEEKS = new Map<string, string>();
export const weekStart = (d: string): string => {
  let w = WEEKS.get(d);
  if (w === undefined) {
    w = addDays(d, -((toDate(d).getUTCDay() + 6) % 7));
    if (WEEKS.size >= 20_000) WEEKS.clear();
    WEEKS.set(d, w);
  }
  return w;
};

const zero = (): Record<Muscle, number> => Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
/** (a) Fractional sets of one muscle a session counts: past about 11, more sets in the session stop adding detectable growth (Remmert et al., SportRxiv 537). */
export const SESSION_CAP = 11;

/**
 * The sessions the rest of this week still holds: its days to come, Sunday included and today too unless he has trained today;
 * at most what his weekly goal has left (`done`: sessions so far, today's included), but one while a day is left, since he can
 * always train once more.
 */
export function sessionsLeft(today: string, goal: number, done: number, trainedToday: boolean): number {
  const free = 7 - ((toDate(today).getUTCDay() + 6) % 7) - (trainedToday ? 1 : 0);
  return free <= 0 ? 0 : Math.min(free, Math.max(1, goal - done));
}

/**
 * A muscle's sets this week against its target range: under, on, over; and short of it but still within reach ('pace') while
 * the sessions left (`left`, sessionsLeft) can make up the rest, each adding `reach` sets to the muscle (sessionReach: what a
 * session of his realistically gives it; SESSION_CAP when not given). 'under' means behind what the rest of the week can still
 * do, never just that the week has days to go: Monday's muscles are on pace. Without `left` (a program, which has no "so far"),
 * the plain status.
 */
export function weekStatus(value: number, [lo, hi]: [number, number], left?: number, reach: number = SESSION_CAP): 'under' | 'pace' | 'on' | 'over' {
  if (value > hi) return 'over';
  if (value >= lo) return 'on';
  return left != null && lo - value <= left * reach + 1e-9 ? 'pace' : 'under';
}

/** Whole weeks before this one that a muscle's usual sets per session are read over. */
export const REACH_WEEKS = 6;
/** A session left this week is counted at his usual dose for a muscle and half again, at least `floor`, at most SESSION_CAP. */
export const REACH = { factor: 1.5, floor: 3 } as const;

/** Fractional sets per muscle on each day from `from` up to (not including) `to`, as weeklyMuscleSets counts them, each day capped. */
function muscleDays(entries: readonly SetEntry[], from: string, to: string, unmapped?: Set<string>): Map<string, Record<Muscle, number>> {
  const byDay = new Map<string, Record<Muscle, number>>();
  for (const e of entries) {
    // Cardio counts as minutes (domain/cardio), not muscle sets, and isn't unknown either.
    if (e.date < from || e.date >= to || e.flags.includes('warmup') || e.cardio) continue;
    const v = muscleVector(e.exercise);
    if (!v) { unmapped?.add(e.exercise); continue; }
    const day = byDay.get(e.date) ?? byDay.set(e.date, zero()).get(e.date)!;
    for (const [m, f] of Object.entries(v) as [Muscle, number][]) day[m] += f;
  }
  for (const day of byDay.values()) for (const m of MUSCLES) day[m] = Math.min(day[m], SESSION_CAP);
  return byDay;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * Each muscle's usual sets in a session that trains it: the median over the days of the REACH_WEEKS whole weeks before `today`'s
 * week that gave it any (0: none did). Whole weeks, so it holds still all week.
 */
export function usualPerSession(entries: readonly SetEntry[], today: string): Record<Muscle, number> {
  const to = weekStart(today);
  const days = [...muscleDays(entries, addDays(to, -7 * REACH_WEEKS), to).values()];
  return Object.fromEntries(MUSCLES.map((m) => [m, median(days.flatMap((d) => (d[m] > 0 ? [d[m]] : [])))])) as Record<Muscle, number>;
}

/** The most sets any one day of a program gives each muscle: what a planned session left this week can bring it. */
export function planPerSession(days: readonly { slots: readonly { exercise: string; sets: number }[] }[] | null | undefined): Record<Muscle, number> {
  const out = zero();
  for (const d of days ?? []) {
    const day = zero();
    for (const s of d.slots) for (const [m, f] of Object.entries(muscleVector(s.exercise) ?? {}) as [Muscle, number][]) day[m] += f * s.sets;
    for (const m of MUSCLES) out[m] = Math.max(out[m], Math.min(day[m], SESSION_CAP));
  }
  return out;
}

/**
 * What one session left this week can realistically add to each muscle (owner, 2026-10-21): the larger of his usual sets per
 * session for it (usualPerSession) and the plan's (planPerSession), times REACH.factor, at least REACH.floor, at most SESSION_CAP.
 */
export function sessionReach(usual: Record<Muscle, number>, plan?: Record<Muscle, number>): Record<Muscle, number> {
  return Object.fromEntries(MUSCLES.map((m) => [m, Math.min(SESSION_CAP, Math.max(REACH.floor, REACH.factor * Math.max(usual[m], plan?.[m] ?? 0)))])) as Record<Muscle, number>;
}

export function weeklyMuscleSets(entries: SetEntry[], week: string): { sets: Record<Muscle, number>; unmapped: string[] } {
  const sets = zero();
  const unmapped = new Set<string>();
  for (const day of muscleDays(entries, week, addDays(week, 7), unmapped).values()) for (const m of MUSCLES) sets[m] += day[m];
  return { sets, unmapped: [...unmapped].sort() };
}

/**
 * `sessions`: days with a working lift set, the days the weekly goal and streak count. `cardioDays`: days with cardio and no
 * working lift set, shown beside the sessions but never toward the goal (round 7's decision). Crew counts both (domain/crew).
 */
export interface WeekSummary { week: string; sessions: number; cardioDays: number; sets: number; tonnage: number }

export function weeklySummary(entries: SetEntry[], weeks: number, today: string): WeekSummary[] {
  const last = weekStart(today);
  const out: WeekSummary[] = Array.from({ length: weeks }, (_, i) => ({ week: addDays(last, -7 * (weeks - 1 - i)), sessions: 0, cardioDays: 0, sets: 0, tonnage: 0 }));
  const idx = new Map(out.map((w, i) => [w.week, i]));
  const lift = new Set<string>(), cardio = new Set<string>();
  for (const e of entries) {
    const i = idx.get(weekStart(e.date));
    if (i == null) continue;
    const w = out[i];
    if (isCardioEntry(e)) cardio.add(e.date);
    else if (!e.flags.includes('warmup')) { w.sets += 1; lift.add(e.date); }
    if (e.weight > 0 && e.reps != null && !e.flags.includes('hold')) w.tonnage += e.weight * e.reps;
  }
  for (const d of lift) out[idx.get(weekStart(d))!].sessions += 1;
  for (const d of cardio) if (!lift.has(d)) out[idx.get(weekStart(d))!].cardioDays += 1;
  return out;
}

/** Weeks in a row meeting the sessions goal. The in-progress week only counts once it is met; it never breaks a run. */
export function streak(summaries: WeekSummary[], goal: number): { current: number; best: number; thisWeekMet: boolean } {
  const thisWeekMet = (summaries.at(-1)?.sessions ?? 0) >= goal;
  const met = [...summaries.slice(0, -1).map((w) => w.sessions >= goal), ...(thisWeekMet ? [true] : [])];
  let best = 0, run = 0;
  for (const m of met) { run = m ? run + 1 : 0; best = Math.max(best, run); }
  return { current: run, best, thisWeekMet };
}

export function calendarDays(entries: SetEntry[], days: number, today: string): { date: string; sets: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) if (!e.flags.includes('warmup')) counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
  return Array.from({ length: days }, (_, i) => { const date = addDays(today, i - days + 1); return { date, sets: counts.get(date) ?? 0 }; });
}
