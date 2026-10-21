import { addDays, weekStart, weeklyMuscleSets } from './analytics';
import { isCardioEntry } from './cardio';
import { fitReminder } from './learn/remind';
import { type Muscle } from './muscles';
import { status, targetFor, type Profile } from './profile';
import { isWorking } from './progression';
import { nextDay, type DayPlan, type Program } from './program';
import { daySets, doneAt, sameExercise } from './stats';
import { daySummary, prSetIds, topSet } from './summary';
import { sessionMinutes } from './timing';
import type { SetEntry } from './types';

// Finishing a workout (owner, 2026-10-20: "I may add more sets or exercises but I may just be done … I don't want to force a
// bunch of boring meaningless steps on the user"). Nothing here asks anything: the session closes on Finish, or by itself once
// it has gone quiet (learn/session quietAfter), and a set logged after opens it again. Nothing is ever deleted or changed by it.
// The session is the day's sets: past midnight they stay on the day they began (timing.sessionDay), and the quiet time runs
// from the last set's own time, so a session that crosses midnight closes like any other.

/** The latest done-time (epoch ms) of a set on `date`, warm-ups and cardio included; null without a timed set. */
export function lastSetAt(entries: readonly SetEntry[], date: string): number | null {
  let last: number | null = null;
  for (const e of daySets(entries, date)) if (e.loggedAt) { const t = doneAt(e); if (last == null || t > last) last = t; }
  return last;
}

/** How the session on a day stands: closed by Finish or by going quiet (at `at`), or open; `lastAt`: its last set. */
export interface Close { how: 'finish' | 'auto' | null; at: number | null; lastAt: number | null }

/**
 * The session on `date` at `now`. `tapped`: when Finish was tapped on it (counts only if no set was logged after); `quiet`: how
 * long it may go quiet, in seconds (learn/session quietAfter; null, never by itself); `restUntil`: the end of a rest still on the
 * timer, which holds it open until then.
 */
export function sessionClose(entries: readonly SetEntry[], date: string, now: number, o: { quiet: number | null; tapped?: number | null; restUntil?: number | null }): Close {
  const lastAt = lastSetAt(entries, date);
  if (o.tapped != null && (lastAt == null || o.tapped >= lastAt)) return { how: 'finish', at: o.tapped, lastAt };
  if (o.quiet == null || lastAt == null) return { how: null, at: null, lastAt };
  const at = Math.max(lastAt + o.quiet * 1000, o.restUntil ?? 0);
  return now >= at ? { how: 'auto', at, lastAt } : { how: null, at: null, lastAt };
}

/**
 * Whether Today shows the summary card in the plan's place: once everything planned is done (`planDone`) or the session is
 * closed, on a day with a working set (`worked`). "Add more" (`more`, when tapped) brings the plan back until the session
 * closes again after it.
 */
export function showSummary(close: Close, planDone: boolean, more: number | null, worked: boolean): boolean {
  if (!worked || !(planDone || close.how)) return false;
  return more == null || (close.how != null && close.at! > more);
}

export interface FinishSummary {
  /** Working sets (cardio bouts apart), and the day's tonnage counted as the week's is (analytics.weeklySummary). */
  sets: number; bouts: number; tonnage: number;
  /** First set to last (timing.sessionMinutes); null with under two timed sets. */
  minutes: number | null;
  /** Each lift's best PR set of the day (domain/records' one rule). */
  prs: { exercise: string; set: SetEntry }[];
  /** Each muscle that got a set or more today: today's sets, this week's so far (to the day), its weekly band (Stats' targets). */
  muscles: { muscle: Muscle; today: number; week: number; band: [number, number]; status: 'under' | 'on' | 'over' }[];
}

/** The day's summary for the finished card: `profile` with its fitted targets, as Stats shows them. */
export function finishSummary(entries: readonly SetEntry[], date: string, profile: Profile): FinishSummary {
  const day = daySets(entries, date);
  const all = entries as SetEntry[];
  let sets = 0, bouts = 0, tonnage = 0;
  for (const e of day) {
    if (isCardioEntry(e)) bouts++;
    else if (isWorking(e)) sets++;
    if (e.weight > 0 && e.reps != null && !e.flags.includes('hold')) tonnage += e.weight * e.reps;
  }
  const ids = prSetIds(all, date);
  const prs: FinishSummary['prs'] = [];
  for (const e of day) {
    if (!ids.has(e.id) || prs.some((p) => sameExercise(p.exercise, e.exercise))) continue;
    prs.push({ exercise: e.exercise, set: topSet(day.filter((x) => ids.has(x.id) && sameExercise(x.exercise, e.exercise))) });
  }
  // The week to the day: a summary looked at later doesn't count the days after it.
  const week = weeklyMuscleSets(all.filter((e) => e.date <= date), weekStart(date)).sets;
  const muscles = daySummary(all, date).muscles.filter(([, n]) => n >= 1).map(([muscle, n]) => {
    const band = targetFor(profile, muscle);
    return { muscle, today: n, week: week[muscle], band, status: status(week[muscle], band) };
  });
  return { sets, bouts, tonnage, minutes: sessionMinutes(all, date), prs, muscles };
}

/**
 * The forward look: the program's next day (program.nextDay, as the reminder's recap names it) and how many days on his routine
 * puts it (b: learn/remind, in a weekly routine likelier than not, the first weekday after `date` likelier than not one of his).
 * (c) Without a routine learned, no day is named; without a program, no program day.
 */
export function nextUp(entries: readonly SetEntry[], program: Program | null | undefined, plans: DayPlan[], date: string, tz: string): { day: string | null; inDays: number | null } {
  const after = addDays(date, 1);
  const day = program?.days.length ? program.days[nextDay(program, plans, entries as SetEntry[], after)]?.name ?? null : null;
  let inDays: number | null = null;
  try {
    const fit = fitReminder(entries, after, tz);
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (let k = 1; k <= 7 && inDays == null && fit.routine > 0.5; k++) {
      const d = fit.days.find((x) => x.day === (wd + k) % 7);
      if (d && d.p > 0.5 && d.pOff < 0.5) inDays = k;
    }
  } catch { /* a refinement: never a reason to fail the card */ }
  return { day, inDays };
}
