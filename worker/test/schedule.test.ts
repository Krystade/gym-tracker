import { describe, expect, it } from 'vitest';
import { localDate, nextAt, nextRemind, remindTime, weekStart, zonedTime } from '../src/schedule';

const NY = 'America/New_York';
const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString());

describe('local times', () => {
  it('turns a wall-clock time into the right instant on both sides of a DST change', () => {
    expect(iso(zonedTime(NY, 2026, 3, 7, 18, 0))).toBe('2026-03-07T23:00:00.000Z'); // EST, −5
    expect(iso(zonedTime(NY, 2026, 3, 9, 18, 0))).toBe('2026-03-09T22:00:00.000Z'); // EDT, −4
    expect(iso(zonedTime(NY, 2026, 11, 2, 18, 0))).toBe('2026-11-02T23:00:00.000Z'); // back to EST
    expect(iso(zonedTime(NY, 2026, 3, 8, 2, 30))).toBe('2026-03-08T07:30:00.000Z'); // skipped: just after the jump
    expect(iso(zonedTime('Asia/Kolkata', 2026, 10, 16, 18, 0))).toBe('2026-10-16T12:30:00.000Z');
  });

  it('finds the next reminder across the spring DST change in New York', () => {
    // Saturday 7 March 2026, 19:00 EST: the next Sunday-or-Monday 18:00 is Sunday 8 March, already EDT.
    const after = Date.parse('2026-03-08T00:00:00Z');
    expect(iso(nextAt(NY, [0, 1], '18:00', after))).toBe('2026-03-08T22:00:00.000Z');
    // And the one after that, Monday.
    expect(iso(nextAt(NY, [0, 1], '18:00', Date.parse('2026-03-08T22:00:00Z')))).toBe('2026-03-09T22:00:00.000Z');
  });

  it('finds the next one across the autumn change, today if it is still ahead, and none with no days', () => {
    // Friday 30 October 2026, 10:00 EDT; Tuesday 18:00 is 3 November, EST.
    expect(iso(nextAt(NY, [2], '18:00', Date.parse('2026-10-30T14:00:00Z')))).toBe('2026-11-03T23:00:00.000Z');
    expect(iso(nextAt(NY, [5], '18:00', Date.parse('2026-10-30T14:00:00Z')))).toBe('2026-10-30T22:00:00.000Z');
    // Just past today's: a week on.
    expect(iso(nextAt(NY, [5], '18:00', Date.parse('2026-10-30T22:00:00Z')))).toBe('2026-11-06T23:00:00.000Z');
    expect(nextAt(NY, [], '18:00', 0)).toBeNull();
  });

  it('knows the local date and the week\'s Monday', () => {
    expect(localDate(NY, Date.parse('2026-10-17T03:00:00Z'))).toBe('2026-10-16');
    expect(localDate('UTC', Date.parse('2026-10-17T03:00:00Z'))).toBe('2026-10-17');
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday belongs to the week that began Monday
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
  });
});

describe('the reminder fitted to his log (item 16)', () => {
  const R = { days: [1, 3, 5], at: '18:00' };
  const L = [null, '19:40', '07:00', 'off', null, '17:30', '20:00'];

  it('only on a day he picked; none on a learned off day; the later of his time and the learned one', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => remindTime(R, L, d))).toEqual([null, '19:40', null, null, null, '18:00', null]);
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => remindTime({ ...R, learn: false }, L, d))).toEqual([null, '18:00', null, '18:00', null, '18:00', null]);
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => remindTime(R, undefined, d))).toEqual([null, '18:00', null, '18:00', null, '18:00', null]);
  });

  it("never more than today's: on any inputs, a learned reminder is on a day today's is, and no earlier", () => {
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const hm = () => `${String(Math.floor(next() * 24)).padStart(2, '0')}:${String(Math.floor(next() * 60)).padStart(2, '0')}`;
    let later = 0, off = 0;
    for (let i = 0; i < 2000; i++) {
      const days = [0, 1, 2, 3, 4, 5, 6].filter(() => next() < 0.5);
      const r = { days, at: hm(), learn: next() < 0.8 };
      const l = [0, 1, 2, 3, 4, 5, 6].map(() => { const x = next(); return x < 0.3 ? null : x < 0.5 ? 'off' : hm(); });
      for (let d = 0; d < 7; d++) {
        const now = remindTime({ days, at: r.at }, undefined, d), got = remindTime(r, l, d);
        if (got == null) { if (now != null) off++; continue; }
        expect(now).not.toBeNull();
        expect(got >= now!).toBe(true);
        if (got > now!) later++;
      }
    }
    expect(later).toBeGreaterThan(500); // the property was tested on cases that moved, not only on ties
    expect(off).toBeGreaterThan(500);
  });

  it('the next one skips an off day and waits for the learned time, across the autumn DST change', () => {
    // Monday 2 November 2026, 12:00 EST: Monday learned 19:40 is ahead today.
    expect(iso(nextRemind(NY, R, L, Date.parse('2026-11-02T17:00:00Z')))).toBe('2026-11-03T00:40:00.000Z');
    // Wednesday is off: after Monday's, Friday at his own 18:00 (learned 17:30 is earlier).
    expect(iso(nextRemind(NY, R, L, Date.parse('2026-11-03T00:40:00Z')))).toBe('2026-11-06T23:00:00.000Z');
    // Friday 30 October, EDT, the same rule.
    expect(iso(nextRemind(NY, R, L, Date.parse('2026-10-30T12:00:00Z')))).toBe('2026-10-30T22:00:00.000Z');
    expect(nextRemind(NY, { days: [3], at: '18:00' }, L, 0)).toBeNull();
  });
});
