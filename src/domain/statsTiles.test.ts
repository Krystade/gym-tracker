import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import type { BodyDay } from './body';
import {
  balance, effort, energyVsLifts, familyOf, familyRates, fitTrend, hitRate, liftsInRotation, milestoneDate, pipOf, plateaus, prGroup, prTimeline,
  rateOfGain, rests, sessionsAWeek, strengthIndex, weekdayOf, whenTrained, type LiftState,
} from './statsTiles';
import { addDays, weeklySummary } from './analytics';
import { SET_WORK } from './timing';
import { tagsOf } from './learn/tags';

// Synthetic sets only. Today is Wed 21 Oct 2026; the 12-week range starts Thu 30 Jul.
const TODAY = '2026-10-21';
const FROM = '2026-07-30';
let n = 0;
const set = (exercise: string, date: string, o: Partial<SetEntry> = {}): SetEntry => {
  n++;
  return { id: `t|${date}|${exercise}|${n}`, date, seq: n, exercise, setNo: 1, weight: 100, reps: 8, flags: [], source: 't', ...o };
};
/** A time on `date` in UTC, so hours read the same in any time zone with `utcHour`. */
const utc = (date: string, hms: string) => `${date}T${hms}.000Z`;
const utcHour = (ms: number) => { const d = new Date(ms); return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600; };
/** Points `step` days apart from `start`, with these values. */
const pts = (start: string, step: number, vs: number[]) => vs.map((v, i) => ({ date: addDays(start, i * step), v }));

describe('fitTrend and rateOfGain: each lift’s pace per week, against its own level', () => {
  it('reads a straight line exactly: 1 lb a week on a lift around 102 lb is about 0.98 %/wk', () => {
    const f = fitTrend(pts('2026-09-01', 7, [100, 101, 102, 103, 104]))!;
    expect(f.n).toBe(5);
    expect(f.span).toBe(28);
    expect(f.slope).toBeCloseTo(1 / 7, 10);
    expect(f.se).toBeCloseTo(0, 10);
    expect(f.pct).toBeCloseTo(100 / 102, 6);
  });
  it('needs 4 sessions over 2 weeks or more', () => {
    expect(fitTrend(pts('2026-09-01', 7, [100, 101, 102]))).toBeNull();
    expect(fitTrend(pts('2026-09-01', 4, [100, 101, 102, 103]))).toBeNull(); // 12 days
    expect(fitTrend(pts('2026-09-01', 5, [100, 101, 102, 103]))).not.toBeNull(); // 15 days
  });
  it('ranks the lifts fastest first and gives the median of those with a rate', () => {
    const r = rateOfGain([
      { name: 'Barbell Squat', points: pts('2026-09-01', 7, [200, 202, 204, 206, 208]) },
      { name: 'Bench Press', points: pts('2026-09-01', 7, [150, 150, 150, 150, 150]) },
      { name: 'Barbell Row', points: pts('2026-09-01', 7, [100, 99, 98, 97, 96]) },
      { name: 'Too New', points: pts('2026-10-14', 7, [50, 52]) },
    ]);
    expect(r.rows.map((x) => x.name)).toEqual(['Barbell Squat', 'Bench Press', 'Barbell Row']);
    expect(r.rows[0].pct).toBeCloseTo((100 * 2) / 204, 6);
    expect(r.rows[1].pct).toBeCloseTo(0, 10);
    expect(r.rows[2].pct).toBeCloseTo(-100 / 98, 6);
    expect(r.median).toBeCloseTo(0, 10);
    expect(rateOfGain([{ name: 'Too New', points: pts('2026-10-14', 7, [50, 52]) }])).toEqual({ rows: [], median: null });
  });
  it('groups lifts by their movement, each family at its lifts’ median, fastest first', () => {
    expect(familyOf('Bench Press')).toBe('Horizontal press');
    expect(familyOf('Barbell Squat')).toBe('Squat');
    expect(familyOf('Cable Curl')).toBe('Curl');
    expect(familyOf('Mystery Move')).toBeNull();
    expect(tagsOf('Neck Curl').move).toBe('other'); // a movement of its own kind: no family
    expect(familyOf('Neck Curl')).toBeNull();
    const f = familyRates([
      { name: 'Bench Press', pct: 0.2 }, { name: 'Barbell Squat', pct: 0.5 }, { name: 'Incline Dumbbell Press', pct: 0.6 }, { name: 'Mystery Move', pct: 9 },
    ]);
    expect(f.map((x) => x.family)).toEqual(['Squat', 'Horizontal press']);
    expect(f[1].pct).toBeCloseTo(0.4, 10);
    expect(f[1].lifts).toEqual(['Bench Press', 'Incline Dumbbell Press']);
  });
  it('follows the lifts as one line, week by week, each against where it started in the range', () => {
    // Weeks from Mon 5 Oct: A starts 100, B starts 200.
    const a = pts('2026-10-06', 7, [100, 110, 120]), b = [{ date: '2026-10-14', v: 200 }, { date: '2026-10-21', v: 210 }];
    expect(strengthIndex([{ points: a }, { points: b }], '2026-10-05', 3)).toEqual([100, (110 + 100) / 2, (120 + 105) / 2]);
    // A week before any reading, and a lift's last reading carried through a week without one.
    expect(strengthIndex([{ points: [{ date: '2026-10-14', v: 50 }, { date: '2026-10-28', v: 55 }] }], '2026-10-05', 4)).toEqual([null, 100, 100, 110]);
  });
});

describe('prTimeline: PRs over the range by kind, a dot each', () => {
  it('names a PR by the first of strength, reps, volume, cardio it broke', () => {
    expect(prGroup(['setVolume', 'rm5'])).toBe('strength');
    expect(prGroup(['e1rm'])).toBe('strength');
    expect(prGroup(['heaviest'])).toBe('strength');
    expect(prGroup(['sessionVolume', 'reps'])).toBe('reps');
    expect(prGroup(['hold'])).toBe('reps');
    expect(prGroup(['mostReps'])).toBe('reps');
    expect(prGroup(['sessionVolume'])).toBe('volume');
    expect(prGroup(['pace', 'distance'])).toBe('cardio');
  });
  it('places each PR in the range, counts each kind and this month', () => {
    const t = prTimeline([
      { date: '2026-10-21', kinds: ['e1rm'] }, { date: '2026-07-30', kinds: ['sessionVolume'] }, { date: '2026-10-01', kinds: ['reps'] },
      { date: '2026-09-30', kinds: ['distance'] }, { date: '2026-07-29', kinds: ['e1rm'] }, { date: '2026-10-22', kinds: ['e1rm'] },
    ], FROM, TODAY);
    expect(t.total).toBe(4);
    expect(t.thisMonth).toBe(2);
    expect(t.groups).toEqual({ strength: 1, reps: 1, volume: 1, cardio: 1 });
    expect(t.dots.map((d) => [d.date, d.group])).toEqual([['2026-07-30', 'volume'], ['2026-09-30', 'cardio'], ['2026-10-01', 'reps'], ['2026-10-21', 'strength']]);
    expect(t.dots[0].at).toBe(0);
    expect(t.dots[3].at).toBe(1);
    expect(t.dots[1].at).toBeCloseTo(62 / 83, 10);
  });
});

describe('plateaus: which followed lifts are flat, the longest first, and a pip for each', () => {
  const l = (name: string, weeks: number | null, pct: number | null): LiftState => ({ name, stall: weeks == null ? null : { weeks, since: '2026-09-01' }, pct });
  it('says flat, up, down or level for each lift', () => {
    expect(pipOf(l('A', 2, 3))).toBe('flat');
    expect(pipOf(l('A', null, 3))).toBe('up');
    expect(pipOf(l('A', null, -1))).toBe('down');
    expect(pipOf(l('A', null, 0.01))).toBe('level');
    expect(pipOf(l('A', null, null))).toBe('level');
  });
  it('lists the flat ones longest first, out of every lift followed', () => {
    const p = plateaus([l('Bench Press', 2, 0.5), l('Barbell Squat', null, 4), l('Deadlift', 5, 0), l('Barbell Row', null, -2)]);
    expect(p.flat.map((x) => x.name)).toEqual(['Deadlift', 'Bench Press']);
    expect(p.of).toBe(4);
    expect(p.pips.map((x) => x.pip)).toEqual(['flat', 'up', 'flat', 'down']);
  });
});

describe('hitRate: how often a suggested set made its reps', () => {
  const aim = (exercise: string, date: string, weight: number, reps: number, target: { weight: number | null; reps: number }, o: Partial<SetEntry> = {}) =>
    set(exercise, date, { weight, reps, target: { ...target, sets: 3 }, ...o });
  it('counts sets done at the suggested weight; it made it when its reps reached the suggestion', () => {
    const e = [
      set('Bench Press', '2026-10-05', { weight: 135, reps: 8 }),
      aim('Bench Press', '2026-10-12', 135, 9, { weight: 135, reps: 9 }), // hit
      aim('Bench Press', '2026-10-12', 135, 7, { weight: 135, reps: 9 }), // missed
      aim('Bench Press', '2026-10-19', 140, 8, { weight: 140, reps: 8 }), // hit, a load jump on 135
      aim('Bench Press', '2026-10-19', 140, 6, { weight: 140, reps: 8 }), // missed, a load jump
      aim('Bench Press', '2026-10-19', 130, 12, { weight: 140, reps: 8 }), // another weight: says nothing
      aim('Bench Press', '2026-10-19', 140, 3, { weight: 140, reps: 8 }, { flags: ['test'] }), // a test: left out
      aim('Bench Press', '2026-10-19', 95, 5, { weight: 95, reps: 8 }, { flags: ['warmup'] }), // a warm-up: left out
      aim('Cable Curl', '2026-10-20', 40, 12, { weight: 40, reps: 12 }),
      aim('Cable Curl', '2026-10-20', 40, 0, { weight: null, reps: 12 }), // first session: no weight suggested
      aim('Cable Curl', '2026-07-01', 40, 1, { weight: 40, reps: 12 }), // before the range
    ];
    const r = hitRate(e, FROM, TODAY);
    expect([r.sets, r.hit]).toEqual([5, 3]);
    expect(r.lifts).toEqual([{ name: 'Bench Press', sets: 4, hit: 2 }, { name: 'Cable Curl', sets: 1, hit: 1 }]);
    expect(r.jumps).toEqual({ sets: 2, hit: 1 });
    expect(r.weekly).toHaveLength(13);
    expect(r.weekly.slice(-3)).toEqual([null, 0.5, 2 / 3]);
  });
  it('says nothing with no suggested sets', () => {
    expect(hitRate([set('Bench Press', '2026-10-12')], FROM, TODAY)).toMatchObject({ sets: 0, hit: 0, lifts: [] });
  });
});

describe('effort: how hard, by the RIR he logged', () => {
  it('averages the logged RIR, the share at 0–2, a bar for each RIR, and each lift', () => {
    const e = [
      set('Bench Press', '2026-10-12', { rir: 0 }), set('Bench Press', '2026-10-12', { rir: 1 }), set('Bench Press', '2026-10-12', { rir: 2 }),
      set('Bench Press', '2026-10-12'), // not logged
      set('Cable Curl', '2026-10-13', { rir: 3 }), set('Cable Curl', '2026-10-13', { rir: 7 }),
      set('Cable Curl', '2026-10-13', { rir: 0, flags: ['warmup'] }), // a warm-up: not a working set
      set('Treadmill', '2026-10-13', { weight: 0, reps: null, flags: ['cardio'], cardio: { seconds: 600 }, rir: 0 }),
      set('Bench Press', '2026-07-01', { rir: 0 }), // before the range
    ];
    const r = effort(e, FROM, TODAY)!;
    expect([r.sets, r.logged]).toEqual([6, 5]);
    expect(r.avg).toBeCloseTo(13 / 5, 10);
    expect(r.hard).toBeCloseTo(3 / 5, 10);
    expect(r.bins).toEqual([1, 1, 1, 1, 0, 1]);
    expect(r.lifts).toEqual([{ name: 'Bench Press', n: 3, avg: 1, hard: 1 }, { name: 'Cable Curl', n: 2, avg: 5, hard: 0 }]);
  });
  it('is null with no RIR logged in the range', () => {
    expect(effort([set('Bench Press', '2026-10-12')], FROM, TODAY)).toBeNull();
  });
});

describe('rests: rest as taken against the timer, and how dense a session is', () => {
  const D = '2026-10-12';
  const at = (exercise: string, hms: string, o: Partial<SetEntry> = {}) => set(exercise, D, { loggedAt: utc(D, hms), ...o });
  it('reads rests from one set to the next of the same lift, less the set itself, against what the timer gives it', () => {
    const e = [
      at('Bench Press', '17:00:00'), at('Bench Press', '17:03:40'), at('Bench Press', '17:07:20'), // rests 180, 180
      at('Cable Curl', '17:10:00'), at('Cable Curl', '17:12:40'), // a switch, then rest 120
      at('Cable Curl', '17:14:00', { enteredAt: utc(D, '17:20:00') }), // entered late: its time is a guess
      at('Cable Curl', '17:30:00'), // 17:12:40 to 17:30 is a break
      at('Cable Curl', '17:31:00', { flags: ['warmup'] }), // a warm-up isn't a working set
    ];
    const timer = (ex: string) => (ex === 'Bench Press' ? 180 : 90);
    const r = rests(e, FROM, TODAY, timer)!;
    expect(r.n).toBe(3);
    expect(r.rest).toBe(180);
    expect(r.timer).toBe(180);
    expect(r.lifts).toEqual([{ name: 'Bench Press', rest: 180, timer: 180, n: 2 }, { name: 'Cable Curl', rest: 120, timer: 90, n: 1 }]);
    expect(r.sessions).toHaveLength(1);
    const s = r.sessions[0];
    // 17:00 to 17:30 plus the first set itself; six working sets with a time of their own.
    expect(s.minutes).toBeCloseTo(30 + SET_WORK / 60, 10);
    expect(s.sets).toBe(6);
    expect(s.perHour).toBeCloseTo((60 * 6) / (30 + SET_WORK / 60), 10);
    expect(s.rest).toBe(180);
    expect(s.over).toBeCloseTo(30 / 60, 10);
    expect(r.perHour).toBeCloseTo(s.perHour, 10);
    expect(r.over).toBeCloseTo(0.5, 10);
  });
  it('is null with nothing timed', () => {
    expect(rests([set('Bench Press', D), set('Bench Press', D)], FROM, TODAY, () => 120)).toBeNull();
  });
});

describe('whenTrained: which weekdays, and the hour he usually starts', () => {
  it('counts days by weekday, the two most first, and the usual start from each day’s first timed set', () => {
    expect(weekdayOf('2026-10-12')).toBe(0);
    expect(weekdayOf('2026-10-18')).toBe(6);
    const e = [
      // Mondays and Wednesdays three weeks running, a Saturday once; starts at 17:00, 18:00, 17:30 and 9:00.
      ...['2026-10-05', '2026-10-12', '2026-10-19'].map((d) => set('Bench Press', d)),
      ...['2026-10-07', '2026-10-14', '2026-10-21'].map((d) => set('Barbell Squat', d)),
      set('Barbell Row', '2026-10-17'),
      set('Bench Press', '2026-10-12', { loggedAt: utc('2026-10-12', '17:00:40') }),
      set('Bench Press', '2026-10-12', { loggedAt: utc('2026-10-12', '17:40:00') }),
      set('Bench Press', '2026-10-19', { loggedAt: utc('2026-10-19', '18:00:40') }),
      set('Barbell Squat', '2026-10-14', { loggedAt: utc('2026-10-14', '17:30:40') }),
      set('Barbell Row', '2026-10-17', { loggedAt: utc('2026-10-17', '09:00:40') }),
      set('Barbell Row', '2026-10-17', { loggedAt: utc('2026-10-17', '08:00:40'), enteredAt: utc('2026-10-17', '10:00:00') }), // entered late
      set('Bench Press', '2026-10-20', { flags: ['warmup'] }), // a warm-up alone isn't a day trained
    ];
    const w = whenTrained(e, FROM, TODAY, utcHour);
    expect(w.days).toBe(7);
    expect(w.weeks).toBe(12);
    expect(w.byDay).toEqual([3, 0, 3, 0, 0, 1, 0]);
    expect(w.top).toEqual([0, 2]);
    expect(w.timed).toBe(4);
    expect(w.start).toBeCloseTo(17.25, 10);
    expect(w.early).toBeCloseTo(15, 10); // the quarter of 9, 17, 17.5, 18
    expect(w.late).toBeCloseTo(17.625, 10);
    expect(w.hours[17]).toBe(2);
    expect(w.hours[18]).toBe(1);
    expect(w.hours[9]).toBe(1);
    expect(w.startByDay).toEqual([17.5, null, 17.5, null, null, 9, null]);
  });
  it('with nothing timed, days only', () => {
    const w = whenTrained([set('Bench Press', '2026-10-12')], FROM, TODAY);
    expect([w.days, w.timed, w.start]).toEqual([1, 0, null]);
    expect(w.top).toEqual([0]);
  });
  it('best days keep a tie with the second, three at most', () => {
    const days = (ds: string[]) => whenTrained(ds.map((d) => set('Bench Press', d)), FROM, TODAY).top;
    // Mon, Wed and Fri twice each, Tuesday once: all three, Monday first.
    expect(days(['2026-10-12', '2026-10-19', '2026-10-14', '2026-10-21', '2026-10-16', '2026-10-09', '2026-10-13'])).toEqual([0, 2, 4]);
    // Friday three times, then Mon, Wed and Sat twice: four tie with the second, so only the clear leader.
    expect(days(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-12', '2026-10-19', '2026-10-14', '2026-10-21', '2026-10-10', '2026-10-17'])).toEqual([4]);
    // Four weekdays once each: none stands out.
    expect(days(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'])).toEqual([]);
    // The second alone: two.
    expect(days(['2026-10-12', '2026-10-19', '2026-10-14'])).toEqual([0, 2]);
  });
});

describe('balance: pull against push, by what each lift trains most', () => {
  it('counts working sets by kind and the pull per push, week by week', () => {
    const e = [
      set('Bench Press', '2026-10-12'), set('Bench Press', '2026-10-12'),
      set('Barbell Row', '2026-10-13'), set('Barbell Row', '2026-10-13'), set('Lat Pulldown', '2026-10-20'),
      set('Barbell Squat', '2026-10-14'), set('Cable Crunch', '2026-10-14'),
      set('Bench Press', '2026-10-12', { flags: ['warmup'] }), set('Treadmill', '2026-10-14', { weight: 0, reps: null, flags: ['cardio'], cardio: { seconds: 600 } }),
      set('Mystery Move', '2026-10-14'),
    ];
    const b = balance(e, FROM, TODAY);
    expect([b.push, b.pull, b.legs, b.core]).toEqual([2, 3, 1, 1]);
    expect(b.ratio).toBeCloseTo(1.5, 10);
    expect(b.weekly).toHaveLength(13);
    expect(b.weekly.slice(-2)).toEqual([{ pull: 2, push: 2 }, { pull: 1, push: 0 }]);
    expect(balance([set('Barbell Row', '2026-10-13')], FROM, TODAY).ratio).toBeNull();
  });
});

describe('liftsInRotation: the lifts he does, new ones and dropped ones', () => {
  it('lists the range’s lifts, those first done in it, and those done in the span before and not since', () => {
    const e = [
      set('Bench Press', '2026-05-10'), set('Bench Press', '2026-09-01'), set('Bench Press', '2026-10-12'), // all along
      set('Incline Dumbbell Press', '2026-10-05'), set('Incline Dumbbell Press', '2026-10-19'), // new
      set('Barbell Row', '2026-06-01'), set('Barbell Row', '2026-07-20'), // dropped: last done before the range
      set('Leg Extension', '2026-01-10'), // long gone: neither
      set('Cable Curl', '2026-10-13', { flags: ['warmup'] }), // a warm-up alone isn't the lift done
      set('Treadmill', '2026-10-14', { weight: 0, reps: null, flags: ['cardio'], cardio: { seconds: 600 } }),
    ];
    const r = liftsInRotation(e, FROM, TODAY);
    // The most sessions first; on a tie, the most recent.
    expect(r.lifts.map((l) => [l.name, l.sessions])).toEqual([['Incline Dumbbell Press', 2], ['Bench Press', 2]]);
    expect(r.fresh.map((l) => [l.name, l.first])).toEqual([['Incline Dumbbell Press', '2026-10-05']]);
    expect(r.dropped.map((l) => [l.name, l.last])).toEqual([['Barbell Row', '2026-07-20']]);
    expect(r.weekly.slice(-3)).toEqual([1, 1, 1]);
    expect(r.weekly.reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('energyVsLifts: his energy, and how each day’s lifting went against itself', () => {
  it('averages the energy logged and reads each day’s lifts against their last 3 sessions', () => {
    const e = [
      // Two heavier sessions long before (only the last 3 count), then bench best e1RM 100 × (1 + 8/30) on three, then a day 10 % up.
      ...['2026-09-21', '2026-09-24'].map((d) => set('Bench Press', d, { weight: 130 })),
      ...['2026-09-28', '2026-10-01', '2026-10-05'].map((d) => set('Bench Press', d, { weight: 100 })),
      set('Bench Press', '2026-10-08', { weight: 110 }), set('Bench Press', '2026-10-08', { weight: 90 }),
      set('Barbell Squat', '2026-10-08', { weight: 200 }), // its first session: nothing to compare
      set('Bench Press', '2026-10-12', { weight: 95 }),
    ];
    const body: BodyDay[] = [
      { date: '2026-10-08', energy: 5 }, { date: '2026-10-12', energy: 2 }, { date: '2026-10-10', energy: 3 }, { date: '2026-10-11', weight: 200 },
      { date: '2026-07-01', energy: 1 },
    ];
    const r = energyVsLifts(e, body, FROM, TODAY)!;
    expect(r.days.map((d) => [d.date, d.energy])).toEqual([['2026-10-08', 5], ['2026-10-10', 3], ['2026-10-12', 2]]);
    expect(r.avg).toBeCloseTo(10 / 3, 10);
    expect(r.days[0].vs).toBeCloseTo(10, 10);
    expect(r.days[1].vs).toBeNull();
    // Against the median of 100, 100, 110 (every session before would make it 105).
    expect(r.days[2].vs).toBeCloseTo(-5, 10);
    expect(r.levels.map((x) => x.days)).toEqual([0, 1, 1, 0, 1]);
    expect(r.levels[4].vs).toBeCloseTo(10, 10);
    expect(r.levels[2].vs).toBeNull();
    expect(r.high).toBeCloseTo(10, 10);
    expect(r.low).toBeCloseTo(-5, 10);
  });
  it('reads a lift only against 2 or more sessions in the 8 weeks before', () => {
    const e = [
      // Bench: two sessions long ago, then one 10 days before: too few recent ones to compare.
      set('Bench Press', '2026-06-01', { weight: 60 }), set('Bench Press', '2026-06-08', { weight: 60 }), set('Bench Press', '2026-10-02', { weight: 100 }),
      set('Bench Press', '2026-10-12', { weight: 110 }),
      // Row: two in the 8 weeks before (the 56th day back counts), at a median of 105; the older one would make it 110.
      set('Barbell Row', '2026-08-01', { weight: 200 }), set('Barbell Row', '2026-08-17', { weight: 100 }), set('Barbell Row', '2026-10-05', { weight: 110 }),
      set('Barbell Row', '2026-10-12', { weight: 126 }),
    ];
    const r = energyVsLifts(e, [{ date: '2026-10-12', energy: 4 }], FROM, TODAY)!;
    expect(r.days[0].vs).not.toBeNull();
    expect(r.days[0].vs).toBeCloseTo(20, 10); // 126 against 105
    expect(energyVsLifts(e.filter((x) => x.exercise === 'Bench Press'), [{ date: '2026-10-12', energy: 4 }], FROM, TODAY)!.days[0].vs).toBeNull();
  });
  it('is null with no energy in the range', () => {
    expect(energyVsLifts([set('Bench Press', '2026-10-12')], [{ date: '2026-10-12', weight: 200 }], FROM, TODAY)).toBeNull();
  });
});

describe('milestoneDate: when the trend reaches the next round number, with its likely range', () => {
  const line = (k: number, per: number, start = 200) => pts('2026-09-09', 7, Array.from({ length: k }, (_, i) => start + per * i));
  it('carries the line on from today: 6 sessions climbing 7 lb a week reach 250 in 15 days', () => {
    // Fit at today (14 Oct is the last session; today 21 Oct): 200 + 35 + 7 = 242; 8 lb to go at 1 lb a day.
    expect(milestoneDate(line(6, 7), 250, TODAY)).toEqual({ date: '2026-10-29', early: '2026-10-29', late: '2026-10-29' });
  });
  it('gives a wider range the noisier the sessions', () => {
    const noisy = line(8, 7).map((p, i) => ({ ...p, v: p.v + (i % 2 ? 3 : -3) }));
    const m = milestoneDate(noisy, 260, TODAY)!;
    expect(m.early < m.date && m.date < m.late).toBe(true);
  });
  it('needs 6 sessions and a trend rising at both ends of its range, within a year', () => {
    expect(milestoneDate(line(5, 7), 250, TODAY)).toBeNull();
    expect(milestoneDate(line(6, 0), 250, TODAY)).toBeNull();
    expect(milestoneDate(line(6, -2), 250, TODAY)).toBeNull();
    // Rising on average, but too noisy to say it rises.
    expect(milestoneDate(pts('2026-09-09', 7, [200, 220, 195, 225, 190, 230]), 250, TODAY)).toBeNull();
    // A pound a month: over a year to go.
    expect(milestoneDate(line(6, 0.25), 250, TODAY)).toBeNull();
  });
});

describe('sessionsAWeek: the average over the weeks he has logged, not the whole range (owner bug, 2026-10-21)', () => {
  // Mon/Wed/Fri for the 6 weeks before this one (Mon 7 Sep to Fri 16 Oct), and Monday of this week: 3 a week from the first.
  const mwf = Array.from({ length: 6 }, (_, w) => [0, 2, 4].map((d) => set('Bench Press', addDays('2026-09-07', 7 * w + d)))).flat();
  const log = [...mwf, set('Bench Press', '2026-10-19')];
  const weeks = weeklySummary(log, 12, TODAY);
  it('6 weeks of 3 sessions in a 12-week range average 3.0, not 1.5, and meet a goal of 3 in 6 of 6', () => {
    expect(weeks).toHaveLength(12);
    const r = sessionsAWeek(weeks, '2026-09-07', 3);
    expect(r.avg).toBe(3);
    expect([r.met, r.of]).toEqual([6, 6]);
    // The weeks drawn: from the first logged week to this one, which is under way (1 so far).
    expect(r.weeks.map((w) => w.sessions)).toEqual([3, 3, 3, 3, 3, 3, 1]);
  });
  it('counts a missed week after the first logged one: that week happened', () => {
    const gap = log.filter((e) => e.date < '2026-09-21' || e.date > '2026-09-27');
    const r = sessionsAWeek(weeklySummary(gap, 12, TODAY), '2026-09-07', 3);
    expect(r.of).toBe(6);
    expect(r.avg).toBe(2.5);
    expect(r.met).toBe(5);
  });
  it('a first set mid-week starts the count that week', () => {
    expect(sessionsAWeek(weeks, '2026-09-11', 3).of).toBe(6);
  });
  it('a log older than the range averages the whole range', () => {
    const r = sessionsAWeek(weeks, '2026-01-05', 3);
    expect(r.of).toBe(11);
    expect(r.avg).toBeCloseTo(18 / 11, 10);
  });
  it('a log that starts this week reads this week alone', () => {
    const r = sessionsAWeek(weeklySummary([set('Bench Press', '2026-10-19')], 12, TODAY), '2026-10-19', 3);
    expect([r.avg, r.met, r.of]).toEqual([1, 0, 1]);
  });
});
