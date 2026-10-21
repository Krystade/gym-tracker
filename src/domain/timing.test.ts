import { describe, expect, it } from 'vitest';
import { DEFAULT_PACE, planSeconds, restFor, paces, switchFor, perSessionForMinutes, perSetSeconds, restAfter, restSeconds, sessionDay, sessionMinutes, SET_WORK, stepsLeft, stepsOf, suggestTime, usualMinutes } from './timing';
import { coldGaps, gapModel } from './learn/switch';
import { supersets } from './superset';
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
    expect(restAfter(coldGaps(), 'Bench Press', null)).toEqual({ seconds: 180 }); // a compound (owner, 2026-10-19)
    expect(restSeconds('Bench Press')).toBe(180);
    expect(restSeconds('Cable Curl')).toBe(120);
  });
  it('ignores gaps over 10 min within a lift and over 15 min between lifts', () => {
    const p = paces([at('2026-09-28', '18:00'), at('2026-09-28', '18:30'), at('2026-09-28', '19:00', 'Cable Curl')]);
    expect(p.transition).toBe(DEFAULT_PACE.transition);
  });
});

describe('plan length (prescribed: the timer’s rests, not his habit)', () => {
  it('is the first set, then each set’s prescribed rest before it and the set: one rest fewer than sets, none counted twice', () => {
    // 3 bench, 2 curls: 40 + 2 × (180 + 40) [bench to bench] + (180 + 40) [bench to curls] + (120 + 40) [curl to curl].
    const steps = stepsOf([{ exercise: 'Bench Press', sets: 3 }, { exercise: 'Cable Curl', sets: 2 }]);
    expect(planSeconds(steps)).toBe(SET_WORK + 2 * (180 + SET_WORK) + (180 + SET_WORK) + (120 + SET_WORK));
    // His ±30 s setting for a lift is the rest the timer gives: the plan sums that.
    expect(planSeconds(steps, { kept: (ex) => (ex === 'Bench Press' ? 240 : undefined) }) - planSeconds(steps)).toBe(3 * 60);
    // What a switch costs him (learn/session) goes in once per switch.
    expect(planSeconds(steps, { overhead: 50 }) - planSeconds(steps)).toBe(50);
  });
  it('a warm-up rests its own 60/90 s; only the first lift that warms up does', () => {
    const steps = stepsOf([{ exercise: 'Bench Press', sets: 2 }, { exercise: 'Leg Press', sets: 1 }], () => 1);
    expect(steps.map((s) => `${s.exercise}${s.warmup ? ' w' : ''}`)).toEqual(['Bench Press w', 'Bench Press', 'Bench Press', 'Leg Press']);
    expect(planSeconds(steps)).toBe(SET_WORK + (90 + SET_WORK) + (180 + SET_WORK) + (180 + SET_WORK));
  });
  it('a cardio bout takes its minutes, and has no rest after it', () => {
    const steps = stepsOf([{ exercise: 'Bench Press', sets: 1 }, { exercise: 'Treadmill', sets: 1, minutes: 10 }, { exercise: 'Cable Curl', sets: 1 }]);
    expect(planSeconds(steps)).toBe(SET_WORK + (180 + 600) + SET_WORK);
  });
  it('what’s left: the lift going now first, then the plan’s order; warm-ups only for a lift not started', () => {
    const slots = [{ exercise: 'Bench Press', sets: 3 }, { exercise: 'Lat Pulldown', sets: 2 }, { exercise: 'Cable Curl', sets: 2 }];
    const done = (ex: string) => ({ 'Lat Pulldown': 1 } as Record<string, number>)[ex] ?? 0;
    expect(stepsLeft(slots, done, 'Lat Pulldown', (ex) => (ex === 'Bench Press' ? 1 : 0)).map((s) => `${s.exercise}${s.warmup ? ' w' : ''}`))
      .toEqual(['Lat Pulldown', 'Bench Press w', 'Bench Press', 'Bench Press', 'Bench Press', 'Cable Curl', 'Cable Curl']);
    expect(stepsLeft(slots, (ex) => (ex === 'Bench Press' ? 3 : 0), 'Bench Press', () => 1).map((s) => s.exercise)).toEqual(['Lat Pulldown', 'Lat Pulldown', 'Cable Curl', 'Cable Curl']);
  });
  it('measures a session from the start of its first timed set to its last: what the forecast predicts', () => {
    const log = [at('2026-09-28', '18:00'), at('2026-09-28', '18:40', 'Cable Curl'), at('2026-09-28', '23:59', 'Cable Curl', false)];
    expect(sessionMinutes(log, '2026-09-28')).toBe(41); // 40 min and the first set's 40 s
    expect(sessionMinutes([at('2026-09-28', '18:00')], '2026-09-28')).toBeNull();
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

describe('usualMinutes', () => {
  // A day of sets from `start`, one every 3 minutes: n sets last (n - 1) × 3 min and the first set.
  const day = (date: string, n: number) => Array.from({ length: n }, (_, i) => at(date, `18:${String(i * 3).padStart(2, '0')}`));
  const TODAY = '2026-10-17';
  it('is the median of the last 8 weeks’ timed sessions, today and older days left out', () => {
    const log = [...day('2026-10-01', 11), ...day('2026-10-05', 16), ...day('2026-10-09', 6), ...day('2026-10-17', 20), ...day('2026-07-01', 20)];
    const mins = ['2026-10-01', '2026-10-05', '2026-10-09'].map((d) => sessionMinutes(log, d)!).sort((a, b) => a - b);
    expect(usualMinutes(log, TODAY)).toBe(mins[1]);
    expect(mins[1]).not.toBe(sessionMinutes(log, '2026-10-17'));
  });
  it('is 45 with fewer than 3 timed sessions, and keeps to 15–120', () => {
    const two = [...day('2026-10-01', 11), ...day('2026-10-05', 16)];
    expect(usualMinutes(two, TODAY)).toBe(45);
    const short = ['2026-10-01', '2026-10-03', '2026-10-05'].flatMap((d) => day(d, 2));
    expect(usualMinutes(short, TODAY)).toBe(15);
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
    // The switch is learned apart (learn/switch): 70 s, a little short of it from the trials' prior.
    const m = gapModel([...straight, ...superset], '2026-09-27');
    expect(m.switches).toBeGreaterThan(5);
    expect(m.switchSeconds('Cable Curl', 'Cable Pushdown')).toBeGreaterThan(60);
    expect(m.switchSeconds('Cable Curl', 'Cable Pushdown')).toBeLessThanOrEqual(70);
    expect(gapModel(straight, '2026-09-27').switches).toBe(0);
  });

  it('times a switch from working set to working set, a warm-up on the way inside it', () => {
    // Each switch to the pushdown goes through a warm-up set of it first.
    const warm = (d: string, s: number) => ({ ...t(d, s, 'Cable Pushdown'), flags: ['warmup' as const] });
    const days = ['2026-09-24', '2026-09-25', '2026-09-26'].flatMap((d) => [
      t(d, 0, 'Cable Curl'), warm(d, 20), t(d, 60, 'Cable Pushdown'), t(d, 210, 'Cable Curl'), warm(d, 230), t(d, 280, 'Cable Pushdown'),
    ]);
    const m = gapModel(days, '2026-09-27');
    expect(m.switches).toBeGreaterThan(2);
    expect(m.switchSeconds('Cable Curl', 'Cable Pushdown')).toBeGreaterThan(50); // the 60 s, not the warm-up's 20 or 40
  });

  it('counts two lifts alternated with a full rest each way as plain switches', () => {
    const alt = ['2026-09-24', '2026-09-25', '2026-09-26'].flatMap((d) => [t(d, 0, 'Cable Curl'), t(d, 150, 'Cable Pushdown'), t(d, 300, 'Cable Curl')]);
    const p = paces(alt);
    expect(p.transition).toBe(150);
    // Nothing tells its gaps apart: never over even odds, on any of the days.
    const m = gapModel(alt, '2026-09-27');
    for (const d of ['2026-09-24', '2026-09-25', '2026-09-26']) expect(supersets(alt, d, m)).toEqual([]);
  });

  it('runs a short switch after a lift with another to go in the round, the lift’s full rest after the last', () => {
    const none = gapModel(straight, '2026-09-27'), learned = gapModel([...straight, ...superset], '2026-09-27');
    expect(restAfter(none, 'Cable Curl', 'Cable Pushdown')).toEqual({ seconds: 5, switchTo: 'Cable Pushdown' }); // the trials' 0:45, less the set
    const sw = restAfter(learned, 'Cable Curl', 'Cable Pushdown');
    expect(sw.switchTo).toBe('Cable Pushdown');
    expect(sw.seconds).toBeGreaterThan(20); // his 70 s, less the set: toward 0:30
    expect(sw.seconds).toBeLessThanOrEqual(30);
    expect(restAfter(learned, 'Cable Pushdown', null)).toEqual({ seconds: 120 });
    expect(restAfter(learned, 'Bench Press', null)).toEqual({ seconds: 180 });
    expect(restAfter(learned, 'Bench Press', undefined)).toEqual({ seconds: 180 });
  });

  it('reads a lift’s rest from his own gaps, else research’s rest and the set', () => {
    const m = gapModel(straight, '2026-09-27');
    expect(Math.exp(m.rest('Bench Press').mean)).toBeGreaterThan(145); // his 150 s, pulled a little toward 3:40
    expect(Math.exp(m.rest('Bench Press').mean)).toBeLessThan(160);
    expect(Math.exp(coldGaps().rest('Cable Curl').mean)).toBeCloseTo(160, 6); // 2:00 rest and the set
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
    const p = paces(habit), m = gapModel(habit, '2026-10-06');
    expect(restAfter(m, 'Cable Pushdown', null)).toEqual({ seconds: 120 });
    expect(restAfter(m, 'Bench Press', null)).toEqual({ seconds: 180 });
    expect(restFor(set('Cable Pushdown', 50, 12)).seconds).toBe(120);
    expect(restFor(set('Bench Press', 135, 8)).seconds).toBe(180);
    // The instrument: the gaps were learned, as paces (estimates go by them).
    expect(perSetSeconds(p, 'Cable Pushdown')).toBe(395);
    expect(perSetSeconds(p, 'Bench Press')).toBe(390);
  });
  it('is his own setting, from the timer’s ±30 s, where he has kept one; a superset’s switch is still the switch', () => {
    const p = gapModel(habit, '2026-10-06');
    expect(restSeconds('Cable Pushdown', 90)).toBe(90);
    expect(restSeconds('Cable Pushdown', 210)).toBe(210);
    expect(restAfter(p, 'Cable Pushdown', null, 90)).toEqual({ seconds: 90 });
    expect(restAfter(p, 'Cable Pushdown', 'Cable Curl', 90)).toEqual({ seconds: 5, switchTo: 'Cable Curl' });
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
  it('a superset’s switch: his (else the trials’), less the set, never under 0', () => {
    const A = 'Cable Curl', B = 'Cable Pushdown';
    expect(switchFor(coldGaps(), A, B)).toEqual({ seconds: 5, parts: [
      { what: 'Switch in trials', s: 45, note: 'trials go straight on, set included' }, { what: 'Less the set itself', s: -40, add: true }] });
    // His pair, 1:15 a switch: his line, from how many.
    const round = (d: string, g: number) => [0, g, g + 150, 2 * g + 150].map((s, i) => ({ ...at(d, '18:00', i % 2 ? B : A), loggedAt: new Date(Date.parse(`${d}T18:00:00`) + s * 1000).toISOString() }));
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    const slow = switchFor(gapModel(days.flatMap((d) => round(d, 75)), '2026-10-09'), A, B);
    expect(slow.parts[0]).toMatchObject({ what: 'Your switch', note: 'from 8 timed, set included' });
    expect(sum(slow)).toBe(slow.seconds);
    // A pair he goes straight from (25 s with the set): 0:00, the floor's line making up the sum.
    const quick = switchFor(gapModel(days.flatMap((d) => round(d, 25)), '2026-10-09'), A, B);
    expect(quick.seconds).toBe(0);
    expect(quick.parts.at(-1)?.what).toBe('At least 0:00');
    expect(sum(quick)).toBe(0);
    // Another pair of his: like his other switches.
    expect(switchFor(gapModel(days.flatMap((d) => round(d, 75)), '2026-10-09'), A, 'Face Pull').parts[0].note).toBe('like your other switches, set included');
  });
});
