import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { bestSet, canonicalName, currentE1rm, e1rm, e1rmSeries, estimateWeightForReps, exerciseNames, lastSession, sessionsByDate, sessionsFor } from './stats';
import { buildAppSet } from './buildSet';
import { fmtSet, fmtWeight } from './format';

let seq = 0;
const s = (date: string, exercise: string, setNo: number, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t|${date}|${exercise.toLowerCase()}|${setNo}`, date, seq: seq++, exercise, setNo, weight, reps, flags: [], source: 't', ...over,
});

describe('e1rm', () => {
  it('uses Epley, and w for a single', () => {
    expect(e1rm(s('2026-01-01', 'Bench', 1, 100, 10))).toBeCloseTo(133.33, 1);
    expect(e1rm(s('2026-01-01', 'Bench', 1, 100, 1))).toBe(100);
  });
  it('skips bodyweight, partial, warmup, zero weight and >20 reps', () => {
    expect(e1rm(s('d', 'x', 1, 0, 15, { flags: ['bodyweight'] }))).toBeNull();
    expect(e1rm(s('d', 'x', 1, 100, null, { flags: ['partial'] }))).toBeNull();
    expect(e1rm(s('d', 'x', 1, 100, 10, { flags: ['warmup'] }))).toBeNull();
    expect(e1rm(s('d', 'x', 1, 50, 25))).toBeNull();
  });
  it('inverts for an N-rep weight', () => {
    expect(estimateWeightForReps(120, 6)).toBeCloseTo(100, 5);
    expect(estimateWeightForReps(120, 1)).toBe(120);
  });
});

describe('sessions', () => {
  const data = [
    s('2026-01-01', 'Curl', 1, 25, 12), s('2026-01-01', 'Curl', 2, 30, 8),
    s('2026-01-08', 'curl ', 1, 30, 10), s('2026-01-08', 'Bench', 1, 100, 8),
    s('2026-01-15', 'Curl', 1, 30, null, { flags: ['partial'] }),
  ];
  it('groups by exercise case-insensitively, newest first', () => {
    expect(sessionsFor(data, 'CURL').map((x) => x.date)).toEqual(['2026-01-15', '2026-01-08', '2026-01-01']);
  });
  it('finds the last session strictly before a date', () => {
    expect(lastSession(data, 'Curl', '2026-01-08')?.date).toBe('2026-01-01');
    expect(lastSession(data, 'Curl', '2026-01-01')).toBeNull();
  });
  it('picks the best set by e1RM, ignoring partials', () => {
    expect(bestSet(data, 'Curl')?.set).toMatchObject({ date: '2026-01-08', weight: 30, reps: 10 });
  });
  it('builds a series with PR markers and skips e1RM-less days', () => {
    const series = e1rmSeries(data, 'Curl');
    expect(series.map((p) => [p.date, p.pr])).toEqual([['2026-01-01', true], ['2026-01-08', true]]);
    expect(currentE1rm(series)).toBeCloseTo(40, 5);
    expect(currentE1rm([])).toBeNull();
  });
  it('lists exercise names most-recent first with one spelling each', () => {
    expect(exerciseNames(data)).toEqual(['Curl', 'Bench']);
  });
  it('groups all sets by date', () => {
    expect(sessionsByDate(data).map((x) => [x.date, x.sets.length])).toEqual([['2026-01-15', 1], ['2026-01-08', 2], ['2026-01-01', 2]]);
  });
});

describe('buildAppSet', () => {
  const existing = [s('2026-02-01', 'Cable Curl', 1, 60, 12, { source: 'app', id: 'app|2026-02-01|cable curl|1' })];
  const now = new Date('2026-02-01T20:00:00Z');
  it('reuses the existing spelling, trims, and numbers the next set', () => {
    const e = buildAppSet(existing, { date: '2026-02-01', exercise: '  cable   curl ', weight: 52.5, reps: 10, flags: [] }, now);
    expect(e).toMatchObject({ exercise: 'Cable Curl', setNo: 2, id: 'app|2026-02-01|cable curl|2', weight: 52.5, source: 'app', seq: now.getTime() });
    expect(canonicalName(existing, 'CABLE CURL')).toBe('Cable Curl');
    expect(canonicalName(existing, 'New Thing ')).toBe('New Thing');
  });
  it('flags zero weight as bodyweight', () => {
    expect(buildAppSet([], { date: '2026-02-01', exercise: 'Pull-up', weight: 0, reps: 8, flags: [] }, now).flags).toEqual(['bodyweight']);
  });
});

describe('format', () => {
  it('formats weights and sets', () => {
    expect(fmtWeight(52.5)).toBe('52.5');
    expect(fmtWeight(60)).toBe('60');
    expect(fmtSet(s('d', 'x', 1, 0, 15))).toBe('BW × 15');
    expect(fmtSet(s('d', 'x', 1, 100, null))).toBe('100 × ?');
  });
});
