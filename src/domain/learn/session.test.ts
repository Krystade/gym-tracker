import { describe, expect, it } from 'vitest';
import { addDays } from '../analytics';
import { liftKey } from '../ids';
import { isIsolation, planSeconds, SET_WORK, stepsOf, type Step } from '../timing';
import type { SetEntry } from '../types';
import { paceBefore, paceFit, quietAfter, sessionLengths, SHOW_BOTH } from './session';
import { paceLog, sessionSteps, trueGap, trueSeconds, type PaceSim } from './sessionSim.sample';

const secs = (e: SetEntry) => Date.parse(e.loggedAt!) / 1000;
/** A logged day's steps (its sets in the order done) and its measured length (timing.sessionMinutes' span, in s). */
function asDone(sim: PaceSim, date: string): { steps: Step[]; actual: number } {
  const day = sim.entries.filter((e) => e.date === date).sort((a, b) => secs(a) - secs(b));
  return { steps: day.map((e) => ({ exercise: e.exercise, ...(e.flags.includes('warmup') && { warmup: true }) })), actual: secs(day.at(-1)!) - secs(day[0]) + SET_WORK };
}
const PLAN = sessionSteps(['Bench Press', 'Lat Pulldown', 'Cable Curl', 'DB Lateral Raise'], 3, 1);

describe('learn/session: his pace, learned', () => {
  const sim = paceLog(1, { sessions: 200 });
  const fit = paceFit(sim.entries)!;
  const t = sim.truth;

  it('recovers the gap by lift kind, switch, warm-up and place in the session', () => {
    // Kind is fixed within a lift, so the fit's compound effect is the truth's plus how far these compound lifts' own draws
    // sit from the isolation lifts' (the lifts' own deviations are pooled toward their kind).
    const mean = (iso: boolean) => { const xs = [...sim.lift].filter(([k]) => isIsolation(k) === iso).map(([, v]) => v); return xs.reduce((a, b) => a + b, 0) / xs.length; };
    expect(fit.beta[1]).toBeCloseTo(t.compound + mean(false) - mean(true), 1);
    expect(fit.beta[2]).toBeCloseTo(t.switch, 1);
    expect(Math.abs(fit.beta[3] - t.warm)).toBeLessThan(0.15);
    expect(Math.abs(fit.beta[4] - t.pos)).toBeLessThan(0.008);
    // The day's own pace and the noise within a day, apart.
    expect(Math.sqrt(fit.tau2)).toBeGreaterThan(t.daySd * 0.7);
    expect(Math.sqrt(fit.tau2)).toBeLessThan(t.daySd * 1.3);
    expect(Math.sqrt(fit.sigW2)).toBeCloseTo(t.sd, 1);
  });

  it('forecasts a session to its true mean length (a sum of gaps: the mean, not the median)', () => {
    const date = addDays(sim.days.at(-1)!, 2);
    const f = fit.forecast(PLAN, { date });
    const truth = trueSeconds(sim, PLAN);
    expect(Math.abs(f.seconds / truth - 1)).toBeLessThan(0.04);
    // Not the median: ln-normal noise of σ 0.4 puts the mean 8 % over it.
    const median = trueSeconds({ ...sim, truth: { ...t, sd: 0, daySd: 0 } }, PLAN);
    expect(f.seconds / median).toBeGreaterThan(1.05);
    expect(f.remaining).toBe(f.seconds); // not started: all of it to go
    expect(f.endsAt).toBeNull();
    expect(f.lo).toBeLessThan(f.seconds);
    expect(f.hi).toBeGreaterThan(f.seconds);
  });

  it('prices position: a longer session runs longer per gap, as he slows through it', () => {
    const big = paceLog(11, { sessions: 120, lifts: 6, sets: 4 });
    const f = paceFit(big.entries)!;
    const date = addDays(big.days.at(-1)!, 2);
    const long = sessionSteps(['Squat', 'Seated Cable Row', 'Bench Press', 'Cable Pushdown', 'Leg Extension', 'Cable Curl'], 4, 1);
    expect(Math.abs(f.forecast(long, { date }).seconds / trueSeconds(big, long) - 1)).toBeLessThan(0.05);
    // Past the longest session he has done, a gap is priced at the last place seen: no trend is run on beyond his data.
    const longer = [...long, ...sessionSteps(['Lat Pulldown', 'DB Lateral Raise'], 4, 0)];
    const extra = f.forecast(longer, { date }).seconds - f.forecast(long, { date }).seconds;
    expect(extra).toBeLessThan(trueSeconds(big, longer) - trueSeconds(big, long));
    // Two more sets of the last lift, both past the longest session: each priced the same.
    const more = (k: number) => f.forecast([...long, ...Array.from({ length: k }, () => ({ exercise: 'Cable Curl' }))], { date }).seconds;
    expect(more(2) - more(1)).toBeCloseTo(more(1) - more(0), 6);
  });

  it('the half-life favours a long memory when his pace never changes', () => {
    expect(fit.weights.at(-1)!).toBeGreaterThan(fit.weights[0]);
  });
});

describe('learn/session: what it leaves out', () => {
  it('breaks (20–40 min waits) are not his pace', () => {
    const sim = paceLog(2, { sessions: 150, breaks: 0.03 });
    const fit = paceFit(sim.entries)!;
    expect(fit.breaks).toBeGreaterThan(20);
    const date = addDays(sim.days.at(-1)!, 2);
    expect(Math.abs(fit.forecast(PLAN, { date }).seconds / trueSeconds(sim, PLAN) - 1)).toBeLessThan(0.06);
  });

  it('a set entered late has a guessed time: neither gap next to it is learned from', () => {
    const sim = paceLog(3, { sessions: 20, late: 0.2 });
    const fit = paceFit(sim.entries)!;
    let expected = 0;
    for (const d of sim.days) {
      const day = sim.entries.filter((e) => e.date === d).sort((a, b) => secs(a) - secs(b));
      for (let i = 1; i < day.length; i++) if (!day[i - 1].enteredAt && !day[i].enteredAt) expected++;
    }
    expect(fit.gaps + fit.breaks).toBe(expected);
  });

  it('a day with an untimed set among timed ones, a cardio bout, and a superset’s switches are left out', () => {
    const sim = paceLog(4, { sessions: 6 });
    const n = paceFit(sim.entries)!.gaps + paceFit(sim.entries)!.breaks;
    const [d0] = sim.days;
    const untimed = sim.entries.map((e) => (e.date === d0 && e.setNo === 2 ? { ...e, loggedAt: undefined } : e));
    const day0 = sim.entries.filter((e) => e.date === d0).length - 1;
    const f1 = paceFit(untimed)!;
    expect(f1.gaps + f1.breaks).toBe(n - day0);
    // A cardio bout at the end of every day: the gap into it isn't a lift's.
    const bouts = sim.days.map((d, i) => {
      const last = sim.entries.filter((e) => e.date === d).at(-1)!;
      return { ...last, id: `bout${i}`, exercise: 'Treadmill', flags: ['cardio' as const], weight: 0, reps: null, cardio: { seconds: 600 }, loggedAt: new Date(secs(last) * 1000 + 900e3).toISOString() };
    });
    const f2 = paceFit([...sim.entries, ...bouts])!;
    expect(f2.gaps + f2.breaks).toBe(n);
    // A superset day: Bench Press and Lat Pulldown in turn, 1 min switches, 4 min rounds. None of its 5 gaps is a rest he'd
    // take between sets of one lift, and a plan doesn't price supersets.
    const sd = addDays(sim.days.at(-1)!, 2), t0 = Date.parse(`${sd}T17:00:00Z`);
    const ss = [0, 60, 240, 300, 480, 540].map((t, i): SetEntry => ({ id: `ss${i}`, date: sd, seq: 5000 + i, exercise: i % 2 ? 'Lat Pulldown' : 'Bench Press', setNo: i + 1, weight: 100, reps: 10, flags: [], source: 'sample', loggedAt: new Date(t0 + t * 1000).toISOString() }));
    const f3 = paceFit([...sim.entries, ...ss])!;
    expect(f3.gaps + f3.breaks).toBe(n);
  });

  it('needs two timed days: one day can’t tell its own pace from his', () => {
    const sim = paceLog(5, { sessions: 2 });
    expect(paceFit(sim.entries.filter((e) => e.date === sim.days[0]))).toBeNull();
    expect(paceFit(sim.entries)).not.toBeNull();
    expect(paceBefore(sim.entries, sim.days[1])).toBeNull(); // as of day 2: only day 1 before it
  });
});

describe('learn/session: uncertainty', () => {
  for (const [name, truth] of [['as simulated', {}], ['with the spread all within a day', { daySd: 0.05, sd: 0.6 }]] as const) it(`its 80 % band holds about 80 % of later sessions, and the mean is unbiased: ${name}`, () => {
    const sim = paceLog(6, { sessions: 260, truth });
    const cut = sim.days[60];
    const fit = paceBefore(sim.entries, cut)!;
    let inside = 0, n = 0, ratio = 0;
    for (const d of sim.days.slice(60)) {
      const { steps, actual } = asDone(sim, d);
      const f = fit.forecast(steps, { date: cut });
      if (actual >= f.lo && actual <= f.hi) inside++;
      ratio += Math.log(actual / f.seconds); n++;
    }
    expect(inside / n).toBeGreaterThan(0.72);
    expect(inside / n).toBeLessThan(0.9);
    // Mean of ln(actual/forecast) is −s²/2 for an unbiased mean: within a few percent of 0 either way.
    expect(Math.abs(ratio / n)).toBeLessThan(0.06);
  });

  it('a layoff widens the band; the point stays', () => {
    const sim = paceLog(7, { sessions: 12 });
    const fit = paceFit(sim.entries)!;
    const last = sim.days.at(-1)!;
    const at = (days: number) => fit.forecast(PLAN, { date: addDays(last, days) });
    const [a, b, c] = [at(2), at(120), at(365)];
    expect(b.seconds).toBeCloseTo(a.seconds, 6);
    expect(c.seconds).toBeCloseTo(a.seconds, 6);
    expect(b.hi - b.lo).toBeGreaterThan((a.hi - a.lo) * 1.05);
    expect(c.hi - c.lo).toBeGreaterThan(b.hi - b.lo);
  });
});

describe('learn/session: today', () => {
  const sim = paceLog(8, { sessions: 80 });
  const fit = paceFit(sim.entries)!;
  const date = addDays(sim.days.at(-1)!, 2);
  /** Today's first `n` sets of PLAN, at `k` times his usual pace. */
  const today = (n: number, k: number): SetEntry[] => {
    let t = Date.parse(`${date}T17:00:00Z`);
    return PLAN.slice(0, n).map((s, i) => {
      if (i) t += k * trueGap(sim, PLAN[i - 1], PLAN[i], i - 1) * 1000;
      return { id: `t${i}`, date, seq: i, exercise: s.exercise, setNo: i + 1, weight: 100, reps: 10, flags: s.warmup ? ['warmup'] : [], source: 'app', loggedAt: new Date(t).toISOString() };
    });
  };

  it('today’s slow start moves the rest of the session, shrunk toward his usual (one slow gap is not a new pace)', () => {
    const rest = PLAN.slice(5);
    const usual = fit.forecast(rest, { date, today: today(5, 1) });
    const slow = fit.forecast(rest, { date, today: today(5, 1.6) });
    const ratio = slow.remaining / usual.remaining;
    expect(ratio).toBeGreaterThan(1.12);
    expect(ratio).toBeLessThan(1.5);
    const one = fit.forecast(PLAN.slice(2), { date, today: today(2, 1.6) });
    const oneUsual = fit.forecast(PLAN.slice(2), { date, today: today(2, 1) });
    expect(one.remaining / oneUsual.remaining).toBeLessThan(ratio);
  });

  it('started: the time so far plus what’s left, ending after the last set by what’s left', () => {
    const t5 = today(5, 1);
    const f = fit.forecast(PLAN.slice(5), { date, today: t5 });
    const elapsed = secs(t5[4]) - secs(t5[0]) + SET_WORK;
    expect(f.seconds).toBeCloseTo(elapsed + f.remaining, 6);
    expect(f.endsAt).toBeCloseTo(Date.parse(t5[4].loggedAt!) + f.remaining * 1000, 0);
  });
});

describe('learn/session: lifts pooled person → family → lift', () => {
  it('a lift with many gaps keeps its own pace; one never timed takes its family’s, less sure', () => {
    const sim = paceLog(9, { sessions: 120, truth: { liftSd: 0 } });
    // Cable Curl rests 50 % longer than the model's kinds explain.
    const curl = liftKey('Cable Curl');
    const slowed: SetEntry[] = [];
    for (const d of sim.days) {
      const day = sim.entries.filter((e) => e.date === d).sort((a, b) => secs(a) - secs(b));
      let shift = 0;
      day.forEach((e, i) => {
        if (i && liftKey(day[i - 1].exercise) === curl) shift += 0.5 * (secs(e) - secs(day[i - 1]));
        slowed.push({ ...e, loggedAt: new Date((secs(e) + shift) * 1000).toISOString() });
      });
    }
    const fit = paceFit(slowed)!;
    const own = fit.lift('Cable Curl'), kin = fit.lift('Preacher Curl'), other = fit.lift('Leg Press');
    expect(own.mean).toBeGreaterThan(Math.log(1.5) * 0.7);
    expect(kin.mean).toBeGreaterThan(other.mean);
    expect(kin.mean).toBeLessThan(own.mean);
    expect(kin.sd).toBeGreaterThan(own.sd);
  });
});

describe('learn/session: the plan’s overhead', () => {
  it('is what a switch costs him beyond a set-to-set gap (b), and never below nothing', () => {
    const sim = paceLog(10, { sessions: 150 });
    const fit = paceFit(sim.entries)!;
    // The truth on his switches: E[gap] less the same gap without the switch, averaged over the switches made.
    const t = sim.truth;
    let s = 0, n = 0;
    for (const d of sim.days) {
      const { steps } = asDone(sim, d);
      for (let i = 1; i < steps.length; i++) {
        if (liftKey(steps[i].exercise) === liftKey(steps[i - 1].exercise)) continue;
        s += trueGap(sim, steps[i - 1], steps[i], i - 1) * (1 - Math.exp(-t.switch)); n++;
      }
    }
    expect(Math.abs(fit.overhead / (s / n) - 1)).toBeLessThan(0.35);
    const quick = paceFit(paceLog(10, { sessions: 60, truth: { switch: -0.3 } }).entries)!;
    expect(quick.overhead).toBe(0);
  });
});

describe('learn/session: the plan and his pace, as shown', () => {
  const SLOTS = [{ exercise: 'Bench Press', sets: 3 }, { exercise: 'Lat Pulldown', sets: 3 }, { exercise: 'Cable Curl', sets: 3 }, { exercise: 'DB Lateral Raise', sets: 3 }];
  const warm = (ex: string) => (ex === 'Bench Press' ? 1 : 0);
  /** `sim`'s log, and the first `n` sets of PLAN logged on `date` at his usual pace. */
  const withToday = (sim: PaceSim, date: string, n: number): SetEntry[] => {
    let t = Date.parse(`${date}T17:00:00Z`);
    return [...sim.entries, ...PLAN.slice(0, n).map((s, i): SetEntry => {
      if (i) t += trueGap(sim, PLAN[i - 1], PLAN[i], i - 1) * 1000;
      return { id: `t${i}`, date, seq: 9000 + i, exercise: s.exercise, setNo: i + 1, weight: 100, reps: 10, flags: s.warmup ? ['warmup'] : [], source: 'app', loggedAt: new Date(t).toISOString() };
    })];
  };

  it('the plan is the timer’s rests and his overhead; his pace shows beside it only when over 10 min away', () => {
    expect(stepsOf(SLOTS, warm)).toEqual(PLAN);
    for (const [base, both] of [[Math.log(400), true], [Math.log(130), false]] as const) {
      const sim = paceLog(11, { sessions: 60, truth: { base } });
      const date = addDays(sim.days.at(-1)!, 2);
      const fit = paceBefore(sim.entries, date)!;
      const L = sessionLengths(sim.entries, date, SLOTS, { warmups: warm });
      expect(L.plan).toBe(planSeconds(PLAN, { overhead: fit.overhead }));
      expect(L.pace!.seconds).toBeCloseTo(fit.forecast(PLAN, { date }).seconds, 6);
      expect(L.both).toBe(both);
      expect(L.both).toBe(Math.abs(L.pace!.seconds - L.plan) > SHOW_BOTH);
      expect(L.started).toBeNull();
      expect(L.endsAt).toBeNull();
    }
  });

  it('his rest setting lengthens the plan, not his pace', () => {
    const sim = paceLog(12, { sessions: 40 });
    const date = addDays(sim.days.at(-1)!, 2);
    const a = sessionLengths(sim.entries, date, SLOTS, { warmups: warm });
    const b = sessionLengths(sim.entries, date, SLOTS, { warmups: warm, kept: (ex) => (ex === 'Bench Press' ? 240 : undefined) });
    expect(b.plan - a.plan).toBe(3 * (240 - 180)); // after each of Bench Press's 3 working sets; a warm-up keeps its own
    expect(b.pace!.seconds).toBe(a.pace!.seconds);
  });

  it('started: his pace is the time so far and the sets left, the lift under way first; it ends when that says', () => {
    const sim = paceLog(13, { sessions: 60 });
    const date = addDays(sim.days.at(-1)!, 2);
    const log = withToday(sim, date, 5); // the warm-up, Bench Press's 3 and one Lat Pulldown
    const today = log.filter((e) => e.date === date);
    const L = sessionLengths(log, date, SLOTS, { warmups: warm });
    const f = paceBefore(log, date)!.forecast(PLAN.slice(5), { date, today });
    expect(L.pace!.seconds).toBeCloseTo(f.seconds, 6);
    expect(L.endsAt).toBeCloseTo(f.endsAt!, 0);
    expect(L.started).toBe(Date.parse(today[0].loggedAt!));
    // Only the warm-up done: it isn't done again, Bench Press's sets come next.
    const warmed = withToday(sim, date, 1);
    expect(sessionLengths(warmed, date, SLOTS, { warmups: warm }).pace!.seconds)
      .toBeCloseTo(paceBefore(warmed, date)!.forecast(PLAN.slice(1), { date, today: warmed.filter((e) => e.date === date) }).seconds, 6);
    // A program's day isn't today's: `fresh` leaves today's sets out.
    const fresh = sessionLengths(log, date, SLOTS, { warmups: warm, fresh: true });
    expect(fresh.pace!.seconds).toBeCloseTo(paceBefore(log, date)!.forecast(PLAN, { date }).seconds, 6);
    expect(fresh.started).toBeNull();
  });

  it('with too little timed to learn from: the plan alone, at no overhead, ending a plan’s length after the first set began', () => {
    const sim = paceLog(14, { sessions: 1 });
    const date = addDays(sim.days[0], 2);
    const log = withToday(sim, date, 3);
    const L = sessionLengths(log, date, SLOTS, { warmups: warm });
    expect(L.pace).toBeNull();
    expect(L.both).toBe(false);
    expect(L.plan).toBe(planSeconds(PLAN));
    const first = Date.parse(log.find((e) => e.date === date)!.loggedAt!);
    expect(L.endsAt).toBe(first + (L.plan - SET_WORK) * 1000);
  });
});

describe('learn/session: when a session has gone quiet (auto-finish)', () => {
  /** Every gap between his timed sets on the days before `date`, in seconds. */
  const gapsBefore = (entries: SetEntry[], date: string): number[] => {
    const out: number[] = [];
    for (const d of [...new Set(entries.map((e) => e.date))].filter((d) => d < date)) {
      const day = entries.filter((e) => e.date === d).sort((a, b) => secs(a) - secs(b));
      for (let i = 1; i < day.length; i++) out.push(secs(day[i]) - secs(day[i - 1]));
    }
    return out;
  };
  /** Tukey's upper fence on ln gaps, worked out here on its own (quantiles by linear interpolation). */
  const fence = (gaps: number[]) => {
    const s = gaps.map(Math.log).sort((a, b) => a - b), n = s.length;
    const q = (p: number) => { const i = (n - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, n - 1)] - s[lo]) * (i - lo); };
    return Math.exp(q(0.75) + 1.5 * (q(0.75) - q(0.25)));
  };

  it('is Tukey’s fence on his ln gaps: past nearly every gap between his sets, short of a 20 min break', () => {
    const sim = paceLog(21, { sessions: 60 });
    const date = addDays(sim.days.at(-1)!, 2);
    const q = quietAfter(sim.entries, date)!;
    const gaps = gapsBefore(sim.entries, date);
    expect(gaps.length).toBeGreaterThan(500);
    expect(q.seconds).toBeCloseTo(fence(gaps), 6);
    expect(q.gaps).toBe(gaps.length);
    expect(q.days).toBe(60);
    const over = gaps.filter((g) => g > q.seconds).length / gaps.length;
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(0.02);
    expect(q.seconds).toBeLessThan(20 * 60);
  });

  it('a few breaks in his log barely move it (quartiles, not the mean)', () => {
    const clean = quietAfter(paceLog(22, { sessions: 60 }).entries, '2026-01-01')!;
    const broken = quietAfter(paceLog(22, { sessions: 60, breaks: 0.04 }).entries, '2026-01-01')!;
    expect(broken.seconds / clean.seconds).toBeGreaterThan(0.85);
    expect(broken.seconds / clean.seconds).toBeLessThan(1.25);
  });

  it('learns from the days before the session only: today’s own long gap doesn’t move it', () => {
    const sim = paceLog(23, { sessions: 20 });
    const date = addDays(sim.days.at(-1)!, 2), t0 = Date.parse(`${date}T17:00:00Z`);
    const today = [0, 200, 3600].map((t, i): SetEntry => ({ id: `q${i}`, date, seq: 9000 + i, exercise: 'Bench Press', setNo: i + 1, weight: 100, reps: 10, flags: [], source: 'app', loggedAt: new Date(t0 + t * 1000).toISOString() }));
    expect(quietAfter([...sim.entries, ...today], date)!.seconds).toBe(quietAfter(sim.entries, date)!.seconds);
  });

  it('(c) never inside the timer’s longest rest and its set, however alike his gaps are', () => {
    const day = (d: string) => [0, 180, 360, 540, 720].map((t, i): SetEntry => ({ id: `${d}${i}`, date: d, seq: i, exercise: 'Bench Press', setNo: i + 1, weight: 100, reps: 10, flags: [], source: 'app', loggedAt: new Date(Date.parse(`${d}T17:00:00Z`) + t * 1000).toISOString() }));
    const q = quietAfter([...day('2026-10-12'), ...day('2026-10-14')], '2026-10-16')!;
    expect(q.seconds).toBe(300 + 40); // REST_MAX_S + SET_WORK, not the 3:00 every gap is
  });

  it('(c) with under two timed days to learn from: none, so nothing closes by itself', () => {
    const sim = paceLog(24, { sessions: 3 });
    expect(quietAfter(sim.entries, sim.days[1])).toBeNull();
    expect(quietAfter(sim.entries, sim.days[2])).not.toBeNull();
    expect(quietAfter([], '2026-10-20')).toBeNull();
  });
});
