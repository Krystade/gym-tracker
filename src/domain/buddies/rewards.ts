import { DEF, type Achievements, type Tier } from '../achievements';

// What achievements pay into Gym Buddies (plan §16.5, owner 2026-10-22): starter, bronze and silver give points; gold and
// platinum give tickets, by how hard the tier really is for a 3.5×/week lifter (≤ 4 months 1, 4–9 months 2, 9–18 months 3,
// 18–36 months 5, rarely ever 8; the exploring families a band lower on purpose). A ticket is one free pull on either banner.
// Buddies read achievements and award nothing themselves: an edit that takes an unlock away takes its reward with it.
// Only unlocks from the buddies' start day on pay (history pays nothing).

export const POINTS: Partial<Record<Tier, number>> = { starter: 10, bronze: 25, silver: 50 };

/** Tickets for each gold and platinum, keyed `id:tier` (a test fails when DEFS gains one without an entry). */
export const TICKETS: Readonly<Record<string, number>> = {
  'sessions:gold': 3, 'sessions:platinum': 5,
  'goal-weeks:gold': 3, 'goal-weeks:platinum': 5,
  'best-run:gold': 3, 'best-run:platinum': 8,
  'plan-days:gold': 3, 'plan-days:platinum': 5,
  'prs:gold': 1, 'prs:platinum': 5,
  'stronger:gold': 2, 'stronger:platinum': 5,
  'moved-up:gold': 2, 'moved-up:platinum': 3,
  'on-target:gold': 3, 'on-target:platinum': 8,
  'every-muscle:gold': 1,
  'useful-sets:gold': 2, 'useful-sets:platinum': 5,
  'plates:gold': 3, 'plates:platinum': 5,
  'bodyweight:gold': 2, 'bodyweight:platinum': 3,
  'new-lifts:gold': 1, 'new-lifts:platinum': 2,
  'cardio:gold': 1, 'cardio:platinum': 3,
  'trained-together:gold': 3, 'trained-together:platinum': 5,
  'gym-crew:gold': 3, 'gym-crew:platinum': 5,
  'same-week:gold': 2, 'same-week:platinum': 3,
  'crew-streak:gold': 3, 'crew-streak:platinum': 8,
  'crew-day:gold': 3, 'crew-day:platinum': 5,
  'full-house:gold': 2, 'full-house:platinum': 3,
  // Your body: weighing in about 4 days a week, a photo day every 2 weeks.
  'weigh-ins:gold': 2, 'weigh-ins:platinum': 3,
  'photo-days:gold': 3, 'photo-days:platinum': 5,
};
/** Your body's families that pay nothing (owner 2026-10-29: only Weigh-ins and Photo days, the habit; never the scale's rate). */
export const UNPAID: ReadonlySet<string> = new Set(['steady-weeks', 'photo-season', 'flexed-relaxed']);

export interface Award { points: number; tickets: number }
export const rewardOf = (id: string, tier: Tier): Award =>
  (UNPAID.has(id) ? { points: 0, tickets: 0 } : { points: POINTS[tier] ?? 0, tickets: TICKETS[`${id}:${tier}`] ?? 0 });
/** The points a family has paid once its value reaches `value`, each level once (domain/buddies/gacha's pace for Your body). */
export const pointsAt = (id: string, value: number): number =>
  DEF.get(id)!.levels.reduce((a, lv) => a + (value >= lv.at ? rewardOf(id, lv.tier).points : 0), 0);

/** Everything achievements have paid since `start`: each unlock once (per lift for plates and bodyweight), each repeat each time. */
export function awards(a: Achievements, start: string): Award {
  const out = { points: 0, tickets: 0 };
  const add = (r: Award, n = 1) => { out.points += r.points * n; out.tickets += r.tickets * n; };
  for (const u of a.unlocks) if (u.date >= start && !DEF.get(u.id)?.repeat) add(rewardOf(u.id, u.tier));
  for (const [id, dates] of Object.entries(a.repeats)) {
    const def = DEF.get(id);
    if (def?.repeat) add(rewardOf(id, def.levels[0].tier), dates.filter((d) => d >= start).length);
  }
  return out;
}
