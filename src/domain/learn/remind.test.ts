import { describe, expect, it } from 'vitest';
import { addDays } from '../analytics';
import { normCdf, rng } from './num';
import { bandwidth, firstMinute, fitReminder, hhmm, startsOf, wallClock } from './remind';
import { atLocal, day, simulate, type Truth } from './remindSim.sample';

// Item 16 on synthetic calendars with known truth (remindSim.sample). Every bar here is the test's own number.

const MON = '2026-01-05'; // a Monday
const min = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const at = (x: number | 'off' | null) => (typeof x === 'number' ? x : NaN);
/** The minute z SDs above a normal's mean where S = P(start > t) equals s. */
function normalSurvivalPoint(mu: number, sd: number, s: number): number {
  let lo = mu - 6 * sd, hi = mu + 6 * sd;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (1 - normCdf((m - mu) / sd) > s) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const steady = (p: number[], mu = 19 * 60, sd = 30): Truth => ({ p, start: (_wd, r) => r.normal(mu, sd) });
//                      Sun  Mon  Tue  Wed  Thu  Fri  Sat
const MWF = [0.05, 0.9, 0.05, 0.9, 0.05, 0.9, 0.05];

describe('which weekdays are his', () => {
  it('learns his days from dated training alone (imports have no times): the others are off, his own keep his time', () => {
    const log = simulate({ p: MWF, start: () => null }, MON, 30, 1);
    const today = addDays(MON, 7 * 30);
    const f = fitReminder(log, today, 'UTC');
    expect(f.dates).toBeGreaterThan(60);
    expect(f.timed).toBe(0);
    expect(f.schedule).toEqual(['off', null, 'off', null, 'off', null, 'off']);
    for (const d of [1, 3, 5]) expect(f.days[d].p).toBeGreaterThan(0.75);
    for (const d of [0, 2, 4, 6]) expect(f.days[d].p).toBeLessThan(0.25);
  });

  it('no log, no change: even odds on a routine and on every day, and nothing learned', () => {
    const f = fitReminder([], '2026-03-02', 'UTC');
    expect(f.schedule).toEqual([null, null, null, null, null, null, null]);
    expect(f.routine).toBe(0.5);
    for (const d of f.days) { expect(d.pOff).toBe(0.25); expect(d.p).toBeCloseTo(0.5, 12); }
  });

  it('a trainer with no fixed days keeps every day he picked; the same rate on fixed days is a routine', () => {
    let off = 0;
    for (const seed of [31, 32, 33, 34]) {
      const f = fitReminder(simulate({ p: [2 / 7, 2 / 7, 2 / 7, 2 / 7, 2 / 7, 2 / 7, 2 / 7], start: () => null }, MON, 40, seed), addDays(MON, 280), 'UTC');
      expect(f.routine).toBeLessThan(0.5);
      off += f.schedule.filter((x) => x === 'off').length;
    }
    expect(off).toBe(0);
    // Two fixed days a week, the same sessions a week: Tuesday and Friday kept, the rest off.
    const fixed = fitReminder(simulate({ p: [0.02, 0.02, 0.95, 0.02, 0.02, 0.95, 0.02], start: () => null }, MON, 40, 35), addDays(MON, 280), 'UTC');
    expect(fixed.routine).toBeGreaterThan(0.99);
    expect(fixed.schedule).toEqual(['off', 'off', null, 'off', 'off', null, 'off']);
  });

  it('a weekday never seen is never off, and two weeks cannot show a routine either way', () => {
    // Wednesday of the first week only, asked on Thursday: Thursday..Sunday never seen.
    const one = day('2026-01-07', null);
    const f = fitReminder(one, '2026-01-08', 'UTC');
    for (const d of [4, 5, 6, 0]) { expect(f.days[d].weeks).toBe(0); expect(f.schedule[d]).toBeNull(); }
    expect(f.days[3].p).toBeGreaterThan(0.5);
    for (const d of [4, 5, 6, 0]) expect(f.days[d].pOff).toBeLessThanOrEqual(0.5);
    // Monday trained one week and not the other: the more recent week leans it, but no routine is shown yet, so no change.
    const was = fitReminder([...day('2026-01-05', null), ...day('2026-01-14', null)], '2026-01-19', 'UTC');
    const now = fitReminder([...day('2026-01-04', null), ...day('2026-01-07', null), ...day('2026-01-12', null)], '2026-01-19', 'UTC');
    expect(was.days[1]).toMatchObject({ weeks: 2, trained: 1 });
    expect(now.days[1]).toMatchObject({ weeks: 2, trained: 1 });
    expect(was.days[1].p).toBeLessThan(now.days[1].p);
    expect(was.schedule).not.toContain('off');
    expect(now.schedule).not.toContain('off');
  });

  it('a layoff does not switch his days off: it only widens what is known', () => {
    const truth = { p: MWF, start: () => null };
    const base = simulate(truth, MON, 20, 2);
    const today = addDays(MON, 7 * 20);
    const now = fitReminder(base, today, 'UTC');
    const later = fitReminder(base, addDays(today, 180), 'UTC');
    expect(later.schedule).toEqual(now.schedule);
    for (const d of [1, 3, 5]) {
      expect(later.days[d].sd).toBeGreaterThan(now.days[d].sd);
      expect(later.days[d].p).toBeLessThan(now.days[d].p);
      expect(later.days[d].p).toBeGreaterThan(0.5);
    }
  });
});

describe('when he starts', () => {
  it('waits until he is more likely missing the day than late: the analytic point of a known normal start', () => {
    const p = [0.05, 0.9, 0.05, 0.9, 0.05, 0.9, 0.05];
    const errs: number[] = [];
    for (const seed of [3, 4, 5]) {
      const log = simulate(steady(p), MON, 40, seed);
      const f = fitReminder(log, addDays(MON, 7 * 40), 'UTC');
      for (const d of [1, 3, 5]) {
        // Truth: S(T*) = (1 − p)/p for p = 0.9 and N(19:00, 30): 19:37.
        errs.push(at(f.days[d].at) - normalSurvivalPoint(19 * 60, 30, 0.1 / 0.9));
        expect(at(f.days[d].at)).toBeGreaterThan(19 * 60); // after his usual start
        expect(at(f.days[d].at)).toBeLessThan(20 * 60 + 30);
      }
    }
    expect(errs).toHaveLength(9);
    // A tail quantile from ~36 sessions a weekday: its SE is about 7 min; a seed whose recent sessions favour a short half-life
    // has a wider kernel and leans later (seed 4: +27). The kernel's own width leans it a little later on average.
    for (const e of errs) expect(e).toBeGreaterThan(-20);
    for (const e of errs) expect(e).toBeLessThan(35);
    expect(Math.abs(errs.reduce((a, b) => a + b, 0) / errs.length)).toBeLessThan(12);
  });

  it('two habits on one weekday: it waits past the later one, not between them', () => {
    const p = [0.05, 0.05, 0.9, 0.05, 0.9, 0.05, 0.7];
    const truth: Truth = { p, start: (wd, r) => (wd === 6 ? (r.next() < 0.5 ? r.normal(9 * 60, 20) : r.normal(18 * 60, 20)) : r.normal(19 * 60, 20)) };
    const log = simulate(truth, MON, 40, 6);
    const f = fitReminder(log, addDays(MON, 7 * 40), 'UTC');
    // A normal fitted to Saturday (mean 13:30, SD ~4.5 h) would put it near 14:00-15:00 for p ≈ 0.7.
    expect(at(f.days[6].at)).toBeGreaterThan(17 * 60);
    expect(f.days[6].why).toBe('time');
  });

  it('pools partially: a weekday with one session leans on the rest; one with many stands on its own', () => {
    // Weekdays at 19:00; Saturdays at 10:00 for 30 weeks; one Thursday at 07:00.
    const p = [0, 0.9, 0, 0.9, 0, 0.9, 0.9];
    const truth: Truth = { p, start: (wd, r) => (wd === 6 ? r.normal(10 * 60, 20) : r.normal(19 * 60, 20)) };
    const log = [...simulate(truth, MON, 30, 7), ...day(addDays(MON, 7 * 30 + 3), 7 * 60)];
    const today = addDays(MON, 7 * 31);
    const f = fitReminder(log, today, 'UTC');
    expect(at(f.days[6].at)).toBeLessThan(12 * 60); // Saturday: its own mornings
    expect(at(f.days[1].at)).toBeGreaterThan(19 * 60);
    // Thursday's one 07:00 session: its time leaves it neither alone (07:00 + a little) nor ignored (as Monday).
    const s = (x: number, d: number) => f.survival(d, x);
    const own = 1 - normCdf((8 * 60 - 7 * 60) / f.bw!); // only its own session: past 08:00 with its kernel
    expect(s(8 * 60, 4)).toBeLessThan(s(8 * 60, 1)); // its 07:00 pulls it earlier than an all-evening day
    expect(s(8 * 60, 4)).toBeGreaterThan(own); // but the evenings still hold it up
  });

  it('follows a change of habit: evenings for months, then mornings for ten weeks', () => {
    const p = [0, 0.9, 0, 0.9, 0, 0.9, 0];
    const eve = simulate(steady(p, 19 * 60, 20), MON, 30, 10);
    const morn = simulate(steady(p, 7 * 60, 20), addDays(MON, 7 * 30), 10, 11);
    const f = fitReminder([...eve, ...morn], addDays(MON, 7 * 40), 'UTC');
    for (const d of [1, 3, 5]) expect(at(f.days[d].at)).toBeLessThan(12 * 60);
  });

  it('a long gap widens the kernel', () => {
    const log = simulate(steady([0, 0.9, 0, 0.9, 0, 0.9, 0]), MON, 30, 8);
    const today = addDays(MON, 7 * 30);
    const a = fitReminder(log, today, 'UTC'), b = fitReminder(log, addDays(today, 365), 'UTC');
    expect(b.bw!).toBeGreaterThan(a.bw! * 1.05);
  });

  it('times come from the first entry the app heard of: a late entry at its entry time, a back-fill on another day none', () => {
    const d1 = '2026-02-02', d2 = '2026-02-03';
    const late = day(d1, 19 * 60, 'UTC', { enteredAt: atLocal(d1, 20 * 60 + 30, 'UTC') }); // first set entered late at 20:30
    late[0].loggedAt = atLocal(d1, 18 * 60, 'UTC'); // its guessed time, earlier than its siblings
    const back = day(d2, null).map((e) => ({ ...e, loggedAt: atLocal(d2, 18 * 60, 'UTC'), enteredAt: atLocal(addDays(d2, 1), 9 * 60, 'UTC') }));
    const imp = day('2026-02-04', null);
    const s = startsOf([...late, ...back, ...imp], '2026-02-10', 'UTC');
    expect(s).toEqual([{ date: d1, min: 19 * 60 + 4 }, { date: d2, min: null }, { date: '2026-02-04', min: null }]);
  });

  it('reads wall-clock times in his zone across a DST change', () => {
    const NY = 'America/New_York';
    expect(wallClock('2026-03-07T23:00:00Z', NY)).toEqual({ date: '2026-03-07', min: 18 * 60 });
    expect(wallClock('2026-03-09T22:00:00Z', NY)).toEqual({ date: '2026-03-09', min: 18 * 60 });
    const log = [...day('2026-03-02', 18 * 60, NY), ...day('2026-03-04', 18 * 60, NY), ...day('2026-03-09', 18 * 60, NY), ...day('2026-03-11', 18 * 60, NY)];
    expect(startsOf(log, '2026-03-12', NY).map((x) => x.min)).toEqual([1080, 1080, 1080, 1080]);
    // Read in the wrong zone, the summer dates move by the offset change.
    expect(startsOf(log, '2026-03-12', 'UTC').map((x) => x.min)).toEqual([1380, 1380, 1320, 1320]);
  });

  it('a night owl usually still to come at midnight gets no reminder rather than one before his session', () => {
    const p = [0, 0.95, 0, 0.95, 0, 0.95, 0];
    const log = simulate({ p, start: (_wd, r) => Math.min(1439, r.normal(23 * 60 + 40, 25)) }, MON, 30, 9);
    const f = fitReminder(log, addDays(MON, 7 * 30), 'UTC');
    for (const d of [1, 3, 5]) expect(f.days[d]).toMatchObject({ at: 'off', why: 'late all day' });
  });
});

describe('the decision', () => {
  it('firstMinute: at even odds or below, from midnight; never before midnight, none', () => {
    expect(firstMinute(0.5, () => 1)).toBe(0);
    expect(firstMinute(0.9, () => 0.5)).toBeNull();
    expect(firstMinute(0.8, (t) => (t < 600 ? 1 : 0.24))).toBe(600); // p·S ≤ 1 − p ⇔ S ≤ 0.25
    expect(firstMinute(0.8, (t) => (t < 600 ? 1 : 0.26))).toBeNull();
  });

  it('bandwidth: Silverman on the faded count, none below two points', () => {
    expect(bandwidth([600], [1])).toBeNull();
    const xs = [0, 10, 20, 30, 40], ws = [1, 1, 1, 1, 1];
    const sd = Math.sqrt(200), iqr = 20;
    expect(bandwidth(xs, ws)).toBeCloseTo(0.9 * Math.min(sd, iqr / 1.34) * 5 ** -0.2, 9);
    // Fading every weight halves n: the kernel widens by 2^(1/5).
    expect(bandwidth(xs, ws.map(() => 0.5))! / bandwidth(xs, ws)!).toBeCloseTo(2 ** 0.2, 9);
  });

  it('in simulation: never a send the set time would not make, and most of what it sends is a missed day, not a late one', () => {
    //                 Sun   Mon  Tue   Wed  Thu   Fri  Sat
    const p = [0.05, 0.9, 0.05, 0.85, 0.05, 0.8, 0.3];
    const chosen = [1, 2, 3, 5]; // Tuesday picked but a rest day
    const set = 18 * 60;
    let fires = 0, late = 0, manualFires = 0, manualLate = 0, missed = 0, missedCaught = 0;
    for (const seed of [11, 12, 13, 14, 15]) {
      const log = simulate(steady(p), MON, 40, seed);
      const today = addDays(MON, 7 * 40);
      const f = fitReminder(log, today, 'UTC');
      expect(f.schedule[2]).toBe('off');
      const r = rng(seed + 100);
      for (let k = 0; k < 7 * 40; k++) {
        const date = addDays(today, k), wd = new Date(`${date}T00:00:00Z`).getUTCDay();
        const go = r.next() < p[wd], start = r.normal(19 * 60, 30);
        if (!chosen.includes(wd)) continue;
        const manual = !(go && start <= set);
        const l = f.schedule[wd];
        const t = l === 'off' ? null : l == null ? set : Math.max(set, min(l));
        const learned = t != null && !(go && start <= t);
        if (learned) expect(manual).toBe(true); // a subset of today's sends
        if (manual) { manualFires++; if (go) manualLate++; }
        if (learned) { fires++; if (go) late++; }
        if (!go && wd !== 2) { missed++; if (learned) missedCaught++; }
      }
    }
    expect(manualFires).toBeGreaterThan(300);
    expect(manualLate / manualFires).toBeGreaterThan(0.6); // today: mostly nags
    // Learned: at its time P(late | nothing yet) is 1/2 under the fit, so about half are nags; a time estimated with noise errs
    // toward more nags than it saves (the tail is convex), 0.57 over ten seeds. Today's: about nine in ten.
    expect(fires).toBeGreaterThan(100);
    expect(late / fires).toBeLessThan(0.6);
    expect(missedCaught).toBe(missed); // every missed day he picked still gets one
    expect(fires).toBeLessThan(manualFires / 2);
  });
});

describe('his own sets only', () => {
  it('ignores a set dated today or later (it is fitted on the days before, so it does not move while he trains)', () => {
    const log = simulate(steady([0, 0.9, 0, 0.9, 0, 0.9, 0]), MON, 20, 21);
    const today = addDays(MON, 7 * 20);
    const a = fitReminder(log, today, 'UTC');
    const b = fitReminder([...log, ...day(today, 6 * 60)], today, 'UTC');
    expect(b.schedule).toEqual(a.schedule);
    expect(hhmm(19 * 60 + 5)).toBe('19:05');
  });
});

