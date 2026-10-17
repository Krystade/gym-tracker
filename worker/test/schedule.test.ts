import { describe, expect, it } from 'vitest';
import { localDate, nextAt, weekStart, zonedTime } from '../src/schedule';

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
