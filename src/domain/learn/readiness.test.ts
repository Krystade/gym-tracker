import { describe, expect, it } from 'vitest';
import type { BodyDay } from '../body';
import { resolveLift } from '../lifts';
import type { Muscle } from '../muscles';
import type { DayPlan, Program, Slot } from '../program';
import type { SetEntry } from '../types';
import { fitCore, READY } from './capacity';
import { BREAK_DAYS } from './deload';
import { deloadLog, SIM_LIFTS, simDay } from './deloadSim.sample';
import { normCdf } from './num';
import {
  candidatesOf, dayLabel, doneThisCycle, energyFit, liftFull, readiness, readinessModel, sessionResiduals, tQuantile, verdictOf, weekOf,
  type Readiness, type ReadinessInput, type VerdictFacts,
} from './readiness';
import { fitRecovery, type RecoveryCore, type RecoveryFit } from './recovery';
import { simulateRecovery } from './recoverySim.sample';

// learn/readiness (S2): the lift's P(full strength) from learn/recovery's cells, the day's verdict, the energy slope and the
// candidates. Synthetic only; no personal data.

const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const hourOf = (iso: string) => Date.parse(iso) / 36e5;
/** A core whose persistent loss per set is ρA (no lifts known: κ = 30 for all), as learn/recovery's tests. */
const coreWith = (rhoA: number): RecoveryCore => ({
  drift: 0.01, gap: 180, fit: { theta: [1, 0.5, 0.05] },
  rest: { cells: [{ w: 1, rho: 0.5, theta: [2 * rhoA, 0.5, 0.05] }] }, lifts: new Map(),
});
/** `n` sets of `reps` of a lift on `date` from 17:00, three minutes apart; RIR 0 when `fail`. */
const session = (date: string, exercise: string, n: number, reps: number, fail: boolean, extra: Partial<SetEntry> = {}): SetEntry[] =>
  Array.from({ length: n }, (_, k) => ({
    id: `t|${date}|${exercise}|${k + 1}`, date, seq: k, loggedAt: new Date(Date.parse(`${date}T17:00:00Z`) + k * 180e3).toISOString(),
    exercise, setNo: k + 1, weight: 100, reps, flags: [], source: 'test', ...(fail ? { rir: 0 } : { rir: 3 }), ...extra,
  }));
const slot = (exercise: string, sets = 3): Slot => ({ exercise, sets, repMin: 8, repMax: 12 });
const program = (days: [string, Slot[]][]): Program => ({ key: 'program', perSession: 12, createdAt: '', days: days.map(([name, slots]) => ({ name, slots })) });
const plan = (date: string, day: number, extra: Partial<DayPlan> = {}): DayPlan => ({ key: `day:${date}`, date, day, skips: [], swaps: {}, ...extra });

/** Every string anywhere in a value (labels, verdicts, evidence, names). */
const strings = (x: unknown, out: string[] = []): string[] => {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => strings(y, out));
  return out;
};
/** A clock time: "17:40", "7:05", "5pm", "5 am". Owner Q2: none, anywhere. */
const CLOCK = /\d{1,2}:\d{2}|\b\d{1,2}\s?(am|pm)\b/i;
const clockTimes = (x: unknown) => strings(x).filter((s) => CLOCK.test(s));

describe('learn/readiness: a lift’s P(full strength)', () => {
  // Hard leg sessions (Leg Press: Quads 1, Glutes ½, Hamstrings ½; to failure), then the lifts read at hours after.
  const es = [...session('2026-03-02', 'Leg Press', 4, 10, true), ...session('2026-03-02', 'Leg Extension', 3, 12, true)];
  const fit = fitRecovery(es, coreWith(1.5), '2026-03-02', 'UTC');
  const end = hourOf(es.at(-1)!.loggedAt!);
  const hours = [0.5, 6, 24, 48, 96].map((h) => end + h);

  it('a lift that works one muscle at 1 reads exactly learn/recovery’s P(recovered) of that muscle', () => {
    expect(resolveLift('Leg Extension').m).toEqual({ Quads: 1 });
    const ps = hours.map((h) => liftFull(fit, 'Leg Extension', h));
    hours.forEach((h, i) => expect(ps[i]).toBeCloseTo(fit.pAtHour('Quads', h), 12));
    // Discriminating: it moves over the hours (else equality with a constant would prove nothing).
    expect(ps[0]).toBeLessThan(0.5);
    expect(ps.at(-1)!).toBeGreaterThan(ps[0] + 0.3);
  });

  /** The exact mixture: every combination of the muscles' cells within each φ, no merging. */
  const brute = (f: RecoveryFit, exercise: string, hour: number): number => {
    const v = resolveLift(exercise).m!;
    const ms = (Object.entries(v) as [Muscle, number][]).filter(([, w]) => w > 0);
    const vv = ms.reduce((a, [, w]) => a + w * w, 0);
    const cells = ms.map(([m]) => f.cells(m, hour));
    const phis = [...new Set(cells[0].map((c) => c.phi))];
    let p = 0;
    for (const phi of phis) {
      const own = cells.map((cs) => cs.filter((c) => c.phi === phi));
      const tot = own.map((cs) => cs.reduce((a, c) => a + c.w, 0));
      const rec = (i: number, w: number, X: number, B: number, S: number): void => {
        if (i === ms.length) { p += w * (X > 0 ? normCdf((READY - B) / S) : 1) * tot[0]; return; }
        const u = ms[i][1] / vv;
        for (const c of own[i]) rec(i + 1, w * c.w / tot[i], X + u * c.x, B + u * c.x * c.beta.mean, S + u * c.x * c.beta.sd);
      };
      rec(0, 1, 0, 0, 0);
    }
    return p;
  };
  it('a lift over several muscles is the mixture over every combination of their cells (Σ u·D, φ shared), merged within 1e-3', () => {
    let moved = 0;
    for (const h of hours) {
      const a = liftFull(fit, 'Leg Press', h), b = brute(fit, 'Leg Press', h);
      expect(Math.abs(a - b), `hour +${(h - end).toFixed(1)}`).toBeLessThan(1e-3);
      if (a < 0.99) moved++;
    }
    expect(moved).toBeGreaterThan(1); // the comparison isn't all 1 = 1
    // Not a per-muscle average: the lift reads Σ u·D_m, so its own deposit comes back whole (less fresh than glutes alone).
    const h = end + 24;
    expect(liftFull(fit, 'Leg Press', h)).toBeLessThan(fit.pAtHour('Glutes', h) - 0.05);
  });

  it('no fit, an unknown lift or no deficit: full strength (c), unless energy shifts it', () => {
    expect(liftFull(null, 'Leg Press', end)).toBe(1);
    expect(liftFull(fit, 'Mystery Machine 3000', end)).toBe(1);
    expect(liftFull(fit, 'DB Curl', end)).toBeCloseTo(1, 12); // no biceps deposit
    expect(liftFull(fit, 'DB Curl', end, { mean: -0.04, sd: 0.01 })).toBeCloseTo(normCdf((READY - 0.04) / 0.01), 12);
    expect(liftFull(fit, 'DB Curl', end, { mean: 0.02, sd: 0.01 })).toBeGreaterThan(0.99);
  });
});

describe('learn/readiness: the verdict (table)', () => {
  // Every combination of the facts that decide it.
  const weeks: VerdictFacts['week'][] = [{ slack: -1, tight: true }, { slack: 0, tight: true }, { slack: 1, tight: false }, { slack: 3, tight: false }, { slack: 6, tight: false }];
  const grid: VerdictFacts[] = [];
  for (const sinceLast of [null, 0, 1, BREAK_DAYS - 1, BREAK_DAYS, 30])
    for (const systemic of [null, 'deload', 'break', 'light', 'few', 'steady', 'alone'] as const)
      for (const lightOn of [false, true]) for (const week of weeks) for (const todayInPlan of [undefined, null, true, false])
        grid.push({ sinceLast, systemic, lightOn, week, todayInPlan });
  const rows = grid.map((f) => ({ f, v: verdictOf(f) }));
  const layoff = (f: VerdictFacts) => f.sinceLast == null || f.sinceLast >= BREAK_DAYS;

  it('after a layoff of BREAK_DAYS or more (or none trained yet): always Go, whatever else holds', () => {
    const xs = rows.filter((r) => layoff(r.f));
    expect(xs.length).toBeGreaterThan(100);
    for (const { f, v } of xs) expect(v, JSON.stringify(f)).toEqual({ kind: 'go', why: 'layoff', label: 'Go today' });
    // The pair: a day short of it, the same facts can rest or go light.
    const short = rows.filter((r) => r.f.sinceLast === BREAK_DAYS - 1);
    expect(short.some((r) => r.v.kind === 'rest')).toBe(true);
    expect(short.some((r) => r.v.kind === 'light')).toBe(true);
  });

  it('a deload or a light week: Go light (unless a layoff, or the planner’s rest day with a spare day)', () => {
    const xs = rows.filter((r) => !layoff(r.f) && (r.f.systemic === 'deload' || r.f.lightOn) && !(r.f.todayInPlan === false && r.f.week.slack >= 1));
    expect(xs.length).toBeGreaterThan(50);
    for (const { f, v } of xs) {
      expect(v.kind, JSON.stringify(f)).toBe('light');
      expect(v.label).toBe(f.week.tight ? 'Go light · tight week' : 'Go light');
    }
    // Pair: 'alone' or 'steady' with no light week is never light.
    expect(rows.filter((r) => !r.f.lightOn && r.f.systemic !== 'deload').every((r) => r.v.kind !== 'light')).toBe(true);
  });

  it('zero slack: never Rest, even when the planner says rest', () => {
    const xs = rows.filter((r) => r.f.week.tight);
    expect(xs.filter((r) => r.f.todayInPlan === false).length).toBeGreaterThan(20);
    for (const { f, v } of xs) expect(v.kind, JSON.stringify(f)).not.toBe('rest');
    expect(xs.filter((r) => !layoff(r.f) && r.f.systemic !== 'deload' && !r.f.lightOn).every((r) => r.v.label === 'Go today · tight week')).toBe(true);
  });

  it('no planner (todayInPlan left out): never Rest; the planner’s rest day with a spare day: Rest (pair)', () => {
    const none = rows.filter((r) => r.f.todayInPlan == null);
    expect(none.length).toBeGreaterThan(100);
    expect(none.every((r) => r.v.kind !== 'rest')).toBe(true);
    const rest = rows.filter((r) => r.f.todayInPlan === false && !layoff(r.f) && r.f.week.slack >= 1);
    expect(rest.length).toBeGreaterThan(20);
    expect(rest.every((r) => r.v.kind === 'rest' && r.v.label === 'Rest today')).toBe(true);
  });
});

describe('learn/readiness: the week', () => {
  // 2026-03-02 is a Monday.
  const es = [...session('2026-03-02', 'DB Curl', 3, 10, false), ...session('2026-03-04', 'DB Curl', 3, 10, false)];
  it('sessions before today this week, still needed, days left (today in), and the slack', () => {
    expect(weekOf(es, 3, '2026-03-05')).toEqual({ goal: 3, done: 2, needed: 1, daysLeft: 4, slack: 3, tight: false });
    expect(weekOf(es, 6, '2026-03-05')).toEqual({ goal: 6, done: 2, needed: 4, daysLeft: 4, slack: 0, tight: true });
    expect(weekOf(es, 7, '2026-03-05').tight).toBe(true); // out of reach: still no spare day
    expect(weekOf(es, 2, '2026-03-08')).toMatchObject({ needed: 0, daysLeft: 1, tight: false }); // goal met on Sunday
    expect(weekOf(es, 2, '2026-03-09')).toMatchObject({ done: 0, needed: 2, daysLeft: 7 }); // a new week
  });
});

describe('learn/readiness: candidates', () => {
  const P = program([['Legs', [slot('Leg Press'), slot('Leg Extension')]], ['Push', [slot('Bench Press'), slot('Cable Pushdown')]], ['Pull', [slot('Lat Pulldown'), slot('DB Curl')]]]);
  const day = (date: string) => session(date, 'DB Curl', 2, 10, false);

  it('done this cycle: trained program days in order, a cycle closing once every day is done or one comes round again', () => {
    const run = (ds: number[]) => {
      const dates = ds.map((_, i) => addD('2026-03-02', 2 * i));
      return [...doneThisCycle(P, dates.map((d, i) => plan(d, ds[i])), dates.flatMap(day), '2026-04-01')].sort();
    };
    expect(run([0, 1])).toEqual([0, 1]);
    expect(run([0, 1, 2])).toEqual([]);
    expect(run([0, 1, 2, 0])).toEqual([0]);
    expect(run([1, 0])).toEqual([0, 1]); // reordered
    expect(run([0, 0])).toEqual([0]); // a day again before the rest: a new cycle
    // A plan with nothing logged, or a quick day, doesn't count.
    expect([...doneThisCycle(P, [plan('2026-03-02', 0), plan('2026-03-04', 1, { quick: 30 })], [...day('2026-03-04')], '2026-04-01')]).toEqual([]);
  });

  it('the next day, the days not yet done this cycle, and the quick day; today’s opened plan with its skips and swaps', () => {
    const plans = [plan('2026-03-02', 0)];
    const cs = candidatesOf(P, plans, day('2026-03-02'), '2026-03-04', [slot('Hammer Curl', 2)]);
    expect(cs.map((c) => [c.kind, c.day, c.name])).toEqual([['next', 1, 'Push'], ['cycle', 2, 'Pull'], ['quick', null, 'Quick']]);
    const opened = candidatesOf(P, [...plans, plan('2026-03-04', 2, { skips: ['DB Curl'], swaps: { 'Lat Pulldown': 'Seated Cable Row' } })], day('2026-03-02'), '2026-03-04', null);
    expect(opened[0]).toMatchObject({ kind: 'next', day: 2, slots: [slot('Seated Cable Row')] });
    expect(opened.map((c) => c.day)).toEqual([2, 1]);
  });

  it('no program and no quick day: no candidates, Ready null, still a verdict (and never Rest)', () => {
    expect(candidatesOf(null, [], [], '2026-03-04', null)).toEqual([]);
    expect(candidatesOf(program([]), [], [], '2026-03-04', [])).toEqual([]);
    const r = readiness({ entries: day('2026-03-02'), body: [], weeklyGoal: 2, program: null, plans: [], quick: null, today: '2026-03-04', tz: 'UTC', todayInPlan: false });
    expect(r.candidates).toEqual([]);
    expect(r.ready).toBeNull();
    expect(r.best).toBeNull();
    expect(r.bestNext).toBeNull();
    expect(r.verdict.kind).toBe('rest'); // the planner's call stands: no candidate is no reason to train
    expect(readiness({ entries: day('2026-03-02'), body: [], weeklyGoal: 2, program: null, plans: [], quick: null, today: '2026-03-04', tz: 'UTC' }).verdict.kind).toBe('go');
  });
});

describe('learn/readiness: the day on a synthetic lifter', () => {
  // 60 sessions (true τ′ 32 h, φ 8), then a leg session to failure yesterday.
  const { entries: base } = simulateRecovery(1, { sessions: 60, failFrac: 0.3 });
  const last = base.at(-1)!.date, yesterday = addD(last, 2), today = addD(last, 3);
  const legs = [...session(yesterday, 'Leg Press', 5, 12, true), ...session(yesterday, 'Leg Extension', 4, 12, true)];
  const entries = [...base, ...legs];
  const P = program([['Legs', [slot('Leg Press', 4), slot('Leg Extension', 3)]], ['Upper', [slot('Bench Press', 4), slot('Lat Pulldown', 4), slot('DB Curl', 3)]]]);
  const input = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({ entries, body: [], weeklyGoal: 3, program: P, plans: [], quick: [slot('DB Lateral Raise', 2)], today, tz: 'UTC', ...o });

  it('Ready is the best candidate’s: the legs trained to failure yesterday score below the upper day, which is chosen', () => {
    const r = readiness(input());
    expect(r.candidates.length).toBe(3);
    const by = Object.fromEntries(r.candidates.map((c) => [c.name, c]));
    expect(by.Legs.ready!).toBeLessThan(by.Upper.ready! - 30);
    expect(r.ready).toBe(Math.max(...r.candidates.map((c) => c.ready!)));
    expect(r.best!.name).not.toBe('Legs');
    expect(r.candidates.every((c) => c.lifts.length > 0 && c.total > 0)).toBe(true);
    expect(by.Legs.full).toBeLessThan(by.Legs.total);
    // Best next for the legs is after today; the share line names both sources.
    const legsFresh = by.Legs.freshBy!;
    expect(legsFresh > today).toBe(true);
    expect(r.source.label).toMatch(/^research \d+% · you \d+%$/);
    expect(r.source.research + r.source.you).toBe(100);
    // Pair: a week later the legs are as ready as the rest.
    const later = readiness(input({ today: addD(today, 6) }));
    const lb = Object.fromEntries(later.candidates.map((c) => [c.name, c]));
    expect(lb.Legs.ready!).toBeGreaterThan(by.Legs.ready! + 30);
  });

  it('Best next names the day the best candidate is fresh, when that is after today', () => {
    // Only the legs to choose from: Best next is the legs' fresh day.
    const r = readiness(input({ program: program([['Legs', [slot('Leg Press', 4), slot('Leg Extension', 3)]]]), quick: null }));
    expect(r.candidates.length).toBe(1);
    expect(r.bestNext).not.toBeNull();
    expect(r.bestNext!.date > today).toBe(true);
    expect(r.bestNext!.label).toBe(`Best next: ${dayLabel(r.bestNext!.date, today)}`);
    expect(readiness(input()).bestNext).toBeNull(); // the upper day is fresh today
  });

  it('a layoff: Go, even on the planner’s rest day; a day short of it, the rest day stands (pair)', () => {
    const away = readiness(input({ today: addD(yesterday, BREAK_DAYS), todayInPlan: false }));
    expect(away.layoff).toEqual({ sinceLast: BREAK_DAYS, on: true });
    expect(away.verdict).toMatchObject({ kind: 'go', why: 'layoff' });
    const short = readiness(input({ today: addD(yesterday, BREAK_DAYS - 1), todayInPlan: false, weeklyGoal: 1 }));
    expect(short.verdict.kind).toBe('rest');
  });

  it('a light week on: Go light; zero slack: Go today · tight week, never Rest', () => {
    const lightLog = [...entries, ...session(yesterday, 'DB Curl', 2, 10, false, { flags: ['light'] })];
    expect(readiness(input({ entries: lightLog })).verdict).toMatchObject({ kind: 'light', why: 'light', label: 'Go light' });
    const tight = readiness(input({ weeklyGoal: 7, todayInPlan: false }));
    expect(tight.week.tight).toBe(true);
    expect(tight.verdict).toMatchObject({ kind: 'tight', label: 'Go today · tight week' });
  });

  it('a lift that keeps hurting lowers its sets (× 1 − pain risk); the same log without pain does not (pair)', () => {
    const hurt = entries.map((e) => (e.exercise === 'DB Curl' && e.date >= addD(last, -40) ? { ...e, flags: [...e.flags, 'pain' as const] } : e));
    const curl = (es: SetEntry[]) => readiness(input({ entries: es })).candidates.find((c) => c.name === 'Upper')!;
    const a = curl(entries), b = curl(hurt);
    const la = a.lifts.find((l) => l.exercise === 'DB Curl')!, lb = b.lifts.find((l) => l.exercise === 'DB Curl')!;
    expect(lb.pain).toBeGreaterThan(la.pain + 0.2);
    expect(Math.abs(lb.pFull - la.pFull)).toBeLessThan(0.05); // pain is its own term (the core reads pain sets a little differently)
    expect(b.ready!).toBeLessThan(a.ready! - 5);
    const want = Math.round(100 * b.lifts.reduce((s, l) => s + l.sets * l.pFull * (1 - l.pain), 0) / b.total);
    expect(b.ready).toBe(want);
  });

  it('no pain ever flagged: the pain model’s prior (½ on day one) takes no action; a first session reads 100', () => {
    const first = session('2026-03-02', 'DB Curl', 3, 10, false);
    const r = readiness({ entries: first, body: [], weeklyGoal: 2, program: program([['Arms', [slot('DB Curl')]]]), plans: [], quick: null, today: '2026-03-02', tz: 'UTC' });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].lifts[0].pain).toBe(0);
    expect(r.ready).toBe(100);
    expect(r.evidence.find((e) => e.rule.startsWith('Pain'))).toMatchObject({ kind: 'default', acts: false });
    // Pair: once a pain is flagged, the risk acts (and is labelled learned).
    const hurt = [...first, ...session('2026-03-04', 'DB Curl', 3, 10, false, { flags: ['pain'] })];
    const h = readiness({ entries: hurt, body: [], weeklyGoal: 2, program: program([['Arms', [slot('DB Curl')]]]), plans: [], quick: null, today: '2026-03-06', tz: 'UTC' });
    expect(h.candidates[0].lifts[0].pain).toBeGreaterThan(0.1);
    expect(h.evidence.find((e) => e.rule.startsWith('Pain'))).toMatchObject({ kind: 'learned', acts: true });
  });

  it('evidence: every rule labelled (a) with a citation, (b) with a method, or (c) taking no action', () => {
    for (const r of [readiness(input()), readiness(input({ todayInPlan: false, weeklyGoal: 1 })), readiness(input({ weeklyGoal: 7 }))]) {
      expect(r.evidence.length).toBeGreaterThanOrEqual(8);
      for (const e of r.evidence) {
        if (e.kind === 'research') expect(e.cite, e.rule).toBeTruthy();
        if (e.kind === 'learned') expect(e.method, e.rule).toBeTruthy();
        if (e.kind === 'default') expect(e.acts, e.rule).toBe(false);
      }
      expect(r.evidence.find((e) => e.share)!.share!.label).toBe(r.source.label);
    }
  });
});

describe('learn/readiness: deload (learn/deload on a synthetic log with a known drop)', () => {
  const WEEKS = 8, END = simDay(WEEKS * 7);
  const lastWeek = (by: number) => (w: number) => (w === WEEKS - 1 ? by : 0);
  const energy = (recent: number, usual: number): BodyDay[] => [
    { date: simDay(10), energy: usual as 3 }, { date: simDay(20), energy: usual as 3 }, { date: simDay(WEEKS * 7 - 3), energy: recent as 3 }, { date: END, energy: recent as 3 },
  ];
  it('deload → Go light; the same drop without a second signal → Go today (pair)', () => {
    const log = deloadLog(1, SIM_LIFTS, { weeks: WEEKS, shift: lastWeek(-0.06) });
    const P = program([['All', SIM_LIFTS.map((l) => slot(l.name))]]);
    const at = (body: BodyDay[]) => readiness({ entries: log, body, weeklyGoal: 2, program: P, plans: [], quick: null, today: END, tz: 'UTC' });
    expect(at(energy(2, 4)).verdict).toMatchObject({ kind: 'light', why: 'deload', label: 'Go light' });
    expect(at([]).verdict).toMatchObject({ kind: 'go', why: 'default' });
  });
});

describe('learn/readiness: energy acts only once proven', () => {
  const dayAfter = (d: string) => addD(d, 1);
  const fitAt = (seed: number, slope: number, logged: number) => {
    const { entries, body } = simulateRecovery(seed, { sessions: 60, energy: { slope, logged } });
    const today = dayAfter(entries.at(-1)!.date);
    return { e: energyFit(sessionResiduals(fitCore(entries), today), body, today), entries, body, today };
  };
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it('t quantiles: 6.314 (1 df), 2.353 (3 df), 1.645 (large)', () => {
    expect(tQuantile(0.95, 1)).toBeCloseTo(6.314, 3);
    expect(tQuantile(0.95, 3)).toBeCloseTo(2.353, 3);
    expect(tQuantile(0.95, 1e6)).toBeCloseTo(1.645, 3);
  });

  it('pair: a 2 %-per-point slope stays inert at his ~5 energy days and acts at 60, near the truth', () => {
    const few = seeds.map((s) => fitAt(s, 0.02, 5).e);
    expect(few.every((e) => e.n <= 5 && e.status !== 'active' && e.shift.mean === 0)).toBe(true);
    const many = seeds.map((s) => fitAt(s, 0.02, 60).e);
    expect(many.every((e) => e.n >= 50)).toBe(true);
    expect(many.filter((e) => e.status === 'active').length).toBe(seeds.length);
    for (const e of many) expect(Math.abs(e.slope!.mean - 0.02)).toBeLessThan(3 * e.slope!.sd);
  });

  it('negative control: 60 energy days with no slope stay inert (a 90 % interval: ≤ 1 of 8 by chance)', () => {
    const none = seeds.map((s) => fitAt(s, 0, 60).e);
    expect(none.every((e) => e.n >= 50)).toBe(true);
    expect(none.filter((e) => e.status === 'active').length).toBeLessThanOrEqual(1);
  });

  it('once active, low energy today lowers Ready; inert, the same day reads the same as with no energy logged', () => {
    const P = program([['Upper', [slot('Bench Press', 4), slot('DB Curl', 3)]]]);
    const run = (logged: number, todayE: number | null) => {
      const { entries, body, today } = fitAt(1, 0.02, logged);
      const b = todayE == null ? body : [...body, { date: today, energy: todayE as 1 }];
      return readiness({ entries, body: b, weeklyGoal: 3, program: P, plans: [], quick: null, today, tz: 'UTC' });
    };
    const flat = run(60, null), low = run(60, 1);
    expect(low.energy.status).toBe('active');
    expect(low.energy.shift.mean).toBeLessThan(-0.02);
    expect(low.ready!).toBeLessThan(flat.ready! - 20);
    expect(low.evidence.find((e) => e.rule.startsWith('Energy'))).toMatchObject({ kind: 'learned', acts: true });
    const few = run(5, 1), fewFlat = run(5, null);
    expect(few.energy.status).not.toBe('active');
    expect(few.ready).toBe(fewFlat.ready);
    expect(few.evidence.find((e) => e.rule.startsWith('Energy'))).toMatchObject({ kind: 'default', acts: false });
  });
});

describe('learn/readiness: by the day, never a clock time (owner Q2)', () => {
  it('the detector catches a planted time (so the checks below can fail)', () => {
    expect(clockTimes({ verdict: { label: 'Go from 17:40' } })).toEqual(['Go from 17:40']);
    expect(clockTimes(['Fresh 7:05', 'by 5pm', 'Best next: Thu', '2026-03-02', 'research 80% · you 20%'])).toEqual(['Fresh 7:05', 'by 5pm']);
  });

  it('day labels: today, tomorrow, a weekday this week, else weekday and date; none a time', () => {
    expect(dayLabel('2026-03-02', '2026-03-02')).toBe('today');
    expect(dayLabel('2026-03-03', '2026-03-02')).toBe('tomorrow');
    expect(dayLabel('2026-03-05', '2026-03-02')).toBe('Thu');
    expect(dayLabel('2026-03-12', '2026-03-02')).toBe('Thu 12 Mar');
    const ls = Array.from({ length: 400 }, (_, n) => dayLabel(addD('2026-03-02', n), '2026-03-02'));
    expect(ls.length).toBe(400);
    expect(clockTimes(ls)).toEqual([]);
  });

  it('no string in any readiness output holds a clock time: every verdict, over a synthetic year of days', () => {
    const { entries, body } = simulateRecovery(3, { sessions: 120, failFrac: 0.3, energy: { slope: 0.02 } });
    const P = program([['A', [slot('Bench Press', 4), slot('Leg Press', 4)]], ['B', [slot('Lat Pulldown', 4), slot('DB Curl', 3)]]]);
    const dates = [...new Set(entries.map((e) => e.date))];
    const outs: Readiness[] = [];
    for (let i = 10; i < dates.length; i += 6) for (const [goal, inPlan] of [[2, undefined], [7, false], [1, false], [3, true]] as const) {
      outs.push(readiness({ entries, body, weeklyGoal: goal, program: P, plans: [plan(dates[i - 1], i % 2)], quick: [slot('Hammer Curl', 2)], today: dates[i], tz: 'UTC', todayInPlan: inPlan }));
    }
    outs.push(readiness({ entries, body, weeklyGoal: 2, program: P, plans: [], quick: null, today: addD(dates.at(-1)!, 30), tz: 'UTC' }));
    const kinds = new Set(outs.map((r) => r.verdict.kind));
    for (const k of ['go', 'rest', 'tight'] as const) expect(kinds.has(k), k).toBe(true); // light: its own tests
    expect(outs.some((r) => r.bestNext)).toBe(true);
    const all = strings(outs);
    expect(all.length).toBeGreaterThan(1000);
    expect(clockTimes(outs)).toEqual([]);
  }, 30000);
});

describe('learn/readiness: the model for S3', () => {
  it('Ready of any slots on any date from today on; a later date is never less fresh for the same deposits', () => {
    const { entries } = simulateRecovery(2, { sessions: 40, failFrac: 0.5 });
    const today = addD(entries.at(-1)!.date, 1);
    const m = readinessModel(entries, [], today, 'UTC');
    expect(m.recovery).not.toBeNull();
    const slots = [slot('Bench Press', 4), slot('Lat Pulldown', 4), slot('Leg Press', 4)];
    const rs = [0, 1, 2, 4, 8].map((d) => m.sessionReady(slots, addD(today, d)));
    expect(rs.every((r) => r.ready != null && r.lifts.length === 3)).toBe(true);
    for (let i = 1; i < rs.length; i++) for (let k = 0; k < 3; k++) expect(rs[i].lifts[k].pFull).toBeGreaterThanOrEqual(rs[i - 1].lifts[k].pFull - 1e-9);
    expect(m.sessionReady([{ exercise: 'Treadmill', sets: 1, repMin: 0, repMax: 0, minutes: 20 }], today)).toMatchObject({ ready: null, total: 0, lifts: [] });
  });
});
