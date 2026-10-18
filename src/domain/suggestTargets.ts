import { addDays, weekStart, weeklyMuscleSets, weeklySummary } from './analytics';
import { MUSCLES, type Muscle } from './muscles';
import type { Profile, Tier } from './profile';
import type { SetEntry } from './types';

// Suggestions for the weekly goal and the priorities, read from the last 8 whole weeks. Nothing here changes a thing
// by itself: the screens offer each one to accept with a tap or dismiss (round 10, owner answer 9).

const WEEKS = 8;
const MIN_SESSIONS = 4;

/** The last whole weeks (this one left out), oldest first, from the week of your first set at most 8 back. */
function wholeWeeks(entries: SetEntry[], today: string): string[] {
  const first = entries.reduce((d, e) => (e.date < d ? e.date : d), today);
  const from = weekStart(first), now = weekStart(today);
  return Array.from({ length: WEEKS }, (_, i) => addDays(now, -7 * (WEEKS - i))).filter((w) => w >= from);
}
/** Lifting sessions in each of those weeks. */
const sessions = (entries: SetEntry[], weeks: string[], today: string): number[] =>
  weeklySummary(entries, WEEKS + 1, today).filter((w) => weeks.includes(w.week)).map((w) => w.sessions);

/** A sessions-a-week goal from the average of the last 8 whole weeks, when that's a session or more from yours. */
export function goalSuggestion(entries: SetEntry[], profile: Profile, today: string): { goal: number; average: number } | null {
  const weeks = wholeWeeks(entries, today);
  if (weeks.length < 2) return null;
  const average = sessions(entries, weeks, today).reduce((a, n) => a + n, 0) / weeks.length;
  if (Math.abs(average - profile.weeklyGoal) < 1) return null;
  return { goal: Math.min(7, Math.max(1, Math.round(average))), average };
}

export interface PrioritySuggestion { tiers: Record<Muscle, Tier>; changes: { muscle: Muscle; from: Tier; to: Tier }[] }

/**
 * Priorities from what you've trained over the last 8 whole weeks: the trained muscles ranked by sets (direct 1, indirect
 * ½) and split into four even groups, 1 the most; untrained ones go to 4. Null when it would change nothing, or with
 * fewer than 4 sessions to go by.
 */
export function prioritySuggestion(entries: SetEntry[], profile: Profile, today: string): PrioritySuggestion | null {
  const weeks = wholeWeeks(entries, today);
  if (sessions(entries, weeks, today).reduce((a, n) => a + n, 0) < MIN_SESSIONS) return null;
  const total = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  for (const w of weeks) { const s = weeklyMuscleSets(entries, w).sets; for (const m of MUSCLES) total[m] += s[m]; }
  const trained = MUSCLES.filter((m) => total[m] > 0).sort((a, b) => total[b] - total[a]);
  const tiers = Object.fromEntries(MUSCLES.map((m) => [m, 4])) as Record<Muscle, Tier>;
  trained.forEach((m, i) => { tiers[m] = (1 + Math.floor((4 * i) / trained.length)) as Tier; });
  // Muscles with as many sets share the higher priority.
  trained.forEach((m, i) => { if (i && total[m] === total[trained[i - 1]]) tiers[m] = tiers[trained[i - 1]]; });
  const changes = MUSCLES.filter((m) => tiers[m] !== profile.tiers[m]).map((m) => ({ muscle: m, from: profile.tiers[m], to: tiers[m] }));
  return changes.length ? { tiers, changes } : null;
}
