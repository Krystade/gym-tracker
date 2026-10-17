import { addDays, weekStart, weeklySummary } from '../domain/analytics';
import { nextDay, type DayPlan, type Program } from '../domain/program';
import { prIds } from '../domain/records';
import type { SetEntry } from '../domain/types';

/** What the Worker's reminder and recap need, and nothing more: no lift names, weights or notes leave the phone this way. */
export interface Activity { date: string; next: string | null; week: { start: string; sessions: number; sets: number; prs: number; cardio: number } }

/**
 * `date`: the last day anything was logged (the reminder stays quiet on a day that has one). `next`: the program day that
 * comes up next. `week`: this week's sessions, sets and PRs, counted as Stats counts them, and `cardio`: its cardio-only days.
 */
export function activityOf(entries: SetEntry[], program: Program | null | undefined, plans: DayPlan[], today: string): Activity {
  const date = entries.reduce((d, e) => (e.date <= today && e.date > d ? e.date : d), '0000-00-00');
  const start = weekStart(today);
  const w = weeklySummary(entries, 1, today)[0];
  const thisWeek = new Set(entries.filter((e) => e.date >= start && e.date <= today).map((e) => e.id));
  const prs = [...prIds(entries)].filter((id) => thisWeek.has(id)).length;
  // Counting today's plan too: on a day with nothing logged it's the same day, and after a session it's the one after.
  const next = program?.days.length ? program.days[nextDay(program, plans, entries, addDays(today, 1))]?.name ?? null : null;
  return { date, next: next?.slice(0, 40) ?? null, week: { start, sessions: Math.min(w.sessions, 7), sets: w.sets, prs, cardio: Math.min(w.cardioDays, 7) } };
}
