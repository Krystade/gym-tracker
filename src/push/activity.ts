import { addDays, weekStart, weeklySummary } from '../domain/analytics';
import { fitReminder } from '../domain/learn/remind';
import { nextDay, type DayPlan, type Program } from '../domain/program';
import { pushAsks } from '../domain/morning';
import { prIds } from '../domain/records';
import type { SetEntry } from '../domain/types';

/**
 * What the Worker's reminder, recap and morning pain question need, and nothing more: no weights or notes leave the phone this
 * way, and a lift's name only for the pain question (owner, 2026-10-20: name the region and lift).
 */
export interface Activity {
  date: string; next: string | null; week: { start: string; sessions: number; sets: number; prs: number; cardio: number };
  /** His sessions-a-week goal: the reminder is quiet once the week reaches it (with learning on). */
  goal?: number;
  /** Per weekday (0 = Sunday), the learned reminder time "HH:MM", 'off' or null (learn/remind): days and times only. */
  remind?: (string | null)[];
  /**
   * Pain yesterday or today not yet asked about (domain/morning pushAsks): the day, the region and the lift, at most one a day.
   * The Worker asks the day after at about 11:00 (item 08). Answered on the phone first, it goes from here, and the push with it.
   */
  pain?: { date: string; region: string; lift: string }[];
}
/** This phone's time zone, the one the Worker plans in (client.ts sends it with the prefs). */
export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * `date`: the last day anything was logged (the reminder stays quiet on a day that has one). `next`: the program day that
 * comes up next. `week`: this week's sessions, sets and PRs, counted as Stats counts them, and `cardio`: its cardio-only days.
 */
export function activityOf(entries: SetEntry[], program: Program | null | undefined, plans: DayPlan[], today: string, goal?: number, tz = zone()): Activity {
  const date = entries.reduce((d, e) => (e.date <= today && e.date > d ? e.date : d), '0000-00-00');
  const start = weekStart(today);
  const w = weeklySummary(entries, 1, today)[0];
  const thisWeek = new Set(entries.filter((e) => e.date >= start && e.date <= today).map((e) => e.id));
  const prs = [...prIds(entries)].filter((id) => thisWeek.has(id)).length;
  // Counting today's plan too: on a day with nothing logged it's the same day, and after a session it's the one after.
  const next = program?.days.length ? program.days[nextDay(program, plans, entries, addDays(today, 1))]?.name ?? null : null;
  const a: Activity = { date, next: next?.slice(0, 40) ?? null, week: { start, sessions: Math.min(w.sessions, 7), sets: w.sets, prs, cardio: Math.min(w.cardioDays, 7) } };
  if (goal != null && Number.isInteger(goal) && goal >= 1 && goal <= 7) a.goal = goal;
  try { a.remind = fitReminder(entries, today, tz).schedule; } catch { /* a refinement: never a reason to fail the post */ }
  const pain = pushAsks(entries, today).map((p) => ({ ...p, lift: p.lift.slice(0, 40) }));
  if (pain.length) a.pain = pain;
  return a;
}
