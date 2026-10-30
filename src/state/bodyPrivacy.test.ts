import { describe, expect, it } from 'vitest';
import { fakeFirestore } from '../cloud/fakeFirestore';
import { addDays } from '../domain/analytics';
import { achievements, DEFS, featured, shareOf, unlocksOf, withoutPrivate, type BodyCtx, type SharedAch } from '../domain/achievements';
import { starter } from '../domain/buddies/gacha';
import { earned } from '../domain/buddies/points';
import { awards } from '../domain/buddies/rewards';
import { BUDDIES } from '../domain/buddies/roster';
import { budOf } from '../domain/buddies/share';
import { trainingOf } from '../domain/buddies/stats';
import { SHOTS } from '../domain/photos';
import { defaultProfile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { publishSummary, type PublishSource } from './publishSummary';

// Your body never reaches anything shared (owner 2026-10-29: private like Together): not your Compare summary (its achievements
// or the points your buddies show), not a friend's feed chips or page, whatever the switches say. Synthetic data only.

const MON = '2026-01-05', TODAY = '2026-12-31';
const day = (n: number) => addDays(MON, n);
const BODY = DEFS.filter((d) => d.group === 'body').map((d) => d.id);
const set = (date: string, n: number): SetEntry => ({ id: `t|${date}|bench|${n}`, date, seq: n, exercise: 'Bench Press', setNo: 1, weight: 135, reps: 5, flags: [], source: 't' });
const log = Array.from({ length: 30 }, (_, i) => set(day(i * 3), i));
/** Every Your body family earned to its top: a year of daily weigh-ins, slow and steady, and six photos every week. */
const body: BodyCtx = {
  days: Array.from({ length: 365 }, (_, i) => ({ date: day(i), weight: 180 - i * 0.01 })),
  photos: Array.from({ length: 53 }, (_, w) => SHOTS.map((s) => ({ date: day(w * 7), ...s }))).flat(),
};
const profile = { ...defaultProfile(), weeklyGoal: 2 };
const mine = achievements(log, { profile, today: TODAY, since: MON, body });

describe('Your body never leaves the phone', () => {
  it('the log here earns every body family (so the checks below can fail)', () => {
    for (const id of BODY) expect(mine.unlocks.some((u) => u.id === id)).toBe(true);
    expect(awards(mine, MON).points).toBeGreaterThan(awards(withoutPrivate(mine), MON).points);
  });
  it('your summary’s achievements: none of them, with every group switched on', () => {
    const shared = shareOf(mine, []);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.filter((x) => BODY.includes(x.i))).toEqual([]);
  });
  it('a friend’s summary that carries them anyway (an old or forged app): dropped before their page or feed chips', () => {
    const forged: SharedAch[] = [...BODY.map((i) => ({ i, l: 0, d: day(10) })), { i: 'sessions', l: 0, d: day(0) }];
    expect(unlocksOf(forged).map((u) => u.id)).toEqual(['sessions']);
    expect(featured(unlocksOf(forged.map((x) => ({ ...x, l: x.i === 'flexed-relaxed' ? 0 : 2 })))).map((u) => u.id)).toEqual(['sessions']);
  });
  it('the points your buddies show friends leave out what Your body paid', () => {
    const t = trainingOf(log, { start: MON, today: TODAY, profile });
    const kept = { start: MON, prefs: {}, spends: [starter(BUDDIES[0].id, 1, MON)] };
    expect(budOf(kept, t, mine)!.pts).toBe(earned(t, withoutPrivate(mine)).points);
    expect(budOf(kept, t, mine)!.pts).toBeLessThan(earned(t, mine).points);
  });
  it('the summary written to the cloud reads no weigh-in or photo, and says nothing of them', async () => {
    const read: string[] = [];
    const src = {
      getSyncSnapshot: async () => ({ sets: log, tombstones: new Set<string>() }), getProfile: async () => profile,
      getAchStart: async () => MON, getProgram: async () => undefined, getDayPlans: async () => [],
      getBuddyStart: async () => MON, getBuddyPrefs: async () => ({}), getBuddyLead: async () => undefined, getSpends: async () => [starter(BUDDIES[0].id, 1, MON)],
      // A phone has these: the summary must never ask for them.
      getBody: async () => body.days, getPhotoMetas: async () => body.photos,
    };
    const spy = new Proxy(src, { get: (o, k: string) => { read.push(k); return o[k as keyof typeof o]; } }) as PublishSource;
    const w = fakeFirestore();
    expect(await publishSummary(w.cloud, 'u1', spy, Date.parse(`${TODAY}T18:00:00`))).toBe(true);
    expect(read).not.toContain('getBody');
    expect(read).not.toContain('getPhotoMetas');
    const doc = JSON.stringify(w.docs['users/u1/summary/compare']);
    for (const id of BODY) expect(doc).not.toContain(`"${id}"`);
    expect(doc).not.toMatch(/weigh|photo|"179\.|"180/);
  });
});
