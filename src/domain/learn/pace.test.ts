import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { paceOf } from './pace';

let seq = 0;
const set = (date: string, exercise: string, t: number): SetEntry => ({
  id: `p${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 100, reps: 8, flags: [], source: 'sample',
  loggedAt: new Date(Date.parse(`${date}T17:00:00Z`) + t * 1000).toISOString(),
});
/** One day: `sets` sets of each lift, `gap` s apart, lifts 5 min apart. */
const day = (date: string, lifts: [string, number, number][]) => {
  let t = 0;
  return lifts.flatMap(([ex, n, gap]) => Array.from({ length: n }, (_, i) => set(date, ex, (t += i ? gap : 300))));
};

describe('learn/pace', () => {
  it('needs nothing per lift: 3 timed gaps in total switch from the defaults to the person', () => {
    expect(paceOf(day('2024-01-01', [['Bench Press', 2, 240], ['DB Curl', 2, 240]]))).toBeNull(); // 2 gaps
    const p = paceOf(day('2024-01-01', [['Bench Press', 2, 240], ['DB Curl', 2, 240], ['Leg Press', 2, 240]]))!;
    expect(p.n).toBe(3);
    expect(p.gap).toBeCloseTo(240, 0);
    expect(p.lift('Cable Pushdown').gap).toBeCloseTo(240, 0); // never done: the person's pace
  });

  it('a lift with many gaps keeps its own pace; one with a single gap stays near the person', () => {
    const es: SetEntry[] = [];
    for (let d = 1; d <= 20; d++) es.push(...day(`2024-02-${String(d).padStart(2, '0')}`, [['Bench Press', 4, 400], ['DB Curl', 3, 150], ['Lat Pulldown', 3, 160]]));
    es.push(...day('2024-03-01', [['Leg Press', 2, 590]]));
    const p = paceOf(es)!;
    expect(p.lift('Bench Press').gap).toBeGreaterThan(370);
    expect(p.lift('DB Curl').gap).toBeLessThan(170);
    const lp = p.lift('Leg Press').gap;
    expect(lp).toBeLessThan(500);
    expect(lp).toBeGreaterThan(p.gap * 0.9);
  });

  it('ignores breaks over 10 min, warm-ups, untimed sets and switches between lifts', () => {
    const es = day('2024-01-01', [['Bench Press', 4, 200]]);
    es.push(set('2024-01-01', 'Bench Press', 600 + 4 * 200 + 900)); // a 15-min break
    es.push({ ...set('2024-01-01', 'Bench Press', 0), loggedAt: undefined });
    const p = paceOf(es)!;
    expect(p.n).toBe(3);
    expect(p.gap).toBeCloseTo(200, 0);
  });
});
