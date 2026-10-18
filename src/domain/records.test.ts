import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { prKinds, prToast, records, type RecordKind } from './records';

let seq = 0;
const s = (date: string, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t|${seq}`, date, seq: seq++, exercise: 'Bench Press', setNo: 1, weight, reps, flags: reps === null ? ['partial'] : [], source: 't', ...over,
});
const warm = (date: string, weight: number, reps: number) => s(date, weight, reps, { flags: ['warmup'] });
const kinds = (entries: SetEntry[], set: SetEntry) => [...(prKinds(entries).get(set.id) ?? [])].sort();
const sorted = (...k: RecordKind[]) => [...k].sort();
const held = (entries: SetEntry[], kind: RecordKind, name = 'Bench Press') => records(entries, name).get(kind);

describe('records: what each lift holds', () => {
  it('best e1RM is plain Epley over every set with reps, warm-ups included, with the set and its day', () => {
    const a = s('2026-09-01', 135, 8), b = s('2026-09-08', 165, 3);
    const entries = [a, b, s('2026-09-08', 100, 25), s('2026-09-15', 200, null)];
    expect(held(entries, 'e1rm')).toMatchObject({ date: '2026-09-08', set: b });
    expect(held(entries, 'e1rm')?.value).toBeCloseTo(181.5, 9); // 165 × (1 + 3/30)
    // Past 20 reps there's no estimate; a partial set has none either.
    expect(held([s('2026-09-01', 100, 25)], 'e1rm')).toBeUndefined();
    // A warm-up was lifted: it counts like any set.
    const w = warm('2026-09-08', 170, 3);
    expect(held([...entries, w], 'e1rm')).toMatchObject({ set: w });
    expect(held([...entries, w], 'e1rm')?.value).toBeCloseTo(187, 9);
  });

  it('heaviest weight counts a partial set and a warm-up, never a hold or a set of 0 reps', () => {
    const part = s('2026-09-15', 185, null);
    const entries = [s('2026-09-01', 135, 8), part, s('2026-09-16', 205, 0)];
    expect(held(entries, 'heaviest')).toMatchObject({ value: 185, date: '2026-09-15', set: part });
    const w = warm('2026-09-15', 225, 1);
    expect(held([...entries, w], 'heaviest')).toMatchObject({ value: 225, set: w });
    expect(held([s('2026-09-01', 50, 30, { exercise: 'Plate Pinch Hold', flags: ['hold'] })], 'heaviest', 'Plate Pinch Hold')).toBeUndefined();
  });

  it('a rep max is the most weight for at least that many reps; a partial set makes none, a warm-up does', () => {
    const ten = s('2026-09-01', 135, 10), five = s('2026-09-08', 155, 5), three = s('2026-09-15', 165, 3), w = warm('2026-09-15', 45, 15);
    const entries = [ten, five, three, s('2026-09-15', 185, null), w];
    const r = records(entries, 'Bench Press');
    expect([1, 3, 5, 8, 10, 12].map((n) => r.get(`rm${n}` as RecordKind)?.value ?? null)).toEqual([165, 165, 155, 135, 135, 45]);
    expect(r.get('rm8')?.set).toBe(ten); // the 10-rep set stands as the 8-rep max too
    expect(r.get('rm12')?.set).toBe(w); // the warm-up is the only set of 12 or more
  });

  it('set volume is the best weight × reps; session volume the best day’s sets added up, warm-ups included', () => {
    const entries = [s('2026-09-01', 100, 10), s('2026-09-01', 100, 10), warm('2026-09-01', 45, 10), s('2026-09-01', 150, null),
      s('2026-09-08', 150, 8)];
    expect(held(entries, 'setVolume')).toMatchObject({ value: 1200, date: '2026-09-08' });
    expect(held(entries, 'sessionVolume')).toEqual({ kind: 'sessionVolume', value: 2450, date: '2026-09-01', set: null, sets: 3 });
    const big = warm('2026-09-08', 135, 10); // a warm-up can hold the set volume too
    expect(held([...entries, big], 'setVolume')).toMatchObject({ value: 1350, set: big });
  });

  it('a bodyweight lift holds most reps in a set and in a session, and no weight records', () => {
    const bw = (date: string, reps: number, over: Partial<SetEntry> = {}) => s(date, 0, reps, { exercise: 'Pull-up', flags: ['bodyweight'], ...over });
    const best = bw('2026-09-08', 12);
    const entries = [bw('2026-09-01', 10), bw('2026-09-01', 9), bw('2026-09-01', 8), best, bw('2026-09-08', 6)];
    const r = records(entries, 'Pull-up');
    expect(r.get('mostReps')).toMatchObject({ value: 12, date: '2026-09-08', set: best });
    expect(r.get('sessionReps')).toMatchObject({ value: 27, date: '2026-09-01', sets: 3 });
    expect([...r.keys()].sort()).toEqual(['mostReps', 'sessionReps']);
    // A warm-up's reps count: 15 in a set, and 12 + 6 + 15 = 33 on the 8th.
    const w = bw('2026-09-08', 15, { flags: ['bodyweight', 'warmup'] });
    const r2 = records([...entries, w], 'Pull-up');
    expect(r2.get('mostReps')).toMatchObject({ value: 15, set: w });
    expect(r2.get('sessionReps')).toMatchObject({ value: 33, date: '2026-09-08', sets: 3 });
  });

  it('a hold holds its longest hold only, weighted or not', () => {
    const h = (date: string, weight: number, secs: number, name = 'Plank') => s(date, weight, secs, { exercise: name, flags: weight ? ['hold'] : ['hold', 'bodyweight'] });
    const long = h('2026-09-08', 0, 60);
    expect([...records([h('2026-09-01', 0, 45), long, h('2026-09-15', 0, 50)], 'Plank')]).toEqual([['hold', { kind: 'hold', value: 60, date: '2026-09-08', set: long }]]);
    // Known as a hold by its name even when the set carries no hold flag.
    expect([...records([s('2026-09-01', 0, 40, { exercise: 'Side Plank', flags: ['bodyweight'] })], 'Side Plank').keys()]).toEqual(['hold']);
    expect([...records([h('2026-09-01', 25, 30, 'Plate Pinch Hold'), h('2026-09-08', 45, 20, 'Plate Pinch Hold')], 'Plate Pinch Hold').keys()]).toEqual(['hold']);
  });

  it('cardio holds the longest time, the farthest distance or most floors, and the best pace (lower is better)', () => {
    const c = (date: string, cardio: SetEntry['cardio'], name = 'Treadmill') => s(date, 0, null, { exercise: name, flags: ['cardio'], cardio });
    const far = c('2026-09-08', { seconds: 1800, miles: 2 }), quick = c('2026-09-15', { seconds: 900, miles: 1.25 });
    const r = records([c('2026-09-01', { seconds: 1200, miles: 1.2 }), far, quick, c('2026-09-16', { seconds: 2400 })], 'Treadmill');
    expect(r.get('time')).toMatchObject({ value: 2400, date: '2026-09-16' });
    expect(r.get('distance')).toMatchObject({ value: 2, set: far });
    expect(r.get('pace')).toMatchObject({ value: 720, set: quick }); // 12:00 /mi
    expect(r.has('heaviest') || r.has('e1rm')).toBe(false);
    const stairs = records([c('2026-09-01', { seconds: 600, floors: 40 }, 'StairMaster'), c('2026-09-08', { seconds: 600, floors: 55 }, 'StairMaster')], 'StairMaster');
    expect(stairs.get('floors')).toMatchObject({ value: 55, date: '2026-09-08' });
    expect(stairs.has('pace')).toBe(false);
  });

  it('a tie stays with the earliest set; within a day, the one done first', () => {
    const first = s('2026-09-01', 155, 5), again = s('2026-09-08', 155, 5);
    expect(held([again, first], 'rm5')?.set).toBe(first);
    // Entered second but done first (an earlier time): it holds the record.
    const later = s('2026-09-20', 175, 5, { loggedAt: '2026-09-20T18:30:00Z' }), earlier = s('2026-09-20', 175, 5, { loggedAt: '2026-09-20T18:05:00Z' });
    expect(held([first, later, earlier], 'heaviest')?.set).toBe(earlier);
    expect(kinds([first, later, earlier], later)).toEqual([]); // a tie is not a PR
    // A session that only equals the best day leaves the record with that day.
    const day = (date: string) => [s(date, 100, 10), s(date, 100, 10)];
    expect(held([...day('2026-09-01'), ...day('2026-09-08')], 'sessionVolume')).toMatchObject({ value: 2000, date: '2026-09-01' });
    const bw = (date: string, reps: number) => s(date, 0, reps, { exercise: 'Pull-up', flags: ['bodyweight'] });
    expect(held([bw('2026-09-01', 10), bw('2026-09-01', 8), bw('2026-09-08', 9), bw('2026-09-08', 9)], 'sessionReps', 'Pull-up')).toMatchObject({ value: 18, date: '2026-09-01' });
  });

  it('records follow the log: deleting or editing the record set hands it back', () => {
    const old = s('2026-09-01', 185, 3), top = s('2026-09-08', 205, 2);
    expect(held([old, top], 'heaviest')?.set).toBe(top);
    expect(held([old], 'heaviest')?.set).toBe(old); // deleted
    const edited = { ...top, weight: 180 }; // a typo fixed
    expect(held([old, edited], 'heaviest')).toMatchObject({ value: 185, set: old });
    expect(held([old, edited], 'rm1')).toMatchObject({ value: 185, set: old });
    expect(kinds([old, edited], edited)).toEqual([]);
    expect(records([], 'Bench Press').size).toBe(0);
  });

  it('counts a name spelled with odd spacing or case as the same lift, and no other lift', () => {
    const a = s('2026-09-01', 135, 8), b = s('2026-09-08', 140, 8, { exercise: 'bench  press' }), curl = s('2026-09-08', 300, 8, { exercise: 'Cable Curl' });
    expect(held([a, b, curl], 'heaviest')?.set).toBe(b);
    expect(kinds([a, b, curl], b)).toContain('heaviest');
  });
});

describe('prKinds: the records a set broke when it was done', () => {
  it("a lift's first set is no PR; one that beats it is a PR for each record it beats", () => {
    const a = s('2026-09-01', 135, 8), b = s('2026-09-08', 145, 8);
    expect(kinds([a], a)).toEqual([]);
    expect(kinds([a, b], b)).toEqual(sorted('e1rm', 'heaviest', 'rm1', 'rm3', 'rm5', 'rm8', 'setVolume', 'sessionVolume'));
  });

  it("a lift's first day is no PR: its working sets beat only that day's warm-ups", () => {
    const w1 = warm('2026-09-01', 45, 10), w2 = warm('2026-09-01', 95, 5), a = s('2026-09-01', 135, 8), a2 = s('2026-09-01', 140, 8);
    const day1 = [w1, w2, a, a2];
    for (const x of day1) expect(kinds(day1, x)).toEqual([]);
    // The records still stand from that day on: the next day has to beat them.
    expect(held(day1, 'heaviest')?.set).toBe(a2);
    const b = s('2026-09-08', 140, 8), c = s('2026-09-08', 145, 8);
    expect(kinds([...day1, b], b)).toEqual([]);
    expect(kinds([...day1, c], c)).toContain('heaviest');
  });

  it('more reps at a weight: more than every earlier set at that weight or heavier', () => {
    const a = s('2026-09-01', 135, 8), b = s('2026-09-01', 145, 6);
    const more = s('2026-09-08', 120, 9); // 1080 lb, as a × 8 was; e1RM 156 under 171
    expect(kinds([a, b, more], more)).toEqual(['reps']);
    const fewer = s('2026-09-08', 120, 8); // 135 × 8 was heavier with as many
    expect(kinds([a, b, fewer], fewer)).toEqual([]);
    // Heavier than every earlier set has nothing to have more reps than: it's a heaviest PR instead.
    const heavy = s('2026-09-08', 150, 1);
    expect(kinds([a, b, heavy], heavy)).toEqual(sorted('heaviest', 'rm1'));
  });

  it('a partial set is a PR for heaviest weight only, and later sets have to beat it', () => {
    const a = s('2026-09-01', 135, 8), part = s('2026-09-08', 155, null), next = s('2026-09-15', 150, 5);
    expect(kinds([a, part], part)).toEqual(['heaviest']);
    expect(kinds([a, part, next], next)).toEqual(sorted('e1rm', 'rm1', 'rm3', 'rm5'));
  });

  it('a warm-up is a PR like any set, and the bar the next set has to beat', () => {
    const a = s('2026-09-01', 135, 8), w = warm('2026-09-08', 200, 10), b = s('2026-09-08', 140, 8);
    expect(kinds([a, w, b], w)).toEqual(sorted('e1rm', 'heaviest', 'rm1', 'rm3', 'rm5', 'rm8', 'setVolume', 'sessionVolume'));
    expect(kinds([a, w, b], b)).toEqual([]);
    expect(prToast([a, w], w)).toBe('PR! Best e1RM: 267 lb'); // 200 × (1 + 10/30)
  });

  it('a longer hold is a hold PR and never a weight or rep PR', () => {
    const h = (date: string, weight: number, secs: number) => s(date, weight, secs, { exercise: 'Plate Pinch Hold', flags: ['hold'] });
    const a = h('2026-09-01', 25, 30), b = h('2026-09-08', 45, 45);
    expect(kinds([a, b], b)).toEqual(['hold']);
    const heavier = h('2026-09-15', 70, 20);
    expect(kinds([a, b, heavier], heavier)).toEqual([]);
  });

  it('a bodyweight set is a PR for most reps; session reps break on the set that passes the best day', () => {
    const bw = (date: string, reps: number) => s(date, 0, reps, { exercise: 'Pull-up', flags: ['bodyweight'] });
    const a = bw('2026-09-01', 10), b = bw('2026-09-01', 8), c = bw('2026-09-08', 9), d = bw('2026-09-08', 11);
    expect(kinds([a, b, c, d], c)).toEqual([]);
    expect(kinds([a, b, c, d], d)).toEqual(sorted('mostReps', 'sessionReps')); // 20 reps after 18
  });

  it('session volume breaks once a day, on the set that takes the day past every earlier day', () => {
    const day1 = [s('2026-09-01', 100, 10), s('2026-09-01', 100, 10)]; // 2000
    const x = s('2026-09-08', 100, 10), y = s('2026-09-08', 90, 10), z = s('2026-09-08', 100, 10); // 1000, 1900, 2900
    const all = [...day1, x, y, z];
    expect(kinds(all, x)).toEqual([]);
    expect(kinds(all, y)).toEqual([]);
    expect(kinds(all, z)).toEqual(['sessionVolume']);
    const after = s('2026-09-08', 100, 10);
    expect(kinds([...all, after], after)).toEqual([]); // the day already broke it
    const p = s('2026-09-08', 100, 10), q = s('2026-09-08', 100, 10);
    expect(kinds([...day1, p, q], q)).toEqual([]); // equal is no PR
  });

  it('the first set to reach a rep count beats nothing at that count', () => {
    const a = s('2026-09-01', 135, 8), twelve = s('2026-09-08', 85, 12);
    expect(kinds([a, twelve], twelve)).toEqual(['reps']); // 12 reps at 85 or more for the first time; no 10- or 12-rep max to beat
  });

  it('cardio: farther, longer or faster than every earlier bout', () => {
    const c = (date: string, seconds: number, miles?: number) => s(date, 0, null, { exercise: 'Treadmill', flags: ['cardio'], cardio: { seconds, ...(miles != null && { miles }) } });
    const a = c('2026-09-01', 1200, 1.5), b = c('2026-09-08', 1200, 1.6), slow = c('2026-09-15', 1500, 1.6);
    expect(kinds([a], a)).toEqual([]);
    expect(kinds([a, b], b)).toEqual(sorted('distance', 'pace'));
    expect(kinds([a, b, slow], slow)).toEqual(['time']);
  });

  it('a set later beaten is still the PR it was when it was done, a late one on an old day too', () => {
    const a = s('2026-09-01', 135, 8), b = s('2026-09-15', 155, 8), late = s('2026-09-08', 145, 8);
    expect(kinds([a, b, late], late)).toContain('e1rm');
    expect(kinds([a, b, late], b)).toContain('e1rm');
  });
});

describe('prToast: one banner, naming the best record the set broke', () => {
  it('leads with e1RM, then heaviest, then the lowest rep max, then reps at a weight, then volume', () => {
    const a = s('2026-09-01', 135, 8);
    const b = s('2026-09-08', 145, 8);
    expect(prToast([a, b], b)).toBe('PR! Best e1RM: 184 lb'); // 145 × (1 + 8/30) = 183.7
    const part = s('2026-09-08', 155, null);
    expect(prToast([a, part], part)).toBe('PR! Heaviest: 155 lb');
    const five = s('2026-09-15', 150, 5); // 150 is under the partial 155, and 175 e1RM beats 171
    expect(prToast([a, part, five], five)).toBe('PR! Best e1RM: 175 lb');
    const rm = [a, s('2026-09-02', 160, 2), s('2026-09-09', 140, 6)]; // 168 e1RM, under 171; 3+ and 5+ reps were 135 at most
    expect(prToast(rm, rm[2])).toBe('PR! 3-rep max: 140 lb');
    const reps = [a, s('2026-09-08', 120, 9)];
    expect(prToast(reps, reps[1])).toBe('PR! Most reps at 120 lb: 9');
  });

  it('says volume, reps, holds and cardio in their own units', () => {
    const vol = [s('2026-09-01', 100, 10), s('2026-09-01', 100, 10), s('2026-09-08', 100, 10), s('2026-09-08', 100, 10), s('2026-09-08', 50, 2)];
    expect(prToast(vol, vol[4])).toBe('PR! Best session volume: 2,100 lb');
    const bw = (date: string, reps: number) => s(date, 0, reps, { exercise: 'Pull-up', flags: ['bodyweight'] });
    const pu = [bw('2026-09-01', 10), bw('2026-09-08', 12)];
    expect(prToast(pu, pu[1])).toBe('PR! Most reps: 12');
    const pl = [s('2026-09-01', 0, 45, { exercise: 'Plank', flags: ['hold', 'bodyweight'] }), s('2026-09-08', 0, 60, { exercise: 'Plank', flags: ['hold', 'bodyweight'] })];
    expect(prToast(pl, pl[1])).toBe('PR! Longest hold: 60 s');
    const c = (date: string, seconds: number, miles: number) => s(date, 0, null, { exercise: 'Treadmill', flags: ['cardio'], cardio: { seconds, miles } });
    const tm = [c('2026-09-01', 1200, 1.5), c('2026-09-08', 1200, 1.75)];
    expect(prToast(tm, tm[1])).toBe('PR! Farthest: 1.75 mi');
    const fast = [c('2026-09-01', 1200, 1.5), c('2026-09-08', 600, 1)];
    expect(prToast(fast, fast[1])).toBe('PR! Best pace: 10:00 /mi');
  });

  it('is null for a set that broke nothing, and checks a set not yet in the list as if it were', () => {
    const a = s('2026-09-01', 135, 8);
    expect(prToast([a], a)).toBeNull();
    const b = s('2026-09-08', 130, 8);
    expect(prToast([a, b], b)).toBeNull();
    const c = s('2026-09-08', 140, 8);
    expect(prToast([a], c)).toBe('PR! Best e1RM: 177 lb');
  });
});
