import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { addDays } from './analytics';
import { lingering, painGate, painToday, persistentPain, SETTLE_DAYS } from './painPlan';
import { nextTarget } from './progression';
import { painRisk } from './learn/pain';
import { painLog } from './learn/painSim.sample';

// Synthetic logs only. Item 08's rules on top of the pain-monitoring zones (a) and the learned pain risk (b).
let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `p${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags: [], source: 't', ...over,
});
const sess = (date: string, exercise: string, w: number, reps: number[], over: Partial<SetEntry> = {}) =>
  reps.map((r, i) => s(date, exercise, w, r, { setNo: i + 1, ...(i === reps.length - 1 ? over : {}) }));
const pain = (sev?: 1 | 2 | 3, region?: SetEntry['painRegion']): Partial<SetEntry> => ({ flags: ['pain'], ...(sev && { painSeverity: sev }), ...(region && { painRegion: region }) });
const PD = 'Cable Pushdown';
const ST = { key: 'cable pushdown', repMin: 10, repMax: 15, increment: 5 };

describe('painGate: what last time’s pain allows today (item 08, a)', () => {
  it('moderate holds, an unknown severity holds, sharp eases; mild and none progress', () => {
    const at = (over: Partial<SetEntry>) => painGate(sess('2026-09-01', PD, 110, [15, 15, 15], over), PD, '2026-09-04');
    expect(at(pain(2))).toMatchObject({ kind: 'hold', zone: 2, spill: false, unknown: false });
    expect(at(pain())).toMatchObject({ kind: 'hold', zone: 2, unknown: true });
    expect(at(pain(3))).toMatchObject({ kind: 'ease', zone: 3 });
    expect(at(pain(1))).toBeNull();
    expect(at({})).toBeNull();
  });
  it('only last time counts: a pain-free session since lets progression resume', () => {
    const e = [...sess('2026-09-01', PD, 110, [15, 15, 15], pain(3)), ...sess('2026-09-04', PD, 105, [15, 15, 15])];
    expect(painGate(e, PD, '2026-09-08')).toBeNull();
  });
  it('a warm-up that hurt counts: pain from the very first set', () => {
    const e = [s('2026-09-01', PD, 50, 10, { flags: ['warmup', 'pain'], painSeverity: 2 }), ...sess('2026-09-01', PD, 110, [15, 15, 15])];
    expect(painGate(e, PD, '2026-09-04')).toMatchObject({ kind: 'hold' });
  });
  it(`spills over for ${SETTLE_DAYS} days to lifts that load the region that hurt (moderate or worse), today’s earlier lifts too`, () => {
    const oh = 'Overhead DB Triceps Extension';
    const hurt = (date: string, sev: 1 | 2 | 3 = 2) => [...sess(date, oh, 40, [12, 12], pain(sev, 'elbow')), ...sess('2026-08-20', PD, 110, [15, 15, 15])];
    expect(painGate(hurt('2026-09-01'), PD, '2026-09-04')).toMatchObject({ kind: 'hold', spill: true, from: oh, region: 'elbow' });
    expect(painGate(hurt('2026-08-31'), PD, '2026-09-04')).toBeNull(); // 4 days: settled
    expect(painGate(hurt('2026-09-04'), PD, '2026-09-04')).toMatchObject({ kind: 'hold', spill: true }); // earlier today
    expect(painGate(hurt('2026-09-01', 1), PD, '2026-09-04')).toBeNull(); // mild: acceptable
    expect(painGate(hurt('2026-09-01', 3), PD, '2026-09-04')).toMatchObject({ kind: 'hold' }); // another lift's sharp holds, never eases
    expect(painGate(hurt('2026-09-01'), 'Leg Extension', '2026-09-04')).toBeNull(); // a knee lift
    // The region named on the set wins over the lift's: an elbow hurt on the bench holds a pushdown.
    const bench = [...sess('2026-09-03', 'Bench Press', 135, [8, 8], pain(2, 'elbow')), ...sess('2026-08-20', PD, 110, [15, 15, 15])];
    expect(painGate(bench, PD, '2026-09-04')).toMatchObject({ kind: 'hold', from: 'Bench Press' });
  });
});

describe('nextTarget with the pain gate', () => {
  const topped = (over: Partial<SetEntry>) => sess('2026-09-01', PD, 110, [15, 15, 15], over);
  it('a topped session that hurt moderately repeats; the same session without pain goes up', () => {
    expect(nextTarget(topped({}), PD, ST, '2026-09-04')).toMatchObject({ kind: 'increase', weight: 115 });
    const t = nextTarget(topped(pain(2)), PD, ST, '2026-09-04')!;
    expect(t).toMatchObject({ kind: 'hold', weight: 110, perSet: [15, 15, 15] });
    expect(t.pain).toMatchObject({ kind: 'hold', zone: 2 });
  });
  it('a sharp session eases one step: the lift’s own step (5 lb, or a typed 2.5), the same reps', () => {
    const t = nextTarget(topped(pain(3)), PD, ST, '2026-09-04')!;
    expect(t).toMatchObject({ kind: 'ease', weight: 105, perSet: [15, 15, 15] });
    expect(nextTarget(topped(pain(3)), PD, { ...ST, increment: 2.5 }, '2026-09-04')).toMatchObject({ kind: 'ease', weight: 107.5 });
    // Not topped: still a hold or ease, never a rep added.
    const short = sess('2026-09-01', PD, 110, [12, 11, 10], pain(2));
    expect(nextTarget(short, PD, ST, '2026-09-04')).toMatchObject({ kind: 'hold', weight: 110, perSet: [12, 11, 10] });
  });
  it('sharp again eases again; then pain-free, double progression resumes from the eased weight', () => {
    const e = [...topped(pain(3)), ...sess('2026-09-04', PD, 105, [15, 15, 15], pain(3))];
    expect(nextTarget(e, PD, ST, '2026-09-08')).toMatchObject({ kind: 'ease', weight: 100 });
    const back = [...e, ...sess('2026-09-08', PD, 100, [15, 15, 15])];
    expect(nextTarget(back, PD, ST, '2026-09-11')).toMatchObject({ kind: 'increase', weight: 105 });
  });
  it('a bodyweight lift that hurt sharply holds (it has no load to take off; item 14)', () => {
    const e = sess('2026-09-01', 'Pull-up', 0, [10, 10, 10], pain(3));
    expect(nextTarget(e, 'Pull-up', { key: 'pull-up', repMin: 8, repMax: 12, increment: 5 }, '2026-09-04')).toMatchObject({ kind: 'hold', weight: 0 });
  });
});

describe('painToday: in the session (a: above 5/10 is past the acceptable zone)', () => {
  it('the worst pain on this lift today, with its region', () => {
    const e = [...sess('2026-09-04', PD, 110, [15, 15], pain(2, 'elbow')), ...sess('2026-09-04', PD, 110, [12], pain(3, 'elbow'))];
    expect(painToday(e, PD, '2026-09-04')).toEqual({ zone: 3, region: 'elbow' });
    expect(painToday(e, PD, '2026-09-05')).toBeNull();
    expect(painToday(sess('2026-09-04', PD, 110, [15]), PD, '2026-09-04')).toBeNull();
  });
});

describe('persistentPain: likelier than not to hurt next time (b)', () => {
  it('a lift that hurt in each of its sessions lately, yes, with how many of its last ones did; a lone old pain, no', () => {
    const { entries } = painLog(3, { sessions: 150, truth: { base: 0.03, own: 0.6, region: 0.2, h: 28 } });
    const last = entries.reduce((a, e) => (e.date > a ? e.date : a), '');
    const SK = 'Skullcrusher';
    const run = [0, 3, 6, 9].flatMap((k) => sess(addDays(last, k), SK, 40, [10, 10], pain(2)));
    const day = addDays(last, 12);
    expect(painRisk([...entries, ...run], SK, day).p).toBeGreaterThan(0.5);
    expect(persistentPain([...entries, ...run], SK, day)).toMatchObject({ hurt: 4, of: 4 });
    // One of them only: below ½ (though worse than its family: rotation would skip it, nothing more).
    expect(persistentPain([...entries, ...run.slice(0, 2)], SK, day)).toBeNull();
    const lone = sess(addDays(last, -300), SK, 40, [10, 10], pain(2));
    expect(persistentPain([...entries, ...lone], SK, day)).toBeNull();
  });
});

describe('lingering: a region that has hurt on and off for 2 weeks or more (a: NHS, see a GP after 2 weeks of self-care)', () => {
  const el = (date: string) => sess(date, PD, 110, [15], pain(2, 'elbow'));
  it('two weeks of pain with no two-week break, the latest within two weeks', () => {
    const e = [...el('2026-09-01'), ...el('2026-09-10'), ...el('2026-09-20')];
    expect(lingering(e, '2026-09-25')).toEqual([{ region: 'elbow', since: '2026-09-01', weeks: 3 }]);
    expect(lingering(e, '2026-10-05')).toEqual([]); // the latest is over two weeks old
    expect(lingering([...el('2026-09-01'), ...el('2026-09-10')], '2026-09-12')).toEqual([]); // 9 days: not two weeks yet
    expect(lingering([...el('2026-08-01'), ...el('2026-09-01'), ...el('2026-09-10')], '2026-09-12')).toEqual([]); // a 31-day break: new episode
  });
});
