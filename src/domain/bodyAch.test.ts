import { describe, expect, it } from 'vitest';
import { addDays } from './analytics';
import { achievements, achievementsOf, DEFS, familySteps, unlockText, type BodyCtx, type Context } from './achievements';
import type { BodyDay } from './body';
import { SHOTS, type PhotoMeta } from './photos';
import { defaultProfile } from './profile';

// Your body (progress-photos plan S4, owner 2026-10-29): Weigh-ins, Steady weeks, Photo days, Photo season, Flexed and relaxed.
// Synthetic weigh-ins and photo dates only.

const MON = '2026-01-05';
const day = (n: number) => addDays(MON, n);
const ctx = (body?: BodyCtx, over: Partial<Context> = {}): Context =>
  ({ profile: { ...defaultProfile(), weeklyGoal: 2 }, today: '2026-12-31', since: '2000-01-01', ...(body && { body }), ...over });
const steps = (b: BodyCtx, over: Partial<Context> = {}) => familySteps([], ctx(b, over));
/** A weigh-in each of `n` days from `from`, `lb(i)` on the i-th. */
const weighs = (from: number, n: number, lb: (i: number) => number): BodyDay[] => Array.from({ length: n }, (_, i) => ({ date: day(from + i), weight: lb(i) }));
type Ph = Pick<PhotoMeta, 'date' | 'pose' | 'variant'>;
const relaxed = (d: string): Ph[] => (['front', 'side', 'back'] as const).map((pose) => ({ date: d, pose, variant: 'relaxed' }));
const all6 = (d: string): Ph[] => SHOTS.map((s) => ({ date: d, ...s }));

describe('weigh-ins', () => {
  it('days with a weight, from the start day on: a day of calories only doesn’t count', () => {
    const b: BodyCtx = { days: [{ date: day(0), weight: 180 }, { date: day(1), calories: 2400 }, ...weighs(2, 9, () => 180)], photos: [] };
    expect(steps(b)['weigh-ins'].at(-1)!.value).toBe(10);
    const a = achievements([], ctx(b));
    expect(a.unlocks.filter((u) => u.id === 'weigh-ins').map((u) => [u.tier, u.date])).toEqual([['starter', day(0)], ['bronze', day(10)]]);
    expect(steps(b, { since: day(5) })['weigh-ins'].at(-1)!.value).toBe(6);
    expect(unlockText(a.unlocks.find((u) => u.id === 'weigh-ins')!)).toBe('Your first weigh-in');
  });
});

describe('steady weeks', () => {
  it('a week over, 3 weigh-ins or more, the rate never fast: counted at its last weigh-in once the week is over', () => {
    const b: BodyCtx = { days: weighs(0, 42, (i) => 180 - i * 0.03), photos: [] }; // six weeks, a slow cut
    const s = steps(b, { today: day(42) });
    // The rate reads from two weeks in: weeks 3 to 6 (each one's Sunday its last weigh-in).
    expect(s['steady-weeks'].map((x) => x.date)).toEqual([day(20), day(27), day(34), day(41)]);
    // The week still going doesn't count yet.
    expect(steps(b, { today: day(41) })['steady-weeks'].map((x) => x.date)).toEqual([day(20), day(27), day(34)]);
  });
  it('a fast cut never counts; nor does a week of two weigh-ins', () => {
    expect(steps({ days: weighs(0, 42, (i) => 200 - i * 0.5), photos: [] }, { today: day(60) })['steady-weeks']).toEqual([]);
    const sparse = weighs(0, 42, () => 180).filter((d) => !(d.date >= day(21) && d.date <= day(27) && d.date > day(22)));
    expect(steps({ days: sparse, photos: [] }, { today: day(60) })['steady-weeks'].map((x) => x.date)).not.toContain(day(22));
  });
});

describe('photo days, season, flexed and relaxed', () => {
  it('a full set is front, side and back, either variant; two poses are not', () => {
    const photos: Ph[] = [...relaxed(day(0)), { date: day(7), pose: 'front', variant: 'relaxed' }, { date: day(7), pose: 'side', variant: 'flexed' },
      { date: day(14), pose: 'front', variant: 'flexed' }, { date: day(14), pose: 'side', variant: 'flexed' }, { date: day(14), pose: 'back', variant: 'flexed' }];
    expect(steps({ days: [], photos })['photo-days'].map((x) => x.date)).toEqual([day(0), day(14)]);
    expect(steps({ days: [], photos })['flexed-relaxed']).toEqual([]);
  });
  it('season: whole weeks from the first photo day; 4 weeks is bronze', () => {
    const photos = [...relaxed(day(0)), ...relaxed(day(13)), ...relaxed(day(28))];
    expect(steps({ days: [], photos })['photo-season']).toEqual([{ date: day(13), value: 1 }, { date: day(28), value: 4 }]);
    expect(achievements([], ctx({ days: [], photos })).unlocks.filter((u) => u.id === 'photo-season').map((u) => u.tier)).toEqual(['bronze']);
  });
  it('flexed and relaxed: every day with all six, again and again', () => {
    const a = achievements([], ctx({ days: [], photos: [...all6(day(0)), ...relaxed(day(7)), ...all6(day(14))] }));
    expect(a.counts['flexed-relaxed']).toBe(2);
    expect(a.repeats['flexed-relaxed']).toEqual([day(0), day(14)]);
  });
});

describe('shown only with your own weigh-ins and photos', () => {
  const body = DEFS.filter((d) => d.group === 'body').map((d) => d.id);
  it('no body context (a friend’s log, the recap, the summary): every family hidden, none earned', () => {
    const a = achievements([], ctx());
    expect(body.every((id) => a.hidden.includes(id))).toBe(true);
    expect(a.unlocks.filter((u) => body.includes(u.id))).toEqual([]);
  });
  it('yours, even before the first weigh-in: shown, locked', () => {
    expect(achievements([], ctx({ days: [], photos: [] })).hidden.filter((id) => body.includes(id))).toEqual([]);
  });
  it('no goal weight family (owner 2026-10-29)', () => {
    expect(body.sort()).toEqual(['flexed-relaxed', 'photo-days', 'photo-season', 'steady-weeks', 'weigh-ins']);
  });
  it('a new weigh-in is a new answer, the same one isn’t', () => {
    const log: never[] = [], b: BodyCtx = { days: [{ date: day(0), weight: 180 }], photos: [] }, c = ctx(b);
    const a = achievementsOf(log, c);
    expect(achievementsOf(log, c)).toBe(a);
    expect(achievementsOf(log, ctx({ ...b, days: [...b.days, { date: day(1), weight: 181 }] }, { profile: c.profile }))).not.toBe(a);
  });
});
