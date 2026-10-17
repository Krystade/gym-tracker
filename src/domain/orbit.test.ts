import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { cleanStatus, dayKinds, fmtWeek, lastTraining, orbitDays, statusLength, weekNumbers } from './orbit';

let seq = 0;
const s = (exercise: string, n = 1, over: Partial<SetEntry> = {}, date = '2026-10-14'): SetEntry[] =>
  Array.from({ length: n }, () => ({ id: `t${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 100, reps: 8, flags: [], source: 't', ...over }));
const cardio = (mins: number, date = '2026-10-14'): SetEntry[] => s('Treadmill', 1, { weight: 0, reps: null, flags: ['cardio'], cardio: { seconds: mins * 60 } }, date);

describe('dayKinds', () => {
  it('gives each kind a clear day of its own', () => {
    expect(dayKinds(s('Barbell Squat', 4))).toEqual({ training: true, kinds: ['legs'] });
    expect(dayKinds(s('Bench Press', 4))).toEqual({ training: true, kinds: ['push'] });
    expect(dayKinds(s('Lat Pulldown', 4))).toEqual({ training: true, kinds: ['pull'] });
    expect(dayKinds(s('Cable Crunch', 4))).toEqual({ training: true, kinds: ['core'] });
    expect(dayKinds(cardio(30))).toEqual({ training: true, kinds: ['cardio'] });
  });
  it('shares a day between two kinds within 20%, top first; past 20% the top kind has it alone', () => {
    // A row set is 5/6 pull (forearms are arms and core): 3 rows = 2.5 against 3 bench = 3, within 20%.
    expect(dayKinds([...s('Bench Press', 3), ...s('Seated Cable Row', 3)]).kinds).toEqual(['push', 'pull']);
    // 2.5 against 4: not within 20%.
    expect(dayKinds([...s('Bench Press', 4), ...s('Seated Cable Row', 3)]).kinds).toEqual(['push']);
    expect(dayKinds([...s('Bench Press', 3), ...s('Lat Pulldown', 4)]).kinds).toEqual(['pull', 'push']);
  });
  it('a warm-up-only day is rest, and so is an empty one', () => {
    expect(dayKinds(s('Barbell Squat', 3, { flags: ['warmup'] }))).toEqual({ training: false, kinds: [] });
    expect(dayKinds([])).toEqual({ training: false, kinds: [] });
  });
  it('warm-ups don’t count toward a kind', () => {
    expect(dayKinds([...s('Bench Press', 2), ...s('Barbell Squat', 6, { flags: ['warmup'] })]).kinds).toEqual(['push']);
  });
  it('cardio alone is cardio; a long session can outweigh a few sets, a short one can’t', () => {
    expect(dayKinds([...cardio(45), ...s('DB Curl', 3)]).kinds).toEqual(['cardio']);
    expect(dayKinds([...cardio(10), ...s('Barbell Squat', 8)]).kinds).toEqual(['legs']);
  });
  it('unmapped lifts make a training day with no kind (neutral), and don’t count toward one', () => {
    expect(dayKinds(s('Mystery Move', 5))).toEqual({ training: true, kinds: [] });
    expect(dayKinds([...s('Mystery Move', 20), ...s('Bench Press', 1)]).kinds).toEqual(['push']);
  });
});

describe('orbitDays', () => {
  it('has every day in the window, oldest first, rest days included', () => {
    const e = [...s('Barbell Squat', 2, {}, '2026-10-12'), ...s('Bench Press', 2, {}, '2026-10-14'), ...s('Bench Press', 2, {}, '2026-10-20')];
    const d = orbitDays(e, '2026-10-11', '2026-10-14');
    expect(d.map((x) => x.date)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
    expect(d.map((x) => x.kinds)).toEqual([[], ['legs'], [], ['push']]);
    expect(lastTraining(d)?.date).toBe('2026-10-14');
    expect(lastTraining(orbitDays([], '2026-10-11', '2026-10-14'))).toBeNull();
  });
});

describe('weekNumbers', () => {
  it('counts sessions (lifting or cardio days) and working sets, Monday to Sunday', () => {
    const e = [
      ...s('Barbell Squat', 3, {}, '2026-10-12'), ...s('Barbell Squat', 2, { flags: ['warmup'] }, '2026-10-12'),
      ...cardio(20, '2026-10-13'), ...s('Bench Press', 1, { flags: ['warmup'] }, '2026-10-14'),
      ...s('Bench Press', 4, {}, '2026-10-18'), ...s('Bench Press', 9, {}, '2026-10-19'), ...s('Bench Press', 9, {}, '2026-10-11'),
    ];
    expect(weekNumbers(e, '2026-10-12')).toEqual({ sessions: 3, sets: 7 });
    expect(fmtWeek({ sessions: 3, sets: 41 })).toBe('3 sessions · 41 sets');
    expect(fmtWeek({ sessions: 1, sets: 1 })).toBe('1 session · 1 set');
  });
});

describe('status phrase', () => {
  it('is trimmed, spaces collapsed, cut to 24 characters with an emoji counting as one', () => {
    expect(cleanStatus('  deload   week ')).toBe('deload week');
    expect(cleanStatus('a'.repeat(30))).toBe('a'.repeat(24));
    expect(statusLength('leg day 🦵🏽')).toBe(9);
    expect(cleanStatus(`${'x'.repeat(23)}🏋️‍♀️🦵`)).toBe(`${'x'.repeat(23)}🏋️‍♀️`);
    expect(cleanStatus(7)).toBe('');
  });
});
