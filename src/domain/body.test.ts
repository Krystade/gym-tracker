import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCsv, mergeBody, parseBodyFile, proteinCheck, rate, rateBand, toBodyCsv, trend, type BodyDay } from './body';
import { CSV_HEADER } from './csv';

const fx = (n: string) => readFileSync(path.join(import.meta.dirname, '..', '..', 'e2e', 'fixtures', n), 'utf8');

describe('detectCsv', () => {
  it('tells every kind apart by its header', () => {
    expect(detectCsv(fx('history.sample.csv'))).toBe('sets');
    expect(detectCsv(CSV_HEADER.join(',') + '\n')).toBe('sets');
    expect(detectCsv(fx('mfp-weight.sample.csv'))).toBe('mfp-weight');
    expect(detectCsv(fx('mfp-nutrition.sample.csv'))).toBe('mfp-nutrition');
    expect(detectCsv('date,weight_lb,calories,protein_g\n2026-09-01,180,,\n')).toBe('body');
    expect(detectCsv('﻿Date,Weight\n2026-09-01,180\n')).toBe('mfp-weight');
    expect(detectCsv('name,age\nx,1\n')).toBe('unknown');
  });
});

describe('parseBodyFile', () => {
  it('reads MFP weights by column name and skips rows without a weight', () => {
    const r = parseBodyFile(fx('mfp-weight.sample.csv'));
    expect(r.kind).toBe('mfp-weight');
    expect(r.errors).toEqual([]);
    expect(r.days).toHaveLength(6);
    expect(r.days[0]).toEqual({ date: '2026-08-03', weight: 180.2 });
    expect(r.days.map((d) => d.date)).not.toContain('2026-08-17');
  });
  it('sums MFP nutrition per day across meals', () => {
    const r = parseBodyFile(fx('mfp-nutrition.sample.csv'));
    expect(r.days).toEqual([
      { date: '2026-09-12', calories: 2230, protein: 149 },
      { date: '2026-09-13', calories: 1580, protein: 100 },
      { date: '2026-09-14', calories: 700, protein: 50 },
    ]);
  });
  it('reports bad dates and numbers with their row', () => {
    const r = parseBodyFile('Date,Weight\nyesterday,180\n2026-09-02,abc\n2026-09-03,181\n9/4/2026,182\n');
    expect(r.errors.map((e) => e.row)).toEqual([2, 3]);
    expect(r.days).toEqual([{ date: '2026-09-03', weight: 181 }, { date: '2026-09-04', weight: 182 }]);
  });
  it('round-trips body.csv', () => {
    const days: BodyDay[] = [{ date: '2026-09-01', weight: 180.4 }, { date: '2026-09-02', calories: 2500, protein: 160 }];
    const r = parseBodyFile(toBodyCsv(days));
    expect(r.kind).toBe('body');
    expect(r.days).toEqual(days);
  });
});

describe('mergeBody', () => {
  it('overwrites fields present in the file and keeps the rest', () => {
    const m = mergeBody([{ date: '2026-09-01', weight: 180, protein: 150 }], [{ date: '2026-09-01', weight: 181 }, { date: '2026-09-02', weight: 182 }]);
    expect(m).toEqual([{ date: '2026-09-01', weight: 181, protein: 150 }, { date: '2026-09-02', weight: 182 }]);
  });
});

const series = (start: string, n: number, f: (i: number) => number, every = 1): BodyDay[] =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(start) + i * every * 864e5).toISOString().slice(0, 10), weight: f(i) }));

describe('trend and rate', () => {
  it('smooths a one-day spike', () => {
    const t = trend([...series('2026-09-01', 10, () => 180), { date: '2026-09-11', weight: 183 }]);
    expect(t.at(-1)!.trend - 180).toBeLessThan(0.5);
    expect(t.at(-1)!.weight).toBe(183);
  });
  it('moves across a gap as if each missed day had been weighed', () => {
    const t = trend([{ date: '2026-09-01', weight: 180 }, { date: '2026-09-06', weight: 190 }]);
    expect(t[1].trend).toBeCloseTo(180 + 10 * (1 - 0.9 ** 5), 5);
  });
  it('reads a steady half-pound-a-week gain', () => {
    const t = trend(series('2026-07-01', 90, (i) => 180 + (0.5 * i) / 7));
    const r = rate(t)!;
    expect(r.lbPerWeek).toBeCloseTo(0.5, 1);
    expect(r.pctPerWeek).toBeCloseTo((0.5 / 185) * 100, 1);
  });
  it('needs two weeks of data for a rate', () => {
    expect(rate(trend(series('2026-09-01', 10, () => 180)))).toBeNull();
  });
  it('labels the rate against the bulking and cutting bands', () => {
    expect(rateBand(0.05).label).toBe('Maintaining');
    expect(rateBand(0.35)).toEqual({ label: 'Lean gain', tone: 'ok' });
    expect(rateBand(0.8)).toEqual({ label: 'Fast gain', tone: 'warn' });
    expect(rateBand(-0.7)).toEqual({ label: 'Cutting', tone: 'ok' });
    expect(rateBand(-1.4)).toEqual({ label: 'Fast cut', tone: 'warn' });
  });
});

describe('proteinCheck', () => {
  it('averages the last 7 days with protein against 1.6 g/kg of trend weight', () => {
    const days: BodyDay[] = [{ date: '2026-09-01', protein: 50 }, { date: '2026-09-25', protein: 150 }, { date: '2026-09-28', protein: 170 }];
    const p = proteinCheck(days, 180, '2026-09-30')!;
    expect(p).toMatchObject({ avg: 160, days: 2 });
    expect(p.target).toBe(Math.round((180 / 2.20462) * 1.6));
    expect(proteinCheck([{ date: '2026-09-01', protein: 50 }], 180, '2026-09-30')).toBeNull();
  });
});
