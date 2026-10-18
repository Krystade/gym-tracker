import { describe, expect, it } from 'vitest';
import { DEFAULT_PACE, estimateSeconds, paces, perSessionForMinutes, perSetSeconds, restAfter, restSeconds, sessionDay, sessionMinutes, suggestTime, usualGap, usualMinutes } from './timing';
import type { SetEntry } from './types';
import type { Program } from './program';

let n = 0;
const at = (date: string, hhmm: string, exercise = 'Bench Press', timed = true): SetEntry => ({
  id: `x${n}`, date, seq: n++, exercise, setNo: n, weight: 100, reps: 10, flags: [], source: 'app',
  ...(timed && { loggedAt: new Date(`${date}T${hhmm}:00`).toISOString() }),
});

describe('paces', () => {
  it('learns per-lift set-to-set time and the switch between lifts, from timed sets only', () => {
    const day = ['18:00', '18:02', '18:04', '18:06'].map((t) => at('2026-09-28', t));
    // Three days that each switch from bench to curls 4 min after the last bench set.
    const switches = ['2026-09-28', '2026-09-29', '2026-09-30'].flatMap((d) => [at(d, '17:56'), at(d, '18:00', 'Cable Curl')]);
    const p = paces([...day, ...switches, at('2026-09-28', '23:00', 'Cable Curl', false)]);
    expect(perSetSeconds(p, 'Bench Press')).toBe(120);
    expect(p.transition).toBe(240);
    // Fewer than 3 samples: the default for the kind of lift.
    expect(perSetSeconds(p, 'Cable Curl')).toBe(DEFAULT_PACE.isolation);
    expect(perSetSeconds(p, 'Squat')).toBe(DEFAULT_PACE.compound);
  });
  it('rests for the lift’s learned set-to-set time, or 2:00 without one', () => {
    // A set every 2:30.
    const p = paces([0, 1, 2, 3].map((i) => ({ ...at('2026-09-28', '18:00'), loggedAt: new Date(Date.parse('2026-09-28T18:00:00') + i * 150_000).toISOString() })));
    expect(restSeconds(p, 'Bench Press')).toBe(110); // a set every 2:30, less the set itself
    expect(restSeconds(p, 'Cable Curl')).toBe(120);
    expect(restSeconds(paces([]), 'Bench Press')).toBe(120); // not the 3 min a compound set is planned at
  });
  it('ignores gaps over 10 min within a lift and over 15 min between lifts', () => {
    const p = paces([at('2026-09-28', '18:00'), at('2026-09-28', '18:30'), at('2026-09-28', '19:00', 'Cable Curl')]);
    expect(p.transition).toBe(DEFAULT_PACE.transition);
  });
});

describe('estimates', () => {
  it('adds sets, switches between lifts and warm-ups', () => {
    const p = paces([]);
    // 3 bench (180 s) + 2 curls (120 s) + 1 switch (120 s) + 2 warm-ups (60 s)
    expect(estimateSeconds([{ exercise: 'Bench Press', sets: 3 }, { exercise: 'Cable Curl', sets: 2 }], p, (ex) => (ex === 'Bench Press' ? 2 : 0)))
      .toBe(3 * 180 + 2 * 120 + 120 + 2 * 60);
  });
  it('measures a session from first to last timed set plus one typical set', () => {
    const log = [at('2026-09-28', '18:00'), at('2026-09-28', '18:40', 'Cable Curl'), at('2026-09-28', '23:59', 'Cable Curl', false)];
    expect(sessionMinutes(log, '2026-09-28', paces([]))).toBe(42); // 40 min + 120 s curl
    expect(sessionMinutes([at('2026-09-28', '18:00')], '2026-09-28', paces([]))).toBeNull();
  });
  it('picks the most sets per session whose every day fits the minutes', () => {
    const build = (per: number): Program => ({ key: 'program', perSession: per, createdAt: '', days: [{ name: 'A', slots: [{ exercise: 'Bench Press', sets: per, repMin: 8, repMax: 12 }] }] });
    const est = (d: Program['days'][number]) => d.slots[0].sets * 3; // 3 min a set
    expect(perSessionForMinutes(45, build, est)).toBe(15);
    expect(perSessionForMinutes(10, build, est)).toBe(8); // floor
  });
});

describe('sessionDay', () => {
  const now = new Date('2026-10-02T00:20:00');
  it('stays on yesterday while its last timed set is under 3 hours old', () => {
    expect(sessionDay([at('2026-10-01', '23:40')], '2026-10-02', now)).toBe('2026-10-01');
  });
  it('moves to today once the last set is older than that', () => {
    expect(sessionDay([at('2026-10-01', '20:00')], '2026-10-02', now)).toBe('2026-10-02');
  });
  it('is today with no sets, a set today, or a set two days ago', () => {
    expect(sessionDay([], '2026-10-02', now)).toBe('2026-10-02');
    expect(sessionDay([at('2026-10-02', '00:10')], '2026-10-02', now)).toBe('2026-10-02');
    expect(sessionDay([at('2026-09-30', '23:50')], '2026-10-02', now)).toBe('2026-10-02');
  });
  it('ignores sets without a time', () => {
    expect(sessionDay([at('2026-10-01', '23:40', 'Bench Press', false)], '2026-10-02', now)).toBe('2026-10-02');
  });
});

describe('suggestTime', () => {
  const now = new Date('2026-09-28T20:00:00');
  it('suggests the middle of an unusually long gap', () => {
    const day = ['18:00', '18:02', '18:04', '18:14', '18:16'].map((t) => at('2026-09-28', t));
    expect(suggestTime(day, '2026-09-28', 'Bench Press', paces(day), now)).toBe('18:09');
  });
  it('otherwise one typical set after the last, but never after now', () => {
    const day = ['18:00', '18:02', '18:04'].map((t) => at('2026-09-28', t));
    expect(suggestTime(day, '2026-09-28', 'Bench Press', paces(day), now)).toBe('18:06');
    expect(suggestTime(day, '2026-09-28', 'Bench Press', paces(day), new Date('2026-09-28T18:05:00'))).toBe('18:05');
  });
  it('suggests nothing for a day without timed sets', () => {
    expect(suggestTime([at('2026-09-28', '18:00', 'Bench Press', false)], '2026-09-28', 'Bench Press', paces([]), now)).toBeNull();
  });
});

describe('warm-ups in a time estimate', () => {
  it('count once a session: only the first lift that warms up', () => {
    const p = { perSet: new Map<string, number>(), transition: 0 };
    const one = estimateSeconds([{ exercise: 'Bench Press', sets: 1 }], p, () => 1);
    const two = estimateSeconds([{ exercise: 'Bench Press', sets: 1 }, { exercise: 'Leg Press', sets: 1 }], p, () => 1);
    expect(two - one).toBe(perSetSeconds(p, 'Leg Press'));
  });
});

describe('usualMinutes', () => {
  // A day of sets from `start`, one every 3 minutes: n sets last (n - 1) × 3 min plus one set.
  const day = (date: string, n: number) => Array.from({ length: n }, (_, i) => at(date, `18:${String(i * 3).padStart(2, '0')}`));
  const TODAY = '2026-10-17';
  it('is the median of the last 8 weeks’ timed sessions, today and older days left out', () => {
    const log = [...day('2026-10-01', 11), ...day('2026-10-05', 16), ...day('2026-10-09', 6), ...day('2026-10-17', 20), ...day('2026-07-01', 20)];
    const p = paces(log);
    const mins = ['2026-10-01', '2026-10-05', '2026-10-09'].map((d) => sessionMinutes(log, d, p)!).sort((a, b) => a - b);
    expect(usualMinutes(log, TODAY, p)).toBe(mins[1]);
    expect(mins[1]).not.toBe(sessionMinutes(log, '2026-10-17', p));
  });
  it('is 45 with fewer than 3 timed sessions, and keeps to 15–120', () => {
    const two = [...day('2026-10-01', 11), ...day('2026-10-05', 16)];
    expect(usualMinutes(two, TODAY, paces(two))).toBe(45);
    const short = ['2026-10-01', '2026-10-03', '2026-10-05'].flatMap((d) => day(d, 2));
    expect(usualMinutes(short, TODAY, paces(short))).toBe(15);
  });
});

describe('supersets in the pace', () => {
  // Seconds after 18:00 on `date`, one set each.
  const t = (date: string, s: number, exercise: string): SetEntry => ({ ...at(date, '18:00', exercise), loggedAt: new Date(Date.parse(`${date}T18:00:00`) + s * 1000).toISOString() });
  // Three days of straight sets: bench every 2:30, then 4:00 to squats.
  const straight = ['2026-09-21', '2026-09-22', '2026-09-23'].flatMap((d) => [...[0, 150, 300, 450].map((s) => t(d, s, 'Bench Press')), t(d, 690, 'Squat')]);
  // Three days of curls and pushdowns as a superset, 70 s from one to the other and 2:30 rest after the round. The third
  // round goes pushdown first, so a pushdown follows a pushdown across the round's rest.
  const superset = ['2026-09-24', '2026-09-25', '2026-09-26'].flatMap((d) => [
    t(d, 0, 'Cable Curl'), t(d, 70, 'Cable Pushdown'), t(d, 220, 'Cable Curl'), t(d, 290, 'Cable Pushdown'), t(d, 440, 'Cable Pushdown'), t(d, 510, 'Cable Curl'),
  ]);

  it('leaves a superset’s gaps out of each lift’s rest and the switch between lifts, and learns its switch apart', () => {
    const before = paces(straight), p = paces([...straight, ...superset]);
    expect(p.transition).toBe(240);
    expect(p.transition).toBe(before.transition);
    expect(p.perSet).toEqual(before.perSet);
    expect(restSeconds(p, 'Cable Pushdown')).toBe(120); // the round's rest isn't the pushdown's own
    expect(restSeconds(p, 'Bench Press')).toBe(110);
    expect(p.superSwitch).toBe(70);
    expect(before.superSwitch).toBeUndefined();
  });

  it('learns no switch from a warm-up on the way to the next lift', () => {
    // Each switch to the pushdown goes through a warm-up set of it first.
    const warm = (d: string, s: number) => ({ ...t(d, s, 'Cable Pushdown'), flags: ['warmup' as const] });
    const days = ['2026-09-24', '2026-09-25', '2026-09-26'].flatMap((d) => [
      t(d, 0, 'Cable Curl'), warm(d, 20), t(d, 60, 'Cable Pushdown'), t(d, 210, 'Cable Curl'), warm(d, 230), t(d, 280, 'Cable Pushdown'),
    ]);
    expect(paces(days).superSwitch).toBeUndefined();
    // Two switches are too few to go by.
    expect(paces(superset.slice(0, 4)).superSwitch).toBeUndefined();
  });

  it('counts two lifts alternated with a full rest each way as plain switches', () => {
    const alt = ['2026-09-24', '2026-09-25', '2026-09-26'].flatMap((d) => [t(d, 0, 'Cable Curl'), t(d, 150, 'Cable Pushdown'), t(d, 300, 'Cable Curl')]);
    const p = paces(alt);
    expect(p.transition).toBe(150);
    expect(p.superSwitch).toBeUndefined();
  });

  it('runs a short switch after a lift with another to go in the round, the lift’s full rest after the last', () => {
    const none = paces(straight), learned = paces([...straight, ...superset]);
    expect(restAfter(none, 'Cable Curl', 'Cable Pushdown')).toEqual({ seconds: 20, switchTo: 'Cable Pushdown' });
    expect(restAfter(learned, 'Cable Curl', 'Cable Pushdown')).toEqual({ seconds: 30, switchTo: 'Cable Pushdown' }); // 70 s less the set
    expect(restAfter(learned, 'Cable Pushdown', null)).toEqual({ seconds: 120 });
    expect(restAfter(learned, 'Bench Press', null)).toEqual({ seconds: 110 });
    expect(restAfter(learned, 'Bench Press', undefined)).toEqual({ seconds: 110 });
  });

  it('measures "well inside the rest" against the lift’s usual time between sets', () => {
    const p = paces(straight);
    expect(usualGap(p, 'Bench Press')).toBe(150);
    expect(usualGap(p, 'Cable Curl')).toBe(160); // 2:00 rest and the set
  });
});
