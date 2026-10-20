import { describe, expect, it } from 'vitest';
import { DEFAULT_PACE, estimateSeconds, restFor, paces, switchFor, perSessionForMinutes, perSetSeconds, restAfter, restSeconds, sessionDay, sessionMinutes, suggestTime, usualGap, usualMinutes } from './timing';
import type { SetEntry } from './types';
import type { Program } from './program';

let n = 0;
const at = (date: string, hhmm: string, exercise = 'Bench Press', timed = true): SetEntry => ({
  id: `x${n}`, date, seq: n++, exercise, setNo: n, weight: 100, reps: 10, flags: [], source: 'app',
  ...(timed && { loggedAt: new Date(`${date}T${hhmm}:00`).toISOString() }),
});

const set = (exercise: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry => ({ ...at('2026-10-19', '18:00', exercise), weight, reps, ...over });

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
  it('rests 2:00 / 3:00 however long the lift’s sets have been apart: the pace is learned, the rest is not', () => {
    // A set every 2:30: five gaps.
    const p = paces([0, 1, 2, 3, 4, 5].map((i) => ({ ...at('2026-09-28', '18:00'), loggedAt: new Date(Date.parse('2026-09-28T18:00:00') + i * 150_000).toISOString() })));
    expect(perSetSeconds(p, 'Bench Press')).toBe(150);
    expect(restAfter(p, 'Bench Press', null)).toEqual({ seconds: 180 }); // a compound (owner, 2026-10-19)
    expect(restSeconds('Bench Press')).toBe(180);
    expect(restSeconds('Cable Curl')).toBe(120);
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
    expect(restAfter(learned, 'Bench Press', null)).toEqual({ seconds: 180 });
    expect(restAfter(learned, 'Bench Press', undefined)).toEqual({ seconds: 180 });
  });

  it('measures "well inside the rest" against the lift’s usual time between sets', () => {
    const p = paces(straight);
    expect(usualGap(p, 'Bench Press')).toBe(150);
    expect(usualGap(p, 'Cable Curl')).toBe(160); // 2:00 rest and the set
  });
});

describe('the rest timer’s base (owner, 2026-10-20: prescribe from the evidence, don’t copy the habit)', () => {
  // `gaps` seconds apart on `date`, from 18:00.
  const run = (date: string, gaps: number[], exercise = 'Cable Pushdown'): SetEntry[] => {
    let s = 0;
    return [0, ...gaps].map((g) => { s += g; return { ...at(date, '18:00', exercise), loggedAt: new Date(Date.parse(`${date}T18:00:00`) + s * 1000).toISOString() }; });
  };
  // His real gaps: 5:00 – 7:30 between sets, 10 of them on the pushdown over two days, 5 on the bench.
  const habit = [...run('2026-10-01', [300, 360, 420, 450, 390]), ...run('2026-10-03', [330, 400, 450, 300, 420]), ...run('2026-10-05', [360, 420, 450, 390, 330], 'Bench Press')];
  it('is the research default whatever his gaps have been: 2:00 a small lift, 3:00 a big one', () => {
    const p = paces(habit);
    expect(restAfter(p, 'Cable Pushdown', null)).toEqual({ seconds: 120 });
    expect(restAfter(p, 'Bench Press', null)).toEqual({ seconds: 180 });
    expect(restFor(set('Cable Pushdown', 50, 12)).seconds).toBe(120);
    expect(restFor(set('Bench Press', 135, 8)).seconds).toBe(180);
    // The instrument: the gaps were learned, as paces (estimates go by them).
    expect(perSetSeconds(p, 'Cable Pushdown')).toBe(395);
    expect(perSetSeconds(p, 'Bench Press')).toBe(390);
  });
  it('is his own setting, from the timer’s ±30 s, where he has kept one; a superset’s switch is still the switch', () => {
    const p = paces(habit);
    expect(restSeconds('Cable Pushdown', 90)).toBe(90);
    expect(restSeconds('Cable Pushdown', 210)).toBe(210);
    expect(restAfter(p, 'Cable Pushdown', null, 90)).toEqual({ seconds: 90 });
    expect(restAfter(p, 'Cable Pushdown', 'Cable Curl', 90)).toEqual({ seconds: 20, switchTo: 'Cable Curl' });
    expect(restFor(set('Bench Press', 135, 8), { kept: 150 })).toMatchObject({ seconds: 150, why: { base: 150, from: 'kept' } });
  });
});

describe('restFor: the rest after a set, from the lift’s base and the set’s effort (owner, 2026-10-19)', () => {
  it('starts from the base: kept, else 2:00 isolation / 3:00 compound', () => {
    expect(restFor(set('Cable Curl', 50, 12)).seconds).toBe(120);
    expect(restFor(set('Bench Press', 135, 8)).seconds).toBe(180);
    expect(restFor(set('Bench Press', 135, 8), { kept: 150 })).toMatchObject({ seconds: 150, why: { base: 150, from: 'kept' } });
  });
  it('adds 30 s after a set at RIR 0, takes 30 s off at RIR 3 or more, nothing at 1–2 or unknown', () => {
    const r = (rir?: number) => restFor(set('Bench Press', 135, 8, rir == null ? {} : { rir })).seconds;
    expect([r(0), r(1), r(2), r(3), r(4), r()]).toEqual([210, 180, 180, 150, 150, 180]);
  });
  it('rests a heavy set and a light one the same: no evidence that load changes the rest (80 % and 50 % of 1RM alike)', () => {
    for (const [w, reps] of [[195, 1], [170, 3], [150, 5], [110, 10], [60, 20]]) {
      expect(restFor(set('Bench Press', w, reps)).seconds, `${w} × ${reps}`).toBe(180);
      expect(restFor(set('Bench Press', w, reps)).parts.map((x) => x.what), `${w} × ${reps}`).toEqual(['Research default']);
    }
    expect(restFor(set('Bench Press', 190, 3, { rir: 0 })).why).toEqual({ base: 180, from: 'default', effort: 30 });
  });
  it('rests a warm-up 60 s (isolation) or 90 s (compound), whatever the base and effort', () => {
    expect(restFor(set('Bench Press', 75, 5, { flags: ['warmup'], rir: 0 }), { kept: 240 }).seconds).toBe(90);
    expect(restFor(set('Cable Curl', 20, 10, { flags: ['warmup'] })).seconds).toBe(60);
  });
  it('stays within 45 s and 5 min', () => {
    expect(restFor(set('Cable Curl', 20, 15, { rir: 4 }), { kept: 50 }).seconds).toBe(45);
    expect(restFor(set('Bench Press', 190, 3, { rir: 0 }), { kept: 290 }).seconds).toBe(300);
  });
});

describe('why a rest is its length: restFor’s and switchFor’s parts, line by line', () => {
  const none = paces([]);
  const sum = (r: { parts: { s: number }[] }) => r.parts.reduce((a, x) => a + x.s, 0);
  it('a working set: his setting, what research suggests where it differs, then what effort added, adding up to the rest', () => {
    const r = restFor(set('Bench Press', 164, 5, { rir: 0 }), { kept: 150 });
    expect(r.seconds).toBe(180);
    expect(r.parts).toEqual([
      { what: 'Your setting', s: 150, note: 'Research suggests 3:00' },
      { what: 'RIR 0', s: 30, add: true },
    ]);
    expect(restFor(set('Cable Curl', 40, 12), { kept: 180 }).parts).toEqual([{ what: 'Your setting', s: 180, note: 'Research suggests 2:00' }]);
    // The same as research: nothing to add.
    expect(restFor(set('Bench Press', 135, 8), { kept: 180 }).parts).toEqual([{ what: 'Your setting', s: 180 }]);
  });
  it('names the research default by the size of the lift, however long his sets have been apart, and an easy set', () => {
    const curls = ['18:00', '18:06', '18:12', '18:18', '18:24', '18:30'].map((t) => at('2026-10-01', t, 'Cable Curl'));
    expect(perSetSeconds(paces(curls), 'Cable Curl')).toBe(360); // the instrument: 6:00 apart, learned
    expect(restFor(set('Cable Curl', 40, 12)).parts).toEqual([{ what: 'Research default', s: 120, note: 'small lift' }]);
    expect(restFor(set('Bench Press', 135, 8)).parts).toEqual([{ what: 'Research default', s: 180, note: 'big lift' }]);
    const r = restFor(set('Cable Curl', 30, 15, { rir: 4 }));
    expect(r.parts).toEqual([
      { what: 'Research default', s: 120, note: 'small lift' },
      { what: 'RIR 4', s: -30, add: true },
    ]);
    expect(r.seconds).toBe(90);
  });
  it('says what nothing moved: no line for RIR 1–2 or an unlogged RIR', () => {
    expect(restFor(set('Bench Press', 150, 5, { rir: 2 })).parts.map((x) => x.what)).toEqual(['Research default']);
  });
  it('a warm-up is one line, its fixed rest', () => {
    expect(restFor(set('Bench Press', 75, 5, { flags: ['warmup'], rir: 0 }), { kept: 240 }).parts).toEqual([{ what: 'Warm-up', s: 90, note: 'compound lift' }]);
    expect(restFor(set('Cable Curl', 20, 10, { flags: ['warmup'] })).parts).toEqual([{ what: 'Warm-up', s: 60, note: 'isolation lift' }]);
  });
  it('the 0:45 – 5:00 bounds are a line of their own', () => {
    const lo = restFor(set('Cable Curl', 20, 15, { rir: 4 }), { kept: 50 });
    expect(lo.parts.at(-1)).toEqual({ what: 'At least 0:45', s: 25, add: true });
    const hi = restFor(set('Bench Press', 190, 3, { rir: 0 }), { kept: 290 });
    expect(hi.parts.at(-1)).toEqual({ what: 'At most 5:00', s: -20, add: true });
    expect(restFor(set('Bench Press', 190, 3, { rir: 0 }), { kept: 270 }).parts.some((x) => x.what.startsWith('At'))).toBe(false); // 300 exactly
  });
  it('the parts always add up to the rest', () => {
    for (const kept of [undefined, 30, 100, 290, 600]) for (const rir of [undefined, 0, 1, 3]) for (const w of [20, 100, 150, 195]) for (const warmup of [false, true]) {
      const r = restFor(set('Bench Press', w, 5, { ...(rir != null && { rir }), ...(warmup && { flags: ['warmup'] }) }), { kept });
      expect(sum(r), JSON.stringify({ kept, rir, w, warmup })).toBe(r.seconds);
    }
  });
  it('a superset’s switch: learned less the set, else the default', () => {
    expect(switchFor(none)).toEqual({ seconds: 20, parts: [{ what: 'Superset switch', s: 20, note: 'default until 3 switches are timed' }] });
    expect(switchFor({ perSet: new Map(), transition: 120, superSwitch: 75 })).toEqual({ seconds: 35, parts: [{ what: 'Superset switch', s: 35, note: 'your usual switch, less the set itself' }] });
    expect(switchFor({ perSet: new Map(), transition: 120, superSwitch: 30 }).seconds).toBe(10);
  });
});
