import { addDays, weekStart, weeklySummary } from '../domain/analytics';
import { fitReminder } from '../domain/learn/remind';
import type { WeekPlan } from '../domain/learn/schedule';
import { nextDay, type DayPlan, type Program } from '../domain/program';
import { pushAsks } from '../domain/morning';
import { clip, MAX_LIFT } from './payload';
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
  pain?: { date: string; region: string; lift: string; hurts?: { region: string; lift: string }[] }[];
  /** The week plan's rest dates in the next 7 days (restDatesOf): dates only. The Worker sends no reminder on them. */
  rest?: string[];
}
/** This phone's time zone, the one the Worker plans in (client.ts sends it with the prefs). */
export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * Readiness S5 (owner Q6: no workout reminder on a planned rest day): the dates of the next 7 days the week plan rests, for the
 * Worker. Only what the plan rests whatever he does next: a rest day after a session still to come rests on that session being
 * done, so it isn't sent until it is (a skipped session must not silence the days after it). Today is a rest date only when the
 * tile says "Rest today": "Goal met · extra session optional" is a day he may train, so it keeps its reminder (with learning on
 * the Worker is already quiet once the goal is met). The later days of a met goal are the plan's rest days ("Goal met by …").
 * Undefined without a plan for today (the planner failed): the Worker reminds as before.
 */
export function restDatesOf(r: { verdict: { kind: string }; plan: WeekPlan | null } | null | undefined, today: string): string[] | undefined {
  const p = r?.plan;
  if (!p || p.today !== today) return undefined;
  const end = addDays(today, 7), out: string[] = [];
  for (const [i, d] of p.days.entries()) {
    if (d.date >= end) break;
    if (d.train) { if (i === 0 && d.fixed === 'trained') continue; break; }
    if (i > 0 || r!.verdict.kind === 'rest') out.push(d.date);
  }
  return out;
}

/**
 * `date`: the last day anything was logged (the reminder stays quiet on a day that has one). `next`: the program day that
 * comes up next. `week`: this week's sessions, sets and PRs, counted as Stats counts them, and `cardio`: its cardio-only days.
 * `rest`: the week plan's rest dates (restDatesOf), those from today on.
 */
export function activityOf(entries: SetEntry[], program: Program | null | undefined, plans: DayPlan[], today: string, goal?: number, tz = zone(), rest?: readonly string[]): Activity {
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
  // Lift names cut at a word (a cut mid-word here can't be mended on the Worker: "Dumbbe").
  const pain = pushAsks(entries, today).map((p) => ({ ...p, lift: clip(p.lift, MAX_LIFT), ...(p.hurts && { hurts: p.hurts.map((h) => ({ ...h, lift: clip(h.lift, MAX_LIFT) })) }) }));
  if (pain.length) a.pain = pain;
  // Only today's and later (a plan read yesterday rests nothing that's still to come once it's past), at most 7.
  const ahead = [...new Set(rest ?? [])].filter((d) => d >= today && d < addDays(today, 7)).sort();
  if (ahead.length) a.rest = ahead;
  return a;
}
