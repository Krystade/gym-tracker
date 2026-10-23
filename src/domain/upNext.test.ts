import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { onLift, PLAN_DONE, upNext } from './upNext';

// What the rest bar and the lock-screen alert say comes after a set. Owner, 2026-10-20: the last of 4 planned Cable Pushdown
// sets said "set 5 next".
const D = '2026-10-20';
let seq = 0;
const set = (exercise: string, flags: SetEntry['flags'] = [], date = D): SetEntry => ({
  id: `t|${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 120, reps: flags.includes('partial') ? null : 10, flags, source: 't',
});
const sets = (exercise: string, n: number) => Array.from({ length: n }, () => set(exercise));
const plan = (counts: Record<string, number>) => (ex: string) => counts[ex] ?? null;

describe('upNext', () => {
  it('names the next set of the lift while its plan has sets left', () => {
    const entries = sets('Cable Pushdown', 3);
    expect(upNext({ exercise: 'Cable Pushdown', entries, date: D, planned: plan({ 'Cable Pushdown': 4 }), left: ['Cable Pushdown', 'Machine Chest Press'] }))
      .toBe('Cable Pushdown · set 4 next');
  });

  it('after the last planned set, the next planned lift, never a set past the plan', () => {
    const entries = sets('Cable Pushdown', 4);
    const label = upNext({ exercise: 'Cable Pushdown', entries, date: D, planned: plan({ 'Cable Pushdown': 4, 'Machine Chest Press': 3 }), left: ['Cable Pushdown', 'Machine Chest Press'] });
    expect(label).toBe('Next: Machine Chest Press');
    expect(label).not.toMatch(/set 5/);
  });

  it('skips planned lifts already finished, in the plan’s order', () => {
    const entries = [...sets('Lat Pulldown', 3), ...sets('Cable Pushdown', 4)];
    // `left` is the plan as it stood before this set: Lat Pulldown was done, then left out; Leg Press after it.
    expect(upNext({ exercise: 'Cable Pushdown', entries, date: D, planned: plan({ 'Cable Pushdown': 4, 'Lat Pulldown': 3, 'Leg Press': 3 }), left: ['Lat Pulldown', 'Cable Pushdown', 'Leg Press'] }))
      .toBe('Next: Leg Press');
  });

  it('the plan finished: says so, with no set and no lift', () => {
    const entries = sets('Cable Pushdown', 4);
    expect(upNext({ exercise: 'Cable Pushdown', entries, date: D, planned: plan({ 'Cable Pushdown': 4 }), left: ['Cable Pushdown'] })).toBe(PLAN_DONE);
  });

  it('a set past the plan (done by choice) still never names a further set', () => {
    const entries = sets('Cable Pushdown', 5);
    expect(upNext({ exercise: 'Cable Pushdown', entries, date: D, planned: plan({ 'Cable Pushdown': 4 }), left: [] })).toBe(PLAN_DONE);
  });

  it('a lift with no planned count counts on, plan or none', () => {
    const entries = sets('Hammer Curl', 6);
    expect(upNext({ exercise: 'Hammer Curl', entries, date: D, planned: () => null, left: [] })).toBe('Hammer Curl · set 7 next');
    expect(upNext({ exercise: 'Hammer Curl', entries, date: D, planned: plan({ 'Leg Press': 3 }), left: ['Leg Press'] })).toBe('Hammer Curl · set 7 next');
  });

  it('counts working sets only: warm-ups, partials and other days don’t move the count', () => {
    const entries = [set('Cable Pushdown', ['warmup']), set('Cable Pushdown', ['partial']), set('Cable Pushdown', [], '2026-10-19'), ...sets('Cable Pushdown', 2)];
    expect(upNext({ exercise: 'Cable Pushdown', entries, date: D, planned: plan({ 'Cable Pushdown': 4 }), left: ['Cable Pushdown'] })).toBe('Cable Pushdown · set 3 next');
  });

  it('a superset’s round ended: the round starts again on its first lift with sets left', () => {
    const entries = [...sets('Cable Curl', 2), ...sets('Cable Pushdown', 2)];
    const o = { entries, date: D, planned: plan({ 'Cable Curl': 4, 'Cable Pushdown': 4, 'Face Pull': 3 }), left: ['Cable Curl', 'Cable Pushdown', 'Face Pull'], round: ['Cable Curl', 'Cable Pushdown'] };
    expect(upNext({ ...o, exercise: 'Cable Pushdown' })).toBe('Cable Curl · set 3 next');
  });

  it('a superset whose first lift is done goes on with the other; both done, the plan’s next lift', () => {
    const planned = plan({ 'Cable Curl': 3, 'Cable Pushdown': 4, 'Face Pull': 3 });
    const left = ['Cable Curl', 'Cable Pushdown', 'Face Pull'], round = ['Cable Curl', 'Cable Pushdown'];
    const three = [...sets('Cable Curl', 3), ...sets('Cable Pushdown', 3)];
    expect(upNext({ exercise: 'Cable Pushdown', entries: three, date: D, planned, left, round })).toBe('Cable Pushdown · set 4 next');
    const all = [...three, set('Cable Pushdown')];
    expect(upNext({ exercise: 'Cable Pushdown', entries: all, date: D, planned, left, round })).toBe('Next: Face Pull');
  });
});

// Owner, 2026-10-22: leg raises and curls taken in turns; the leg raises' last set said "Next Cable Pushdown", the plan's next,
// while he was halfway through his curls.
describe('the lift he is on', () => {
  const at = (exercise: string, hm: string): SetEntry => ({ ...set(exercise), loggedAt: new Date(`${D}T${hm}:00`).toISOString() });
  const day = [at('Supported Leg Raise', '19:32'), at('DB Curl', '19:37'), at('Supported Leg Raise', '19:39'), at('DB Curl', '19:40'), at('Supported Leg Raise', '19:51')];
  const planned = plan({ 'Supported Leg Raise': 3, 'Cable Pushdown': 4, 'DB Curl': 3 });
  const lifts = ['Supported Leg Raise', 'DB Curl'];
  const none = () => undefined;

  it('a lift done: the other lift he has going, not the plan’s next', () => {
    const on = onLift({ exercise: 'Supported Leg Raise', entries: day, date: D, planned, lifts, touched: none });
    expect(on).toBe('DB Curl');
    expect(upNext({ exercise: 'Supported Leg Raise', entries: day, date: D, planned, left: ['Supported Leg Raise', 'Cable Pushdown', 'DB Curl'], on }))
      .toBe('DB Curl · set 3 next');
  });

  it('a card tapped since this lift started counts, sets or none; one finished, or last touched before, doesn’t', () => {
    const t = (hm: string) => new Date(`${D}T${hm}:00`).getTime();
    const curlsDone = [...day, at('DB Curl', '19:45')];
    expect(onLift({ exercise: 'Supported Leg Raise', entries: curlsDone, date: D, planned, lifts, touched: none })).toBeUndefined();
    expect(onLift({ exercise: 'Supported Leg Raise', entries: curlsDone, date: D, planned, lifts: [...lifts, 'Lateral Raise'], touched: (l) => (l === 'Lateral Raise' ? t('19:50') : undefined) }))
      .toBe('Lateral Raise');
    expect(onLift({ exercise: 'Supported Leg Raise', entries: curlsDone, date: D, planned, lifts: [...lifts, 'Lateral Raise'], touched: (l) => (l === 'Lateral Raise' ? t('19:00') : undefined) }))
      .toBeUndefined();
  });

  it('nothing else going: the plan’s next, as before', () => {
    const alone = [at('Supported Leg Raise', '19:32'), at('Supported Leg Raise', '19:39'), at('Supported Leg Raise', '19:51')];
    const on = onLift({ exercise: 'Supported Leg Raise', entries: alone, date: D, planned, lifts, touched: none });
    expect(on).toBeUndefined();
    expect(upNext({ exercise: 'Supported Leg Raise', entries: alone, date: D, planned, left: ['Supported Leg Raise', 'Cable Pushdown', 'DB Curl'], on })).toBe('Next: Cable Pushdown');
  });

  it('his own next set still comes first while this lift has sets left', () => {
    const two = day.slice(0, 4);
    expect(upNext({ exercise: 'Supported Leg Raise', entries: two, date: D, planned, left: [], on: 'DB Curl' })).toBe('Supported Leg Raise · set 3 next');
  });
});
