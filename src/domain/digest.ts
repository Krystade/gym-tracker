import { addDays, streak, weekStart, weeklyMuscleSets, weeklySummary } from './analytics';
import { isCardioEntry, weeklyCardioMinutes } from './cardio';
import { MUSCLES, type Muscle } from './muscles';
import type { Profile } from './profile';
import { prIds } from './records';
import { liftKey, normalizeName } from './ids';
import type { SetEntry } from './types';

// The weekly digest: one week looked back on, on Today and Stats. Nothing new is stored; it reads the same counts as
// Stats (weeklySummary), the same PR rule as the badge and the recap (records), and the same muscle sets as the bars.

export interface DigestLift { exercise: string; /** Working sets, or bouts for cardio. */ sets: number; prs: number; cardio: boolean }
export interface Digest {
  week: string; end: string;
  sessions: number; goal: number; cardioDays: number; streak: number;
  sets: number; prs: number; cardioMinutes: number;
  lifts: DigestLift[];
  /** Up to three muscles short of their target's low end, furthest short first. */
  under: { muscle: Muscle; sets: number; target: [number, number] }[];
  before: { sessions: number; sets: number; prs: number; cardioMinutes: number };
}

/** The week a digest is about: last week; on a Sunday the recap (`recap`) is about the week that day ends. */
export const digestWeek = (today: string, recap = false): string =>
  recap && weekStart(addDays(today, 1)) !== weekStart(today) ? weekStart(today) : addDays(weekStart(today), -7);

const key = liftKey;
/** A test for sets in the week starting `week` (its end worked out once, not per set). */
const inWeek = (week: string) => { const end = addDays(week, 7); return (e: SetEntry) => e.date >= week && e.date < end; };

export function weekDigest(entries: SetEntry[], profile: Profile, week: string): Digest {
  const end = addDays(week, 6);
  const [prev, cur] = weeklySummary(entries, 2, end);
  const prs = prIds(entries);
  const prsIn = (w: string) => { const has = inWeek(w); return entries.filter((e) => has(e) && prs.has(e.id)).length; };

  const lifts = new Map<string, DigestLift>();
  const inThisWeek = inWeek(week);
  for (const e of entries) {
    if (!inThisWeek(e)) continue;
    const cardio = isCardioEntry(e);
    const k = key(e.exercise);
    const l = lifts.get(k) ?? lifts.set(k, { exercise: normalizeName(e.exercise), sets: 0, prs: 0, cardio }).get(k)!;
    if (cardio || !e.flags.includes('warmup')) l.sets++;
    if (prs.has(e.id)) l.prs++;
  }

  const muscle = weeklyMuscleSets(entries, week).sets;
  const under = MUSCLES.map((m) => ({ muscle: m, sets: Math.round(muscle[m] * 10) / 10, target: profile.targets[profile.tiers[m]] }))
    .filter((u) => u.sets < u.target[0])
    .sort((a, b) => (b.target[0] - b.sets) - (a.target[0] - a.sets) || profile.tiers[a.muscle] - profile.tiers[b.muscle])
    .slice(0, 3);

  return {
    week, end,
    sessions: cur.sessions, goal: profile.weeklyGoal, cardioDays: cur.cardioDays,
    streak: streak(weeklySummary(entries, 104, end), profile.weeklyGoal).current,
    sets: cur.sets, prs: prsIn(week), cardioMinutes: weeklyCardioMinutes(entries, week),
    lifts: [...lifts.values()].sort((a, b) => Number(a.cardio) - Number(b.cardio) || b.sets - a.sets || b.prs - a.prs || a.exercise.localeCompare(b.exercise)),
    under,
    before: { sessions: prev.sessions, sets: prev.sets, prs: prsIn(prev.week), cardioMinutes: weeklyCardioMinutes(entries, prev.week) },
  };
}
