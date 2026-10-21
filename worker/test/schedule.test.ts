import { describe, expect, it } from 'vitest';
import { localDate, nextAt, nextRemind, remindTime, remindToday, weekStart, zonedTime } from '../src/schedule';

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

describe('no reminder on a planned rest day (readiness S5, owner Q6)', () => {
  // The rules as they were before rest dates (the oracle): the first reminder time in the next 8 days, and the alarm's test.
  const before = {
    nextRemind(tz: string, reminder: { days: readonly number[]; at: string; learn?: boolean }, learned: readonly (string | null)[] | undefined, after: number): number | null {
      const ymd = localDate(tz, after).split('-').map(Number);
      for (let i = 0; i <= 8; i++) {
        const day = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2] + i));
        const at = remindTime(reminder, learned, day.getUTCDay());
        if (at == null) continue;
        const [hh, mm] = at.split(':').map(Number);
        const t = zonedTime(tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm);
        if (t > after) return t;
      }
      return null;
    },
    remindToday(prefs: { kinds: { remind: boolean }; reminder: { learn?: boolean } }, act: { date: string; week: { start: string; sessions: number }; goal?: number } | undefined, remindedOn: string | undefined, today: string) {
      const met = prefs.reminder.learn !== false && act?.goal != null && act.week.start === weekStart(today) && act.week.sessions >= act.goal;
      return prefs.kinds.remind && act?.date !== today && !met && remindedOn !== today;
    },
  };
  const ZONES = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC'];
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

  it('never on a rest date it was sent; exactly as before with none sent (or learning off); 3000 random cases', () => {
    let seed = 11;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
    const hm = () => `${String(Math.floor(next() * 24)).padStart(2, '0')}:${String(Math.floor(next() * 60)).padStart(2, '0')}`;
    let skipped = 0, quiet = 0, same = 0, sameToday = 0;
    for (let i = 0; i < 3000; i++) {
      const tz = pick(ZONES);
      // Any instant in 2026–2027 (both DST changes in it).
      const after = Date.parse('2026-01-01T00:00:00Z') + Math.floor(next() * 730 * 864e5);
      const today = localDate(tz, after);
      const days = [0, 1, 2, 3, 4, 5, 6].filter(() => next() < 0.6);
      const learn = next() < 0.85 ? (next() < 0.5 ? undefined : true) : false;
      const reminder = { days, at: hm(), ...(learn !== undefined && { learn }) };
      const learned = next() < 0.5 ? undefined : [0, 1, 2, 3, 4, 5, 6].map(() => { const x = next(); return x < 0.4 ? null : x < 0.55 ? 'off' : hm(); });
      // As the phone sends them: up to 7 dates of the next 7 days (today first).
      const rest = [0, 1, 2, 3, 4, 5, 6].filter(() => next() < 0.45).map((n) => addDays(today, n));
      const week = { start: weekStart(today), sessions: Math.floor(next() * 4) };
      const act = { date: next() < 0.2 ? today : addDays(today, -1 - Math.floor(next() * 5)), week, ...(next() < 0.6 && { goal: 1 + Math.floor(next() * 5) }) };
      const remindedOn = next() < 0.15 ? today : undefined;
      const prefs = { kinds: { remind: next() < 0.9 }, reminder };

      const got = nextRemind(tz, reminder, learned, after, rest), old = before.nextRemind(tz, reminder, learned, after);
      // With no rest dates (none, empty, or an older app's undefined), or learning off: the same instant as before.
      expect(nextRemind(tz, reminder, learned, after)).toBe(old);
      expect(nextRemind(tz, reminder, learned, after, [])).toBe(old);
      expect(remindToday(prefs, act, remindedOn, today)).toBe(before.remindToday(prefs, act, remindedOn, today));
      expect(remindToday(prefs, { ...act, rest: [] }, remindedOn, today)).toBe(before.remindToday(prefs, act, remindedOn, today));
      if (learn === false) {
        expect(got).toBe(old);
        expect(remindToday(prefs, { ...act, rest }, remindedOn, today)).toBe(before.remindToday(prefs, act, remindedOn, today));
        continue;
      }
      same++;
      // With them: never an instant on a rest date; never earlier than before, and the same one unless that was a rest date.
      if (got != null) {
        expect(rest).not.toContain(localDate(tz, got));
        expect(got > after).toBe(true);
        expect(remindTime(reminder, learned, new Date(`${localDate(tz, got)}T00:00:00Z`).getUTCDay())).not.toBeNull();
      }
      if (old != null && !rest.includes(localDate(tz, old))) expect(got).toBe(old);
      else if (old != null) { skipped++; expect(got == null || got > old).toBe(true); }
      else expect(got).toBeNull();
      // The alarm on a rest date: quiet; on any other day, as before.
      const due = remindToday(prefs, { ...act, rest }, remindedOn, today);
      if (rest.includes(today)) { expect(due).toBe(false); if (before.remindToday(prefs, act, remindedOn, today)) quiet++; }
      else { expect(due).toBe(before.remindToday(prefs, act, remindedOn, today)); sameToday++; }
    }
    // The property was tested on cases that moved, not only on ties.
    expect(skipped).toBeGreaterThan(300);
    expect(quiet).toBeGreaterThan(300);
    expect(same).toBeGreaterThan(2000);
    expect(sameToday).toBeGreaterThan(1000);
  });

  it('skips a rest date to the next reminder day, across the autumn DST change', () => {
    const NY = 'America/New_York', R = { days: [1, 3, 5], at: '18:00' };
    // Monday 2 November 2026, 12:00 EST. Monday rests: Wednesday 18:00; Monday and Wednesday: Friday.
    const noon = Date.parse('2026-11-02T17:00:00Z');
    expect(iso(nextRemind(NY, R, undefined, noon, ['2026-11-02']))).toBe('2026-11-04T23:00:00.000Z');
    expect(iso(nextRemind(NY, R, undefined, noon, ['2026-11-02', '2026-11-04']))).toBe('2026-11-06T23:00:00.000Z');
    // Every one of his days in the week rests: the week after, never none.
    expect(iso(nextRemind(NY, R, undefined, noon, ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09']))).toBe('2026-11-11T23:00:00.000Z');
    // A rest date on a day he didn't pick changes nothing.
    expect(iso(nextRemind(NY, R, undefined, noon, ['2026-11-03']))).toBe('2026-11-02T23:00:00.000Z');
  });
});
