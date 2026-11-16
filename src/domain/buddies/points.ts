import type { Achievements } from '../achievements';
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
