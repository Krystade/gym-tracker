import { addDays } from '../analytics';
import { lifted, type Achievements } from '../achievements';
import type { SetEntry } from '../types';
import { awards } from './rewards';
import type { Training } from './stats';
import type { Wallet } from './gacha';

// What training has earned (plan §16.7): worked out from the log, never stored, and landing at once. Only spends are stored
// (domain/buddies/gacha), so the balance is earned − spent + refunds, and never below 0: an edit that takes the income under
// what was spent shows 0 and takes nothing already owned back. Earned points only: nothing is bought with money.
//   Points: 1 per working set · 1 per 3 cardio minutes · +5 a session · +20 a goal week · achievement rewards (domain/buddies/rewards)
//   Tickets (owner 2026-11-15, more of them): 1 a goal week · 1 per 5 sessions · gold and platinum achievements
// What earned counts is also what friends see (owner Q5: lifetime earned, which only rises with training, not the balance).

export const INCOME = { set: 1, cardioMin: 3, session: 5, goalWeek: 20, goalWeekTickets: 1, sessionsPerTicket: 5 } as const;

export interface Earned extends Wallet {
  parts: { sets: number; cardio: number; sessions: number; goalWeeks: number; awards: number; goalWeekTickets: number; sessionTickets: number; awardTickets: number };
}

/** Everything earned from the buddies' start: `t` from stats' trainingOf, `ach` the achievements as the app shows them. */
export function earned(t: Training, ach: Achievements | null): Earned {
  const cardioMin = Math.floor(t.cardio.reduce((a, c) => a + c.min, 0));
  const aw = ach ? awards(ach, t.start) : { points: 0, tickets: 0 };
  const parts = {
    sets: INCOME.set * t.sets.length,
    cardio: Math.floor(cardioMin / INCOME.cardioMin),
    sessions: INCOME.session * t.sessions.length,
    goalWeeks: INCOME.goalWeek * t.goalWeeks.length,
    awards: aw.points,
    goalWeekTickets: INCOME.goalWeekTickets * t.goalWeeks.length,
    sessionTickets: Math.floor(t.sessions.length / INCOME.sessionsPerTicket),
    awardTickets: aw.tickets,
  };
  return {
    points: parts.sets + parts.cardio + parts.sessions + parts.goalWeeks + parts.awards,
    tickets: parts.goalWeekTickets + parts.sessionTickets + parts.awardTickets,
    parts,
  };
}

/**
 * What one set earns as it's logged (Today's "+1" off the row): the set's share of `earned`'s sets part, by the same rule that
 * counts it there (stats.trainingOf: a lifted set, warm-ups and cardio aside). Cardio pays by the day's minutes, not per bout.
 */
export const setPoints = (e: SetEntry): number => (lifted(e) ? INCOME.set : 0);

/** The log as it stood at the end of `day`: what had been counted by then. */
const upTo = (t: Training, day: string): Training => {
  const by = (xs: readonly string[]) => xs.filter((d) => d <= day);
  return { start: t.start, sets: by(t.sets), prs: by(t.prs), steps: by(t.steps), sessions: by(t.sessions), goalWeeks: by(t.goalWeeks), cardio: t.cardio.filter((c) => c.date <= day) };
};
const achUpTo = (a: Achievements | null, day: string): Achievements | null => a && {
  ...a, unlocks: a.unlocks.filter((u) => u.date <= day),
  repeats: Object.fromEntries(Object.entries(a.repeats).map(([id, ds]) => [id, ds.filter((d) => d <= day)])),
};

export interface DayEarned extends Earned {
  /** Sessions counted to the end of the day, and how many more to the next session ticket (1 to INCOME.sessionsPerTicket). */
  sessions: number; toTicket: number;
}
/**
 * What one day paid (the finish summary, owner 2026-11-21): `earned` to the end of `day` less `earned` to the end of the day
 * before, part by part, so the summary and the Buddies tab can never disagree. A goal week pays on the day it was met.
 */
export function earnedOn(t: Training, ach: Achievements | null, day: string): DayEarned {
  const prev = addDays(day, -1);
  const a = earned(upTo(t, day), achUpTo(ach, day)), b = earned(upTo(t, prev), achUpTo(ach, prev));
  const parts = Object.fromEntries(Object.entries(a.parts).map(([k, v]) => [k, v - b.parts[k as keyof Earned['parts']]])) as Earned['parts'];
  const sessions = t.sessions.filter((d) => d <= day).length;
  return { points: a.points - b.points, tickets: a.tickets - b.tickets, parts, sessions, toTicket: INCOME.sessionsPerTicket - (sessions % INCOME.sessionsPerTicket) };
}
