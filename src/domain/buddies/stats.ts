import { buddySteps, lifted, type Context } from '../achievements';
import type { SetEntry } from '../types';
import { STATS, type BuddyDef, type Stat } from './roster';
import { countsFrom } from './start';

// A buddy's four stats (plan §16.6): each grows from the training logged on or after the day it joined, and nothing else.
// Every buddy gets all of it (nothing is split between them); a late one stays behind for good (no catch-up); nothing goes
// down with time, only an edit or a delete can lower one. Named after the achievements groups:
//   Power (Getting stronger)  5 per PR set (judged against the whole log, never a pain or light set) and 5 per Moved-up step
//   Size  (Building muscle)   1 per working set, uncapped: a pain-flagged set feeds it like any other
//   Grit  (Showing up)        10 per session and 20 per goal week
//   Stamina                   1 per 3 cardio minutes
// A buddy's trait stat earns ×1.1 (common) to ×1.5 (legendary). The number shown is floor(√(xp/3)); Lv is floor(√(total/12)).

export const XP = { pr: 5, step: 5, set: 1, session: 10, goalWeek: 20, cardioMin: 3 } as const;
/** The trait's multiplier, in tenths, by rarity: ×1.1 … ×1.5. */
export const TRAIT_TENTHS = [11, 12, 13, 14, 15] as const;

/** The log, read once for every buddy: the days of each thing a stat counts, oldest first. */
export interface Training {
  start: string;
  sets: string[]; prs: string[]; steps: string[]; sessions: string[]; goalWeeks: string[];
  /** Cardio: each set's day and minutes. */ cardio: { date: string; min: number }[];
}

export function trainingOf(entries: readonly SetEntry[], ctx: Pick<Context, 'today' | 'profile'> & { start: string }): Training {
  const { start, today } = ctx;
  const s = buddySteps(entries, { since: start, today, profile: ctx.profile });
  const inRange = entries.filter((e) => e.date >= start && e.date <= today);
  return {
    start,
    sets: inRange.filter(lifted).map((e) => e.date).sort(),
    prs: s.prs.map((x) => x.date), steps: s['moved-up'].map((x) => x.date).sort(), sessions: s.sessions.map((x) => x.date),
    goalWeeks: s['goal-weeks'].map((x) => x.date),
    cardio: inRange.filter((e) => e.cardio).map((e) => ({ date: e.date, min: e.cardio!.seconds / 60 })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** How many of sorted `days` are on or after `from`. */
function onOrAfter(days: readonly string[], from: string): number {
  let lo = 0, hi = days.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (days[m] < from) lo = m + 1; else hi = m; }
  return days.length - lo;
}

/** floor(√(tenths / per)): the largest n with per·n² ≤ tenths, settled in whole numbers so no float lands a level short. */
function isqrt(tenths: number, per: number): number {
  let n = Math.floor(Math.sqrt(tenths / per));
  while ((n + 1) * (n + 1) * per <= tenths) n++;
  while (n > 0 && n * n * per > tenths) n--;
  return n;
}

export interface BuddyStats {
  /** Each stat's xp, in tenths (the trait's ×1.1 … ×1.5 kept exact). */ xp: Record<Stat, number>;
  /** The number shown for each. */ level: Record<Stat, number>;
  /** The one number on the roster and for friends. */ lv: number;
  /** What it came from, for the card's line: "With you 26 weeks: 41 PRs and 12 steps up, 1,530 sets…". */
  from: { since: string; prs: number; steps: number; sets: number; sessions: number; goalWeeks: number; cardioMin: number };
}

export const statLevel = (tenths: number): number => isqrt(tenths, 30);
export const lvOf = (tenths: number): number => isqrt(tenths, 120);

export function statsOf(b: Pick<BuddyDef, 'trait' | 'rarity'>, joined: string, t: Training): BuddyStats {
  const since = countsFrom(joined, t.start);
  const n = {
    prs: onOrAfter(t.prs, since), steps: onOrAfter(t.steps, since), sets: onOrAfter(t.sets, since),
    sessions: onOrAfter(t.sessions, since), goalWeeks: onOrAfter(t.goalWeeks, since),
    cardioMin: Math.floor(t.cardio.filter((c) => c.date >= since).reduce((a, c) => a + c.min, 0)),
  };
  const base: Record<Stat, number> = {
    power: XP.pr * n.prs + XP.step * n.steps,
    size: XP.set * n.sets,
    grit: XP.session * n.sessions + XP.goalWeek * n.goalWeeks,
    stamina: Math.floor(n.cardioMin / XP.cardioMin),
  };
  const xp = Object.fromEntries(STATS.map((s) => [s, base[s] * (s === b.trait ? TRAIT_TENTHS[b.rarity] : 10)])) as Record<Stat, number>;
  const level = Object.fromEntries(STATS.map((s) => [s, statLevel(xp[s])])) as Record<Stat, number>;
  return { xp, level, lv: lvOf(STATS.reduce((a, s) => a + xp[s], 0)), from: { since, ...n } };
}

/** The stat a buddy is best at (ties: the trait, then the order Power, Size, Grit, Stamina): Side by side names it. */
export function bestStat(s: BuddyStats, trait: Stat): Stat {
  return [...STATS].sort((a, b) => s.xp[b] - s.xp[a] || (b === trait ? 1 : 0) - (a === trait ? 1 : 0))[0];
}
