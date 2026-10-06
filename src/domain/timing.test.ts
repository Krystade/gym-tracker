import { describe, expect, it } from 'vitest';
import { DEFAULT_PACE, estimateSeconds, paces, perSessionForMinutes, perSetSeconds, sessionDay, sessionMinutes, suggestTime } from './timing';
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
