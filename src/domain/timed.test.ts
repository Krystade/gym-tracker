import { afterEach, describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { LIFTS, resolveLift, setTimedLifts, setWorksLike } from './lifts';
import { isHold, isTimedSet } from './care';
import { defaultSettings, nextTarget, resolveSettings } from './progression';
import { holdsByWeight, prKinds, prToast, records } from './records';
import { parseCsv, toCsv } from './csv';
import { fmtSet } from './format';

// Timed exercises (round 32): a `timed` flag on the lifts table, seconds logged in place of reps (the `hold` flag), 30–60 s by
// default, the longest hold at each weight, and a hold_s column in the CSV.

let seq = 0;
const h = (date: string, weight: number, secs: number | null, exercise = 'Plank', over: Partial<SetEntry> = {}): SetEntry => ({
  id: `h|${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps: secs, flags: weight ? ['hold'] : ['hold', 'bodyweight'], source: 't', ...over,
});
const reps = (date: string, weight: number, n: number, exercise: string): SetEntry =>
  ({ id: `r|${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps: n, flags: weight ? [] : ['bodyweight'], source: 't' });

const TIMED = ['Plank', 'Side Plank', 'RKC Plank', 'Hollow Hold', 'L-Sit', 'V-Sit Hold', 'Dead Bug', 'Ab Wheel Hold', 'Pallof Hold', 'Superman Hold',
  'Dead Hang', 'Active Hang', 'Flexed-Arm Hang', 'Farmer’s Hold', 'Plate Pinch Hold', 'Towel Hang', 'Wall Sit', 'Copenhagen Plank',
  'Single-Leg Glute Bridge Hold', 'Isometric Split Squat', 'Handstand Hold', 'Wall Handstand', 'Isometric Push-up Hold', 'Bird Dog', 'McGill Curl-Up'];

describe('the timed lifts', () => {
  afterEach(() => { setTimedLifts([]); setWorksLike([]); });
  it('are flagged in the table, each with muscles and gear', () => {
    for (const n of TIMED) {
      const l = resolveLift(n).lift;
      expect(l?.timed, n).toBe(true);
      expect(l?.m && Object.values(l.m).includes(1), `${n} trains a muscle directly`).toBe(true);
      expect(l?.needs, `${n} gear`).not.toBeNull();
      expect(isHold(n), n).toBe(true);
    }
    expect(LIFTS.filter((l) => l.timed).length).toBeGreaterThanOrEqual(28);
  });
  it('other names read as the hold: a weighted plank, a dead bug hold, a chin-over-bar hold', () => {
    for (const n of ['Weighted Plank', 'Dead Bug Hold', 'Chin-over-Bar Hold', 'Wall Squat']) expect(isHold(n), n).toBe(true);
  });
  it('rep lifts stay rep lifts, a "works like" a hold included', () => {
    for (const n of ['Bench Press', 'Pallof Press', 'Farmer’s Carry', 'Ab Wheel Rollout', 'Pull-up']) expect(isHold(n), n).toBe(false);
    setWorksLike([['My Core Thing', 'Plank']]);
    expect(isHold('My Core Thing')).toBe(false);
  });
  it('a custom lift can be marked timed', () => {
    expect(isHold('Bulgarian Bag Hold')).toBe(false);
    setTimedLifts(['bulgarian bag hold']);
    expect(isHold('Bulgarian Bag Hold')).toBe(true);
    expect(defaultSettings('Bulgarian Bag Hold')).toMatchObject({ repMin: 30, repMax: 60 });
  });
});

describe('a set is timed by its flag; an old set of a lift that became timed stays as logged', () => {
  it('reads the flag, and the holds the app always knew', () => {
    expect(isTimedSet(h('2026-10-01', 0, 30, 'Dead Hang'))).toBe(true);
    expect(isTimedSet(reps('2026-10-01', 0, 8, 'Dead Hang'))).toBe(false);
    expect(isTimedSet(reps('2026-10-01', 0, 40, 'Side Plank'))).toBe(true); // an import of a hold the app always timed
  });
  it('shows an old Dead Hang set as reps, a new one as seconds', () => {
    expect(fmtSet(reps('2026-10-01', 0, 8, 'Dead Hang'))).toBe('BW × 8');
    expect(fmtSet(h('2026-10-02', 0, 45, 'Dead Hang'))).toBe('BW × 45s');
  });
});

describe('targets for a timed lift', () => {
  it('default to 30–60 s, and a row saved with the old 20–40 default follows the new one', () => {
    expect(defaultSettings('Wall Sit')).toMatchObject({ repMin: 30, repMax: 60, increment: 5 });
    expect(resolveSettings({ key: 'plank', repMin: 20, repMax: 40, increment: 5, rest: 90 }, 'Plank', true, 'size')).toMatchObject({ repMin: 30, repMax: 60, rangeFrom: 'default' });
    expect(resolveSettings({ key: 'plank', repMin: 20, repMax: 40, increment: 5, ownRange: true }, 'Plank', true, 'size')).toMatchObject({ repMin: 20, repMax: 40, rangeFrom: 'own' });
  });
  it('add 5 s a set up to the top of the range', () => {
    const st = defaultSettings('Wall Sit');
    const t = nextTarget([h('2026-10-01', 0, 30, 'Wall Sit'), h('2026-10-01', 0, 30, 'Wall Sit', { setNo: 2 })], 'Wall Sit', st, '2026-10-03')!;
    expect(t).toMatchObject({ kind: 'reps', weight: 0, perSet: [35, 35] });
    expect(t.text).toBe('BW × 35 · 35 s');
    expect(nextTarget([h('2026-10-01', 0, 58, 'Wall Sit')], 'Wall Sit', st, '2026-10-03')).toMatchObject({ reps: 60 });
  });
  it('at the top: bodyweight says add weight or a harder variation; weighted goes up a step', () => {
    const st = defaultSettings('Plank');
    const bw = nextTarget([h('2026-10-01', 0, 60), h('2026-10-01', 0, 60, 'Plank', { setNo: 2 })], 'Plank', st, '2026-10-03')!;
    expect(bw).toMatchObject({ kind: 'maxed', reps: 60 });
    expect(bw.text).toMatch(/add weight or try a harder variation/);
    expect(nextTarget([h('2026-10-01', 25, 60), h('2026-10-01', 25, 60, 'Plank', { setNo: 2 })], 'Plank', st, '2026-10-03'))
      .toMatchObject({ kind: 'increase', weight: 30, reps: 30 });
  });
  it('never reads an old rep set of a lift that became timed as seconds', () => {
    const st = defaultSettings('Dead Hang');
    expect(nextTarget([reps('2026-10-01', 0, 8, 'Dead Hang')], 'Dead Hang', st, '2026-10-03')).toBeNull();
    expect(nextTarget([reps('2026-09-20', 0, 8, 'Dead Hang'), h('2026-10-01', 0, 40, 'Dead Hang')], 'Dead Hang', st, '2026-10-03'))
      .toMatchObject({ kind: 'reps', reps: 45 });
  });
});

describe('records for a timed lift', () => {
  it('the longest hold at each weight, and a longer hold at a weight is a PR there', () => {
    const a = h('2026-10-01', 25, 30), b = h('2026-10-02', 0, 60), c = h('2026-10-03', 25, 40), d = h('2026-10-04', 0, 50), e = h('2026-10-05', 45, 20);
    const log = [a, b, c, d, e];
    expect(holdsByWeight(log, 'Plank').map((x) => [x.set!.weight, x.value])).toEqual([[0, 60], [25, 40], [45, 20]]);
    expect(records(log, 'Plank').get('hold')).toMatchObject({ value: 60, set: b });
    const k = prKinds(log);
    expect(k.get(c.id)).toEqual(['holdAt']);
    expect(k.get(d.id)).toBeUndefined();
    expect(k.get(e.id)).toBeUndefined(); // a new, heavier weight beats nothing yet
    expect(prToast(log, c)).toBe('PR! Longest hold at 25 lb: 40 s');
  });
  it('an old rep set of a lift that became timed sets no hold record', () => {
    const log = [reps('2026-09-01', 0, 12, 'Dead Hang'), h('2026-10-01', 0, 40, 'Dead Hang')];
    expect(records(log, 'Dead Hang').get('hold')?.value).toBe(40);
    expect(holdsByWeight(log, 'Dead Hang')).toHaveLength(1);
  });
});

describe('csv: a hold_s column', () => {
  it('writes a hold’s seconds to hold_s (and reps, for older builds), and reads hold_s back as a hold', () => {
    const set = h('2026-10-01', 25, 45, 'Wall Sit', { id: 'sample|2026-10-01|wall sit|1', source: 'sample' });
    const csv = toCsv([set]);
    const [head, row] = csv.trim().split('\r\n').map((l) => l.split(','));
    expect(row[head.indexOf('hold_s')]).toBe('45');
    expect(row[head.indexOf('reps')]).toBe('45');
    const { entries: [back] } = parseCsv(csv);
    expect(back).toMatchObject({ reps: 45, flags: ['hold'] });
    // A file with only hold_s: the seconds are the set's, and it is a hold.
    const { entries: [only], errors } = parseCsv('date,exercise,set,weight_lb,reps,hold_s\n2026-10-01,Dead Hang,1,0,,50\n');
    expect(errors).toEqual([]);
    expect(only).toMatchObject({ reps: 50, flags: ['hold'] });
    expect(parseCsv('date,exercise,set,weight_lb,reps,hold_s\n2026-10-01,Dead Hang,1,0,,x\n').errors[0].message).toMatch(/hold_s/);
  });
});
