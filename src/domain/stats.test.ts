import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { bestSet, canonicalName, currentE1rm, e1rm, e1rmSeries, estimateWeightForReps, exerciseNames, lastSession, sessionsByDate, sessionsFor } from './stats';
import { buildAppSet, derivedFlags } from './buildSet';
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
    expect(e1rm(s('d', 'x', 1, 100, 10, { flags: ['partial'] }))).toBeNull();
    expect(e1rm(s('d', 'x', 1, 25, 10, { flags: ['bodyweight'] }))).toBeNull();
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

describe('order done', () => {
  const at = (hhmm: string) => `2026-10-01T${hhmm}:00.000Z`;
  const bench = (setNo: number, over: Partial<SetEntry>) => s('2026-10-01', 'Bench Press', setNo, 135, 10, over);
  const restored = [
    bench(1, { seq: 0, loggedAt: at('18:00') }), bench(2, { seq: 1, loggedAt: at('18:02') }), bench(3, { seq: 2, loggedAt: at('18:20') }),
    bench(4, { seq: 3, loggedAt: at('18:10'), enteredAt: '2026-10-02T09:00:00.000Z' }),
  ];
  it('a late set on a restored day sorts by its time', () => {
    expect(sessionsFor(restored, 'Bench Press')[0].sets.map((x) => x.setNo)).toEqual([1, 2, 4, 3]);
    expect(sessionsByDate(restored)[0].sets.map((x) => x.setNo)).toEqual([1, 2, 4, 3]);
  });
  it('pasted sets added to a live day come after the live sets', () => {
    const t0 = Date.parse('2026-10-01T18:00:00Z');
    const live = [0, 120000, 240000].map((d, i) => bench(i + 1, { seq: t0 + d, loggedAt: new Date(t0 + d).toISOString() }));
    const pasted = [0, 100, 200].map((q, i) => bench(i + 4, { seq: q }));
    expect(sessionsFor([...pasted, ...live], 'Bench Press')[0].sets.map((x) => x.setNo)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('a day with no times keeps entry order', () => { // passes before and after: guards back-compatibility
    const untimed = [bench(3, { seq: 200 }), bench(1, { seq: 0 }), bench(2, { seq: 100 })];
    expect(sessionsFor(untimed, 'Bench Press')[0].sets.map((x) => x.setNo)).toEqual([1, 2, 3]);
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
  it('derives partial and bodyweight from reps and weight, clearing stale ones on edit', () => {
    expect(derivedFlags(['partial', 'pain'], 50, 8)).toEqual(['pain']);
    expect(derivedFlags(['pain'], 50, null)).toEqual(['pain', 'partial']);
    expect(derivedFlags(['bodyweight'], 20, 8)).toEqual([]);
    expect(derivedFlags([], 0, 8)).toEqual(['bodyweight']);
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
