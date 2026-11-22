// Whether a week met its goal (owner, 2026-11-21): a calendar week (Monday to Sunday) is a goal week once EITHER its sessions
// reach the sessions goal OR its sets reach the sets goal. The one test every goal week is judged by: points and tickets
// (buddies/points), Goal weeks and Best run (achievements), the streaks (analytics.streak) and the weekly rings. No imports, so
// analytics and domain/weekGoal can both read it.

/**
 * A week's goals: `sessions` a week (profile.weeklyGoal) and `sets`, fractional muscle-sets a week (direct 1, indirect ½, each
 * muscle's day capped as Stats counts it: domain/weekGoal). No `sets`: only the sessions goal counts (a friend's week, whose
 * set goal this phone doesn't know).
 */
export interface WeekGoals { sessions: number; sets?: number }
/** What a week has so far: days with a lifted set, and its fractional muscle-sets. */
export interface WeekCount { sessions: number; sets: number }
export type GoalHit = 'sessions' | 'sets' | 'both';

/** Which goal the week met, or null: neither yet. */
export function goalHit(w: WeekCount, g: WeekGoals): GoalHit | null {
  const s = w.sessions >= g.sessions, v = g.sets != null && g.sets > 0 && w.sets >= g.sets - 1e-9;
  return s && v ? 'both' : s ? 'sessions' : v ? 'sets' : null;
}
export const goalWeekHit = (w: WeekCount, g: WeekGoals): boolean => goalHit(w, g) != null;
