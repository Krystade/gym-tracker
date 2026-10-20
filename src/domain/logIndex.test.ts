import { describe, expect, it } from 'vitest';
import { liftKey, normalizeName } from './ids';
import { daySets, doneAt, liftIndex, liftSets, sameExercise, sessionsFor } from './stats';
import { paces, sessionDay, sessionMinutes, timedDay } from './timing';
import { isHoldLift } from './care';
import { muscleVector } from './muscles';
import { addDays, weekStart } from './analytics';
import { candidates, nextDay, type DayPlan, type Program } from './program';
import { prIds } from './records';
import { prSetIds } from './summary';
import { calibratedE1rm } from './estimators';
import type { SetEntry } from './types';

// The caches behind the whole-log scans (round 14): name keys, parsed times, week starts and muscle vectors by string; lift,
// day, pace and trained-date indexes by log array. Each answer must be the uncached one, and a new log array a fresh read.

const SPELLINGS = ['Bench Press', '  bench   press', 'BENCH PRESS', 'Bench\tPress ', 'Lat Pulldown', 'lat  PULLDOWN', 'Plank', 'Cable Curl'];
let n = 0;
const set = (date: string, exercise: string, at: string | null, extra: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${n}`, date, seq: n++, exercise, setNo: n, weight: 100, reps: 10, flags: [], source: 'app',
  ...(at && { loggedAt: new Date(`${date}T${at}:00Z`).toISOString() }), ...extra,
});
/** A few weeks of sets under every spelling, some untimed, some at the same instant. */
function log(): SetEntry[] {
  const out: SetEntry[] = [];
  for (let d = 0; d < 21; d++) {
    const date = addDays('2026-09-01', d);
    SPELLINGS.forEach((ex, i) => {
      for (let s = 0; s < 3; s++) out.push(set(date, ex, (d + i + s) % 5 === 0 ? null : `18:${String(i * 6 + s * 2).padStart(2, '0')}`, ex === 'Plank' ? { flags: ['hold'] } : {}));
    });
    out.push(set(date, 'Cable Curl', '18:46')); // the same instant as the set before it
  }
  return out;
}

describe('name keys', () => {
  it('are normalizeName lower-cased, the first time and every time after', () => {
    for (let pass = 0; pass < 3; pass++) for (const s of [...SPELLINGS, '', ' ', 'Ünïcode  Lift']) expect(liftKey(s)).toBe(normalizeName(s).toLowerCase());
  });
  it('stay right past the cap on distinct names', () => {
    for (let i = 0; i < 4500; i++) expect(liftKey(`Lift  ${i} X`)).toBe(`lift ${i} x`);
    expect(liftKey('BENCH  Press')).toBe('bench press');
    expect(sameExercise('BENCH  Press', ' bench press')).toBe(true);
    expect(sameExercise('Bench Press', 'Bench Pres')).toBe(false);
  });
});

describe('a lift’s sets and a day’s sets', () => {
  it('are the filtered log, in log order, for every spelling', () => {
    const E = log();
    for (const s of [...SPELLINGS, 'Nothing Logged']) expect(liftSets(E, s)).toEqual(E.filter((e) => sameExercise(e.exercise, s)));
    for (const d of [...new Set(E.map((e) => e.date)), '2030-01-01']) expect(daySets(E, d)).toEqual(E.filter((e) => e.date === d));
    expect([...liftIndex(E).keys()]).toEqual(['bench press', 'lat pulldown', 'plank', 'cable curl']);
  });
  it('are read afresh from a new log array, and from one pushed to', () => {
    const E = log();
    expect(isHoldLift('Cable Curl', E)).toBe(false);
    const held = [...E, set('2026-09-22', 'cable  curl', '18:00', { flags: ['hold'] })];
    expect(isHoldLift('Cable Curl', held)).toBe(true);
    expect(liftSets(held, 'Cable Curl')).toHaveLength(liftSets(E, 'Cable Curl').length + 1);
    expect(daySets(held, '2026-09-22')).toHaveLength(1);
    const before = sessionsFor(E, 'Bench Press').length;
    E.push(set('2026-09-23', 'BENCH PRESS', '18:00'));
    expect(sessionsFor(E, 'Bench Press')).toHaveLength(before + 1);
    expect(daySets(E, '2026-09-23')).toHaveLength(1);
  });
  it('are read afresh after an edit: a new array of the same length, one set a changed copy', () => {
    const E = log();
    expect(isHoldLift('Cable Curl', E)).toBe(false);
    const i = E.findIndex((e) => e.exercise === 'Cable Curl');
    const edited = E.map((e, k) => (k === i ? { ...e, flags: ['hold' as const], date: '2026-10-01' } : e));
    expect(isHoldLift('Cable Curl', edited)).toBe(true);
    expect(daySets(edited, '2026-10-01')).toEqual([edited[i]]);
    expect(paces(edited)).not.toBe(paces(E));
  });
});

describe('times', () => {
  it('parse each loggedAt as Date.parse does; no time is NaN', () => {
    const E = log();
    for (const e of [...E, ...E]) expect(Object.is(doneAt(e), e.loggedAt ? Date.parse(e.loggedAt) : NaN)).toBe(true);
    expect(doneAt({ ...E[0], loggedAt: '' })).toBeNaN();
  });
  it('keep a day’s order by the time each set was done', () => {
    const E = log();
    const d = '2026-09-05';
    expect(timedDay(E, d).map((e) => e.id)).toEqual(E.filter((e) => e.date === d && e.loggedAt).sort((a, b) => Date.parse(a.loggedAt!) - Date.parse(b.loggedAt!)).map((e) => e.id));
  });
});

describe('paces and the session day', () => {
  it('are one result per log array, and a new array is read afresh', () => {
    const E = log();
    expect(paces(E)).toBe(paces(E));
    const p = paces(E);
    // Five more sets of a new lift, a minute and a half apart: it gets its own pace in the new log only.
    const more = [...E, ...[0, 1, 2, 3, 4].map((i) => set('2026-09-22', 'Leg Press', `19:${String(i * 3).padStart(2, '0')}`))];
    const q = paces(more);
    expect(q).not.toBe(p);
    expect(q.perSet.get('leg press')).toBe(180);
    expect(p.perSet.has('leg press')).toBe(false);
    expect(sessionMinutes(more, '2026-09-22')).toBe(13); // 12 min and the first set
    expect(sessionMinutes(E, '2026-09-22')).toBeNull();
  });
  it('the session day follows the latest timed set of the array it is given', () => {
    const E = log();
    const now = new Date('2026-09-21T21:00:00Z'); // under 3 h after the last set, 18:46 on the 21st
    expect(sessionDay(E, '2026-09-22', now)).toBe('2026-09-21');
    const late = [...E, set('2026-09-22', 'Bench Press', '00:30')];
    expect(sessionDay(late, '2026-09-22', now)).toBe('2026-09-22');
    expect(sessionDay(E, '2026-09-22', now)).toBe('2026-09-21');
  });
});

describe('the program’s caches', () => {
  const program: Program = { key: 'program', perSession: 12, createdAt: '', days: ['A', 'B', 'C'].map((name) => ({ name, slots: [{ exercise: 'Bench Press', sets: 3, repMin: 8, repMax: 12 }] })) };
  it('the day after the last one trained moves with a new log array', () => {
    const plans: DayPlan[] = [{ key: 'day:2026-09-01', date: '2026-09-01', day: 0, skips: [], swaps: {} }, { key: 'day:2026-09-02', date: '2026-09-02', day: 1, skips: [], swaps: {} }];
    const E = [set('2026-09-01', 'Bench Press', '18:00')];
    expect(nextDay(program, plans, E, '2026-09-05')).toBe(1);
    expect(nextDay(program, plans, [...E, set('2026-09-02', 'Bench Press', '18:00')], '2026-09-05')).toBe(2);
    expect(nextDay(program, plans, [...E, set('2026-09-02', 'Bench Press', '18:00', { flags: ['warmup'] })], '2026-09-05')).toBe(1);
  });
  it('a muscle’s lifts follow a new log array', () => {
    const E = log();
    expect(candidates('Lats', E, '2026-09-22')[0]).toBe('Lat Pulldown');
    const rows = [...E, ...Array.from({ length: 200 }, (_, i) => set(addDays('2026-08-01', i % 30), 'Pull-up', null))];
    expect(candidates('Lats', rows, '2026-09-22')[0]).toBe('Pull-up');
  });
  it('a muscle’s lifts follow the day asked about: recent pain sinks a lift until it is old', () => {
    const E = log().map((e) => (sameExercise(e.exercise, 'Lat Pulldown') ? { ...e, flags: ['pain' as const] } : e));
    // Logged spellings come from the log; the catalog's own spelling is added after them either way.
    expect(candidates('Lats', E, '2026-09-22')).not.toContain('lat  PULLDOWN');
    expect(candidates('Lats', E, '2027-03-01').slice(0, 2)).toEqual(['Lat Pulldown', 'lat  PULLDOWN']);
    expect(candidates('Lats', E, '2026-09-22')).not.toContain('lat  PULLDOWN');
  });
  it('PRs of a day are the whole log’s PRs of that day', () => {
    const E = [...log(), set('2026-09-22', 'bench press', '18:00', { weight: 300, reps: 3 })];
    const all = prIds(E);
    for (const d of ['2026-09-03', '2026-09-22']) expect(prSetIds(E, d)).toEqual(new Set(E.filter((e) => e.date === d && all.has(e.id)).map((e) => e.id)));
    expect(prSetIds(E, '2026-09-22').size).toBe(1);
  });
});

describe('by-string caches', () => {
  it('a muscle vector, null included, is the same for every call', () => {
    for (let pass = 0; pass < 2; pass++) {
      expect(muscleVector('  bench   PRESS')).toBe(muscleVector('Bench Press'));
      expect(muscleVector('Zercher Wobble')).toBeNull();
      expect(muscleVector('Hammer  Curl')).toEqual({ Biceps: 1, Forearms: 0.5 });
    }
  });
  it('a week starts on the Monday, every time', () => {
    for (let pass = 0; pass < 2; pass++) {
      expect(['2026-10-19', '2026-10-20', '2026-10-25', '2026-10-26', '2024-02-29'].map(weekStart)).toEqual(['2026-10-19', '2026-10-19', '2026-10-19', '2026-10-26', '2024-02-26']);
      expect(() => weekStart('not a date')).toThrow();
    }
  });
});

describe('estimates from the lift index', () => {
  it('a test logged under another spelling is the same lift’s, and moves its level (item 04: every set counts)', () => {
    const E = [set('2026-09-01', 'Bench Press', '18:00', { weight: 150 }), set('2026-09-03', 'Bench Press', '18:00'), set('2026-09-05', 'Bench Press', '18:00')];
    const test = set('2026-09-07', 'bench  press', '18:00', { weight: 50, reps: 1, rir: 0, flags: ['test'] });
    const before = calibratedE1rm(E, 'Bench Press')!, after = calibratedE1rm([...E, test], 'Bench Press')!;
    // 50 × 1 to failure reads far below 100–150 × 10: the level moves down toward it, and a spelling apart is no other lift.
    expect(after).toBeLessThan(before);
    expect(calibratedE1rm([...E, test], 'BENCH PRESS')).toBe(after);
  });
});
