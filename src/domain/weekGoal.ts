import { addDays, SESSION_CAP, weekStart } from './analytics';
import { isCardioEntry } from './cardio';
import { goalHit, type GoalHit, type WeekCount, type WeekGoals } from './goalHit';
import { MUSCLES, muscleVector, type Muscle } from './muscles';
import type { Profile } from './profile';
import { isWorking } from './progression';
import { fitTargets, setYield, weeklyBudget } from './targets';
import type { SetEntry } from './types';

// The weekly goals (owner, 2026-11-21): sessions a week, and sets a week beside it. Either met makes the calendar week a goal
// week (domain/goalHit). The sets goal is the profile's own when set by hand (More › Weekly goal), else the muscles' weekly
// minimums added up: each muscle's priority range as Stats fits it (domain/targets), read as the week began (the 8 weeks up to
// the Sunday before), so it holds still all week and a refit later never re-judges a week gone by.

export type { GoalHit, WeekCount, WeekGoals } from './goalHit';
export { goalHit, goalWeekHit } from './goalHit';

/** The sessions goal as every goal week reads it: a whole number, 1 to 7 (2 when unset). */
export const sessionGoalOf = (p: Pick<Profile, 'weeklyGoal'>): number => Math.min(7, Math.max(1, Math.round(p.weeklyGoal) || 2));
/** The most a hand-set sets goal may be. */
export const SET_GOAL_MAX = 400;
/** A hand-set sets goal, or null: none (the default stands). */
export const ownSetGoal = (p: Pick<Profile, 'setGoal'>): number | null =>
  typeof p.setGoal === 'number' && Number.isFinite(p.setGoal) && p.setGoal >= 1 && p.setGoal <= SET_GOAL_MAX ? Math.round(p.setGoal) : null;

/** Every muscle's weekly minimum, added up and rounded: the default sets goal for these ranges. */
export const minimumsOf = (p: Pick<Profile, 'tiers' | 'targets'>): number =>
  Math.round(MUSCLES.reduce((a, m) => a + Math.max(0, p.targets[p.tiers[m]]?.[0] ?? 0), 0));

const byDate = (a: SetEntry, b: SetEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * The goals for each week (its Monday) of this log: the sessions goal, and the sets goal (the hand-set one, else the minimums
 * of the profile fitted to the 8 weeks before that Monday, as Stats fits it). The stored profile or the fitted one read the same
 * (a fitted profile keeps its hand-set tiers in `custom`). Each week worked out once.
 */
export function goalsFor(profile: Profile, entries: readonly SetEntry[]): (week: string) => WeekGoals {
  const sessions = sessionGoalOf(profile), own = ownSetGoal(profile);
  if (own != null) return () => ({ sessions, sets: own });
  const work = entries.filter(isWorking).sort(byDate);
  const at = (d: string) => { let lo = 0, hi = work.length; while (lo < hi) { const m = (lo + hi) >> 1; if (work[m].date < d) lo = m + 1; else hi = m; } return lo; };
  const memo = new Map<string, WeekGoals>();
  return (week) => {
    const w = weekStart(week);
    let g = memo.get(w);
    if (!g) {
      const day = addDays(w, -1), win = work.slice(at(addDays(day, -57)), at(w));
      const fit = fitTargets(profile, weeklyBudget(profile, null, win, day), setYield(win, day));
      g = { sessions, sets: minimumsOf({ tiers: profile.tiers, targets: fit.targets }) };
      memo.set(w, g);
    }
    return g;
  };
}

/** A set that counts toward the goals: lifted (not a warm-up, not cardio), as the sessions goal and Stats count them. */
const counts = (e: SetEntry) => !e.flags.includes('warmup') && !isCardioEntry(e);

/** Each day's fractional muscle-sets, every muscle capped at SESSION_CAP a day (as Stats counts a week's sets), summed. */
function dayTotals(entries: readonly SetEntry[], keep: (e: SetEntry) => boolean): Map<string, number> {
  const byDay = new Map<string, Record<Muscle, number>>();
  const lifted = new Set<string>();
  for (const e of entries) {
    if (!counts(e) || !keep(e)) continue;
    lifted.add(e.date);
    const v = muscleVector(e.exercise);
    if (!v) continue;
    const d = byDay.get(e.date) ?? byDay.set(e.date, Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>).get(e.date)!;
    for (const [m, f] of Object.entries(v) as [Muscle, number][]) d[m] += f;
  }
  const out = new Map<string, number>();
  for (const d of lifted) {
    const x = byDay.get(d);
    out.set(d, x ? MUSCLES.reduce((a, m) => a + Math.min(x[m], SESSION_CAP), 0) : 0);
  }
  return out;
}

/** The week of `week` (any day in it) so far: its sessions and sets up to and including `through` (default: the whole week). */
export function weekCount(entries: readonly SetEntry[], week: string, through?: string): WeekCount {
  const from = weekStart(week), to = through ?? addDays(from, 6);
  const days = dayTotals(entries, (e) => e.date >= from && e.date <= to);
  let sets = 0;
  for (const v of days.values()) sets += v;
  return { sessions: days.size, sets };
}

/** Each goal week of the log, oldest first: its Monday, the day it was met (the first day either goal was), and by which. */
export function goalWeekDays(entries: readonly SetEntry[], goalsAt: (week: string) => WeekGoals): { week: string; date: string; by: GoalHit }[] {
  const byWeek = new Map<string, [string, number][]>();
  for (const [d, v] of dayTotals(entries, () => true)) { const w = weekStart(d); (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push([d, v]); }
  const out: { week: string; date: string; by: GoalHit }[] = [];
  for (const [week, days] of byWeek) {
    const g = goalsAt(week);
    let n = 0, sets = 0;
    for (const [d, v] of days.sort((a, b) => a[0].localeCompare(b[0]))) {
      n++; sets += v;
      const by = goalHit({ sessions: n, sets }, g);
      if (by) { out.push({ week, date: d, by }); break; }
    }
  }
  return out.sort((a, b) => a.week.localeCompare(b.week));
}
