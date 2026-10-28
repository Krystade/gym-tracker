import { describe, expect, it } from 'vitest';
import { findPerSide, hasPerSide, repeatedRun, totalOf } from './perSide';
import { toTotals, markExcluded } from './dayEdit';
import type { SetEntry } from './types';

let seq = 0;
const s = (source: string, date: string, exercise: string, weight: number, reps = 10, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `${source}|${date}|${exercise}|${seq}`, date, seq: seq++, exercise, setNo: seq, weight, reps, flags: weight <= 0 ? ['bodyweight'] : [], source, ...over,
});
const day = (source: string, date: string, exercise: string, ...wr: [number, number][]) => wr.map(([w, r]) => s(source, date, exercise, w, r));
const ids = (xs: { sets: SetEntry[] }[]) => xs.flatMap((x) => x.sets.map((e) => e.id));

// A log shaped like an old spreadsheet, a notes era and then the app.
const log: SetEntry[] = [
  ...day('xlsx', '2023-03-02', 'Smith Incline Press', [20, 10], [20, 9]),
  ...day('xlsx', '2023-07-14', 'Smith Incline Press', [60, 10], [80, 6]),
  ...day('xlsx', '2023-04-09', 'Smith Squat', [80, 10], [110, 10]),
  ...day('xlsx', '2023-09-11', 'Smith Flat Press', [110, 5], [95, 8], [85, 8], [110, 5], [95, 8], [85, 8]),
  ...day('xlsx', '2023-03-20', 'Smith Flat Press', [65, 8], [65, 8], [65, 8], [65, 8]),
  ...day('xlsx', '2023-10-01', 'Overhead Press', [30, 9], [30, 9]),
  ...day('notes', '2024-02-05', 'Smith Incline Press', [20, 12], [30, 8]),
  ...day('notes', '2024-03-04', 'Bench Press', [30, 12], [40, 9]),
  ...day('notes', '2024-03-11', 'Bench Press', [105, 12], [125, 8], [135, 5]),
  ...day('notes', '2024-05-06', 'Bench Press', [0, 12], [30, 12], [40, 10], [50, 5]),
  ...day('notes', '2024-05-13', 'Bench Press', [40, 6], [50, 3], [60, 3]),
  ...day('notes', '2024-04-01', 'Incline Bench Press', [0, 15], [25, 12]),
  ...day('notes', '2024-04-01', 'Barbell Row', [95, 10], [115, 8]),
  ...day('notes', '2024-04-01', 'Dumbbell Curl', [20, 10]),
  ...day('app', '2024-11-20', 'Smith Incline Press', [105, 10], [105, 6]),
  ...day('app', '2024-11-18', 'Smith Flat Press', [115, 8], [125, 10]),
];

describe('findPerSide: bar sets logged per side, found from the log alone', () => {
  const r = findPerSide(log);
  const convert = (reads: 'side' | 'total') => r.convert.filter((x) => x.reads === reads);
  it('reads the year boundary off the first set logged in the app', () => expect(r.boundary).toBe('2024-01-01'));
  it('converts a session with a set under the bar, and one whose total lands near those', () => {
    expect(convert('side').map((x) => `${x.exercise} ${x.date}`)).toEqual([
      'Overhead Press 2023-10-01', 'Smith Incline Press 2024-02-05', 'Bench Press 2024-03-04', 'Incline Bench Press 2024-04-01',
      'Bench Press 2024-05-06', 'Bench Press 2024-05-13']);
  });
  it('a session that already reads as a total is listed unticked', () => expect(convert('total').map((x) => `${x.exercise} ${x.date}`)).toEqual(['Bench Press 2024-03-11']));
  it('sets from the cut-over on (the first in the app) are never read, nor a lift with no set under the bar', () => {
    const all = new Set([...ids(r.convert), ...ids(r.flag)]);
    for (const e of log) if (e.source === 'app' || e.exercise === 'Barbell Row' || e.exercise === 'Dumbbell Curl') expect(all.has(e.id), e.id).toBe(false);
  });
  it('flags Smith sets from before the boundary instead of converting them, a Smith lift with no app sets too', () => {
    expect(r.flag.map((x) => `${x.exercise} ${x.date}`)).toEqual(['Smith Incline Press 2023-03-02', 'Smith Flat Press 2023-03-20', 'Smith Squat 2023-04-09',
      'Smith Incline Press 2023-07-14', 'Smith Flat Press 2023-09-11']);
    expect(ids(r.convert).some((id) => id.includes('2023') && id.includes('Smith'))).toBe(false);
  });
  it('a session imported twice over loses its repeat, which is neither flagged nor converted', () => {
    expect(r.doubled).toHaveLength(1);
    const d = r.doubled[0];
    expect([d.exercise, d.date, d.remove.map((e) => e.weight)]).toEqual(['Smith Flat Press', '2023-09-11', [110, 95, 85]]);
    expect(d.remove.map((e) => e.seq)).toEqual(d.keep.map((e) => e.seq + 3));
    expect(r.flag.find((x) => x.date === '2023-09-11')!.sets).toHaveLength(3);
  });
  it('nothing left once applied: converted, flagged and the repeat gone', () => {
    const byId = new Map(log.map((e) => [e.id, e]));
    for (const e of toTotals(r.convert.filter((x) => x.reads === 'side').flatMap((x) => x.sets))) byId.set(e.id, e);
    for (const e of markExcluded(r.flag.flatMap((x) => x.sets))) byId.set(e.id, e);
    for (const d of r.doubled) for (const e of d.remove) byId.delete(e.id);
    expect(hasPerSide(findPerSide([...byId.values()]))).toBe(false);
    expect(hasPerSide(r)).toBe(true);
  });
  it('no app sets: no boundary, so nothing is flagged; per-side sessions still found', () => {
    const r2 = findPerSide(log.filter((e) => e.source !== 'app'));
    expect(r2.boundary).toBeNull();
    expect(r2.flag).toEqual([]);
    expect(r2.convert.length).toBeGreaterThan(0);
  });
});

describe('repeatedRun', () => {
  it('needs a run of at least two different sets, repeated exactly', () => {
    expect(repeatedRun(day('x', 'd', 'Bench Press', [70, 8], [70, 8], [70, 8], [70, 8]))).toEqual([]);
    expect(repeatedRun(day('x', 'd', 'Bench Press', [70, 8], [60, 8], [70, 8], [60, 8]))).toHaveLength(2);
    expect(repeatedRun(day('x', 'd', 'Bench Press', [70, 8], [60, 8], [70, 8], [60, 9]))).toEqual([]);
  });
});

describe('dayEdit: per side to totals, and marked not used', () => {
  it('2 × side + the bar, an empty bar 45, flags following the weight; nothing else changes', () => {
    const [a, b] = toTotals([s('n', 'd', 'Bench Press', 0, 12, { flags: ['bodyweight', 'warmup'] }), s('n', 'd', 'Bench Press', 27.5, 12, { note: 'x' })]);
    expect([a.weight, a.flags]).toEqual([45, ['warmup']]);
    expect([b.weight, b.note]).toEqual([totalOf(27.5), 'x']);
    expect(b.weight).toBe(100);
  });
  it('marks a set not used, and leaves one already marked out', () => {
    const e = s('n', 'd', 'Smith Squat', 100);
    expect(markExcluded([e, { ...e, id: 'y', excluded: true }])).toEqual([{ ...e, excluded: true }]);
  });
});
