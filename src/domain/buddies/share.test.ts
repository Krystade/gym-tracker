import { describe, expect, it } from 'vitest';
import { addDays } from '../analytics';
import { parseSummary, summarize } from '../compare';
import { defaultProfile } from '../profile';
import type { SetEntry } from '../types';
import { choose, starter, type Spend } from './gacha';
import { earned } from './points';
import { BUDDIES, ACCESSORIES } from './roster';
import { bestShared, budOf, leadOf, MAX_SHARED_BUDDIES, parseBud } from './share';
import { statsOf, trainingOf } from './stats';

// Synthetic sets only.
let seq = 0;
const set = (date: string, weight: number): SetEntry => ({ id: `t|${date}|${++seq}`, date, seq, exercise: 'Bench Press', setNo: seq, weight, reps: 8, flags: [], source: 'app' });
const MON = '2026-01-05', TODAY = '2026-03-01';
const log = Array.from({ length: 8 }, (_, w) => [2, 4].flatMap((d) => [set(addDays(MON, w * 7 + d), 135 + 5 * w), set(addDays(MON, w * 7 + d), 135 + 5 * w)])).flat();
const t = trainingOf(log, { start: MON, today: TODAY, profile: { ...defaultProfile(), weeklyGoal: 2 } });
const [b0, b1] = [BUDDIES.find((b) => b.rarity === 0)!, BUDDIES.find((b) => b.rarity === 3)!];
const held = ACCESSORIES.find((a) => a.slot === 'held')!, aura = ACCESSORIES.find((a) => a.slot === 'aura')!;
const spends: Spend[] = [starter(b0.id, 1, MON), choose('buddy', b1.id, 2, addDays(MON, 21)), choose('acc', held.id, 3, MON)];

describe('budOf: what friends see of your buddies', () => {
  it('none before the first pick', () => {
    expect(budOf({ start: MON, prefs: {}, spends: [] }, t, null)).toBeUndefined();
  });
  it('the lead first, its Lv and stat numbers as its card works them out, lifetime points earned (not the balance)', () => {
    const b = budOf({ start: MON, prefs: {}, lead: { id: b1.id, at: 5 }, spends }, t, null)!;
    expect(b.lead).toBe(b1.id);
    expect(b.r.map((x) => x.i)).toEqual([b1.id, b0.id]);
    const st = statsOf(b1, addDays(MON, 21), t);
    expect(b.r[0]).toMatchObject({ l: st.lv, s: [st.level.power, st.level.size, st.level.grit, st.level.stamina] });
    expect(b.pts).toBe(earned(t, null).points);
    expect(b.pts).toBeGreaterThan(0); // the choose spent points: friends still see every point earned
  });
  it('only what is owned is shown worn, in its own slot', () => {
    const prefs = { [b0.id]: { at: 1, equip: { held: held.id, aura: aura.id } } };
    const b = budOf({ start: MON, prefs, spends }, t, null)!;
    expect(b.lead).toBe(b0.id); // no lead kept: the first to join
    expect(b.r[0].e).toEqual([held.id, null, null, null]); // the aura was never pulled
  });
  it('rides the summary and back through parseSummary', () => {
    const bud = budOf({ start: MON, prefs: {}, spends }, t, null)!;
    const s = summarize(log, TODAY, 2, undefined, bud);
    expect(parseSummary(JSON.parse(JSON.stringify(s)))!.bud).toEqual(bud);
    expect(parseSummary(summarize(log, TODAY, 2))!).not.toHaveProperty('bud');
  });
});

describe('parseBud: a friend’s, read as untrusted', () => {
  const good = { lead: b0.id, pts: 40, r: [{ i: b0.id, l: 3, s: [1, 2, 3, 0], e: [held.id, null, null, null] }] };
  it('keeps a good one, drops what is off', () => {
    expect(parseBud(good)).toEqual(good);
    for (const bad of [null, [], { ...good, pts: -1 }, { ...good, pts: 1.5 }, { ...good, lead: 'nope' }, { ...good, r: 'x' }, { ...good, lead: 7 }]) expect(parseBud(bad)).toBeUndefined();
  });
  it('drops an unknown buddy, a duplicate or one off shape; an accessory in the wrong slot shows as none', () => {
    const r = [good.r[0], { i: 'zz-unknown', l: 1, s: [0, 0, 0, 0], e: [] }, good.r[0], { i: b1.id, l: 1, s: [0, 0, 0] }, { i: b1.id, l: 2, s: [0, 0, 0, 0], e: [aura.id, 'x', 5] }];
    const p = parseBud({ ...good, r })!;
    expect(p.r.map((x) => x.i)).toEqual([b0.id, b1.id]);
    expect(p.r[1].e).toEqual([null, null, null, null]);
    expect(parseBud({ ...good, r: Array.from({ length: 50 }, (_, k) => ({ ...good.r[0], i: BUDDIES[k % BUDDIES.length].id })) })!.r.length).toBeLessThanOrEqual(MAX_SHARED_BUDDIES);
  });
  it('the lead must be one shared', () => {
    expect(parseBud({ ...good, lead: b1.id })).toBeUndefined();
    expect(leadOf(good).def.id).toBe(b0.id);
  });
});

describe('bestShared: Side by side names each one’s best, never a winner', () => {
  it('the highest number; a tie goes to the trait, then the order', () => {
    expect(bestShared([1, 5, 2, 0], 'grit')).toBe('size');
    expect(bestShared([4, 4, 4, 0], 'grit')).toBe('grit');
    expect(bestShared([4, 4, 0, 0], 'stamina')).toBe('power');
  });
});
