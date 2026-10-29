import { describe, expect, it } from 'vitest';
import { achievements, buddySteps, DEF, DEFS, familySteps, type Achievements, type Context } from '../achievements';
import { addDays } from '../analytics';
import { defaultProfile } from '../profile';
import type { Flag, SetEntry } from '../types';
import { earned, INCOME } from './points';
import { awards, POINTS, rewardOf, TICKETS } from './rewards';
import { ACCESSORIES, BUDDIES, CREDITS, RARITIES } from './roster';
import { asDay, countsFrom, startDay } from './start';
import { bestStat, lvOf, statLevel, statsOf, trainingOf, TRAIT_TENTHS, XP } from './stats';

// Synthetic sets only.
let seq = 0;
const set = (date: string, exercise: string, weight: number, reps: number | null, flags: Flag[] = [], extra: Partial<SetEntry> = {}): SetEntry =>
  ({ id: `t|${date}|${exercise}|${++seq}`, date, seq, exercise, setNo: seq, weight, reps, flags, source: 'app', ...extra });
const MON = '2026-01-05';
const day = (n: number) => addDays(MON, n);
const profile = { ...defaultProfile(), weeklyGoal: 2 };
const TODAY = '2026-12-31';
const train = (log: SetEntry[], start = MON) => trainingOf(log, { start, today: TODAY, profile });
const plain = { trait: 'grit', rarity: 0 } as const;
/** A lifter: two sessions a week of rising bench and rows, with some cardio. */
const lifter = (weeks: number, from = 0) => Array.from({ length: weeks }, (_, w) => [2, 4].flatMap((d) => {
  const at = day(from + w * 7 + d);
  return [set(at, 'Bench Press', 135 + 5 * w, 8), set(at, 'Bench Press', 135 + 5 * w, 8), set(at, 'Barbell Row', 95 + 5 * w, 10),
    set(at, 'Treadmill', 0, null, ['cardio'], { cardio: { seconds: 900 } })];
})).flat();

describe('start', () => {
  it('keeps the earliest real day of the phones’, else today; a bad value starts again', () => {
    expect(startDay('2026-11-10', '2026-11-03', undefined, 'junk', '2026-11-07')).toBe('2026-11-03');
    expect(startDay('2026-11-10', 42, '')).toBe('2026-11-10');
    expect(asDay('2026-1-1')).toBeUndefined();
  });
  it('a buddy counts from the day it joined, never before the start', () => {
    expect(countsFrom('2026-11-20', '2026-11-03')).toBe('2026-11-20');
    expect(countsFrom('2026-10-01', '2026-11-03')).toBe('2026-11-03');
  });
});

describe('stats', () => {
  it('reads the same sessions, goal weeks, PRs and Moved-up steps as achievements', () => {
    const log = lifter(14), c: Context = { profile, today: TODAY, since: day(10) };
    const f = familySteps(log, c), b = buddySteps(log, c);
    for (const k of ['sessions', 'goal-weeks', 'prs', 'moved-up'] as const) expect(b[k]).toEqual(f[k]);
    expect(b.prs.length).toBeGreaterThan(0);
    expect(b['moved-up'].length).toBeGreaterThan(0);
  });
  it('each stat grows from its own source, at its own rate', () => {
    const log = lifter(6), t = train(log), s = statsOf(plain, MON, t), n = s.from;
    expect(n.sets).toBe(36);
    expect(n.sessions).toBe(12);
    expect(n.goalWeeks).toBe(6);
    expect(n.cardioMin).toBe(180);
    expect(s.xp).toEqual({ power: 10 * (XP.pr * n.prs + XP.step * n.steps), size: 360, grit: TRAIT_TENTHS[0] * (12 * 10 + 6 * 20), stamina: 10 * 60 }); // grit is this one's trait
    expect(s.level.size).toBe(Math.floor(Math.sqrt(36 / 3)));
  });
  it('the trait earns ×1.1 common to ×1.5 legendary, on that stat only', () => {
    const t = train(lifter(4));
    const base = statsOf({ trait: 'stamina', rarity: 0 }, MON, t).xp;
    for (const r of [0, 1, 2, 3, 4] as const) {
      const x = statsOf({ trait: 'size', rarity: r }, MON, t).xp;
      expect(x.size).toBe(base.size / 10 * TRAIT_TENTHS[r]);
      expect([x.power, x.grit]).toEqual([base.power, base.grit]);
      expect(x.stamina).toBe(base.stamina / TRAIT_TENTHS[0] * 10);
    }
  });
  it('levels are √(xp/3) per stat and √(total/12) overall, exact at the edges', () => {
    expect([statLevel(30 * 9 - 1), statLevel(30 * 9), lvOf(120 * 16 - 1), lvOf(120 * 16)]).toEqual([2, 3, 3, 4]);
  });
  it('no catch-up: a buddy that joined later stays behind; and only training from the start counts', () => {
    const t = train(lifter(10));
    const early = statsOf(plain, MON, t), late = statsOf(plain, day(35), t), before = statsOf(plain, '2025-01-01', t);
    expect(late.lv).toBeLessThan(early.lv);
    expect(late.from.sets).toBe(early.from.sets - 5 * 6);
    expect(before).toEqual(early);
    expect(statsOf(plain, MON, train(lifter(10), day(35))).from.sets).toBe(late.from.sets);
  });
  it('nothing goes down with time: another day of training never lowers a stat', () => {
    const log = lifter(8);
    let prev = statsOf(plain, MON, train(log.filter((e) => e.date <= day(0))));
    for (let d = 1; d < 56; d++) {
      const s = statsOf(plain, MON, train(log.filter((e) => e.date <= day(d))));
      for (const k of ['power', 'size', 'grit', 'stamina'] as const) expect(s.xp[k]).toBeGreaterThanOrEqual(prev.xp[k]);
      prev = s;
    }
  });
  it('a pain-flagged set feeds Size and Grit like any other, and never Power', () => {
    const clean = [set(day(0), 'Curl', 30, 10), set(day(7), 'Curl', 30, 10), set(day(14), 'Curl', 40, 10)];
    const pain = clean.map((e, i) => (i === 2 ? { ...e, flags: ['pain' as Flag] } : e));
    const a = statsOf(plain, MON, train(clean)), b = statsOf(plain, MON, train(pain));
    expect([b.xp.size, b.xp.grit]).toEqual([a.xp.size, a.xp.grit]);
    expect(b.xp.power).toBeLessThan(a.xp.power);
  });
  it('warm-ups don’t feed Size; best stat names the biggest, the trait winning a tie', () => {
    const t = train([set(day(0), 'Curl', 30, 10, ['warmup']), set(day(0), 'Curl', 30, 10)]);
    expect(statsOf(plain, MON, t).from.sets).toBe(1);
    const s = statsOf(plain, MON, train([]));
    expect(bestStat(s, 'stamina')).toBe('stamina');
    expect(bestStat(statsOf(plain, MON, train(lifter(3))), 'stamina')).toBe('grit');
  });
});

describe('rewards and points', () => {
  it('every gold and platinum in DEFS has its tickets, and nothing else does', () => {
    const want = DEFS.flatMap((d) => d.levels.filter((l) => l.tier === 'gold' || l.tier === 'platinum').map((l) => `${d.id}:${l.tier}`));
    expect(Object.keys(TICKETS).sort()).toEqual([...new Set(want)].sort());
    expect(Object.values(TICKETS).every((n) => [1, 2, 3, 5, 8].includes(n))).toBe(true);
  });
  it('starter, bronze and silver give points; gold and platinum tickets only', () => {
    expect(rewardOf('sessions', 'bronze')).toEqual({ points: POINTS.bronze, tickets: 0 });
    expect(rewardOf('best-run', 'platinum')).toEqual({ points: 0, tickets: 8 });
  });
  it('only unlocks from the start pay; repeats pay each time', () => {
    const a: Achievements = {
      unlocks: [
        { id: 'sessions', level: 0, tier: 'starter', date: '2026-10-01', value: 1 },
        { id: 'sessions', level: 1, tier: 'bronze', date: '2026-11-02', value: 10 },
        { id: 'prs', level: 3, tier: 'gold', date: '2026-11-04', value: 250 },
        { id: 'comeback', level: 0, tier: 'bronze', date: '2026-10-05', value: 1 },
      ],
      tracks: [], counts: { comeback: 3 }, hidden: [], repeats: { comeback: ['2026-10-05', '2026-11-10', '2026-12-01'], 'every-muscle': ['2026-11-20'] },
    };
    expect(awards(a, '2026-11-01')).toEqual({ points: POINTS.bronze! + 2 * POINTS.bronze!, tickets: TICKETS['prs:gold'] + TICKETS['every-muscle:gold'] });
    expect(DEF.get('comeback')!.repeat).toBe(true);
  });
  it('points: 1 a set, 1 per 3 cardio minutes, 5 a session, 20 a goal week, plus awards', () => {
    const log = lifter(3), t = train(log), ach = achievements(log, { profile, today: TODAY, since: MON });
    const e = earned(t, ach);
    expect(e.parts).toEqual({ sets: 18, cardio: 30, sessions: 30, goalWeeks: 60, awards: awards(ach, MON).points });
    expect(e.parts.awards).toBeGreaterThan(0);
    expect(e.points).toBe(18 + 30 + 30 + 60 + e.parts.awards);
    expect(INCOME.goalWeek).toBe(20);
    expect(earned(train(log, day(100)), ach).points).toBe(0); // history pays nothing
  });
});

describe('roster', () => {
  it('ids are unique across buddies and accessories, every rarity has some of each, and the credits name both artists', () => {
    const ids = [...BUDDIES.map((b) => b.id), ...ACCESSORIES.map((a) => a.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RARITIES.keys()) {
      expect(BUDDIES.some((b) => b.rarity === r)).toBe(true);
      expect(ACCESSORIES.some((a) => a.rarity === r)).toBe(true);
    }
    expect(BUDDIES.filter((b) => b.rarity === 0).length).toBeGreaterThan(BUDDIES.filter((b) => b.rarity === 4).length);
    expect(BUDDIES.some((b) => b.poses.length > 1)).toBe(true);
    expect(CREDITS).toMatch(/Clint Bellanger/);
    expect(CREDITS).toMatch(/Kenney/);
  });
});
