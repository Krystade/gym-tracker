import { expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { simulate, SIM_LIFTS } from './coreSim.sample';
import { learn } from './index';
import { painFit } from './pain';
import { DELTA, kneeAfter, restDelta } from './rest';
import { systemic } from './deload';
import { volumeAdvice } from './volume';
import { defaultProfile } from '../profile';
import { paceFit, sessionLengths } from './session';
import { paceLog, PACE_TRUTH } from './sessionSim.sample';
import { fitReminder } from './remind';
import { addDays } from '../analytics';
import { gapModel } from './switch';
import { simulate as switchSim } from './switchSim.sample';
import { fitCore } from './capacity';
import { fitRecovery } from './recovery';
import { simulateRecovery } from './recoverySim.sample';
import { readiness } from './readiness';
import { readinessPlanned } from './schedule';
import type { Program } from '../program';

// Shared CI runners are 2-4x slower than a desktop and vary run to run, so wall-clock budgets there catch only an
// order-of-magnitude regression. Locally (and on the phone's terms) the budgets stand as written.
const SLACK = process.env.CI ? 4 : 1;

// Phone budget (00-core §1.3): with 5 years of training (1,000 sessions, ~4 a week: ~14k sets) a refit after one more set stays
// under 50 ms on an iPhone 13 mini. The new set rebuilds only today's session block and copies only its rows (learn/capacity);
// the rest is the solve. Desktop Node does it in ~15–25 ms, so the gate is the phone's own 50 ms: a wide margin for a slow or
// busy CI runner. The timing is the best of several refits, each on a new log array with one more set (as the store makes on
// every add), so a moment of load slows a run without failing it.
it('refits 5 years of synthetic training in under 50 ms after one more set', () => {
  const { entries } = simulate(11, { sessions: 1000 });
  const last = entries.at(-1)!;
  const log = entries.slice(0, -1);
  learn(log);
  let n = 0;
  const addSet = (): SetEntry[] => {
    n++;
    log.push({ ...last, id: `${last.id}+${n}`, seq: last.seq + n, setNo: last.setNo + n, loggedAt: new Date(Date.parse(last.loggedAt!) + n * 150_000).toISOString() });
    return [...log];
  };
  for (let k = 0; k < 10; k++) learn(addSet()); // JIT warm-up (the first few refits after a cold start run partly unoptimised)
  const times: number[] = [];
  for (let k = 0; k < 9; k++) {
    const next = addSet();
    const t = performance.now();
    learn(next);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(log.length).toBeGreaterThan(12000);
  expect(times[0], `refits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(50 * SLACK);
}, 120000);

// Item 08's pain fit (learn/pain) refits the whole log too, on each change: 5 years (~4,600 lift-sessions) in ~10 ms on desktop
// Node. Gated at 25 ms, half the phone's refit budget, timed as above (best of several, each on a new log array).
it('fits 5 years of pain history in under 25 ms', () => {
  const { entries } = simulate(11, { sessions: 1000 });
  const log = entries.map((x, i) => (i % 97 === 0 ? { ...x, flags: [...x.flags, 'pain' as const] } : x));
  for (let k = 0; k < 5; k++) painFit([...log]);
  const times: number[] = [];
  for (let k = 0; k < 9; k++) {
    const next = [...log];
    const t = performance.now();
    painFit(next).risk('Bench Press', '2031-01-01');
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(painFit(log).sessions).toBeGreaterThan(4000);
  expect(times[0], `fits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(25 * SLACK);
}, 120000);

// Item 11's pace fit (learn/session) refits only when the days before today change (a new day, an edit to a past one): a set
// logged today reuses it (the next test). 5 years of timed sessions (1,000 sessions of 13 sets, ~12k gaps) take ~12 ms on
// desktop Node alone, ~25 ms with the whole suite running beside it. Off the per-set path, so gated at the phone's 50 ms refit
// budget (best of several, each on a new log array).
it('fits 5 years of timed sessions in under 50 ms', () => {
  const { entries } = paceLog(3, { sessions: 1000, breaks: 0.02 });
  for (let k = 0; k < 5; k++) paceFit([...entries]);
  const times: number[] = [];
  for (let k = 0; k < 9; k++) {
    const next = [...entries];
    const t = performance.now();
    paceFit(next)!.forecast([{ exercise: 'Bench Press' }, { exercise: 'Bench Press' }], { date: '2031-01-01' });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(paceFit(entries)!.gaps).toBeGreaterThan(11000);
  expect(times[0], `fits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(50 * SLACK);
}, 120000);

// A set logged today makes a new log, but the days before are the same: the plan header's length and pace reuse the fit and
// only read today. Gated at 5 ms a set (desktop ~1 ms).
it('a set logged today re-reads only today for the plan’s length and his pace', () => {
  const { entries } = paceLog(3, { sessions: 1000 });
  const date = '2031-01-01';
  const slots = [{ exercise: 'Bench Press', sets: 3 }, { exercise: 'Lat Pulldown', sets: 3 }, { exercise: 'Cable Curl', sets: 3 }];
  const log = [...entries];
  let t0 = Date.parse(`${date}T17:00:00Z`);
  const addSet = (i: number): SetEntry[] => {
    t0 += Math.exp(PACE_TRUTH.base) * 1000;
    log.push({ id: `today${i}`, date, seq: 1e6 + i, exercise: slots[Math.min(2, Math.floor(i / 3))].exercise, setNo: i + 1, weight: 100, reps: 10, flags: [], source: 'app', loggedAt: new Date(t0).toISOString() });
    return [...log];
  };
  sessionLengths(addSet(0), date, slots);
  const times: number[] = [];
  for (let i = 1; i < 9; i++) {
    const next = addSet(i);
    const t = performance.now();
    sessionLengths(next, date, slots);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(sessionLengths(log, date, slots).pace).not.toBeNull();
  expect(times[0], `per set (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(5 * SLACK);
}, 120000);

// Item 17's knee (learn/rest), with knees in use (Rahimi-like recovery, 1–3 min rests, 5 years): the timer's after each set, and the
// day's δ when the plan runs past its minutes (TodayScreen, on each log change). The core as of the days before is kept while
// they're the same sets, so a set logged today reads only today. Desktop ~0.5 ms and ~6 ms; gated at 5 ms and 25 ms.
it('the knee after a set, and the day’s δ, stay cheap as today’s sets are logged', () => {
  const { entries } = simulate(3, { sessions: 1000, gapMedian: 90, gapSd: 0.6, truth: { aSame: 5, tau: 120, rho: 0.1, aCross: 1.5, aLift: SIM_LIFTS.map(() => 4.25) } });
  const date = '2031-06-01';
  const log = [...entries];
  let t0 = Date.parse(`${date}T17:00:00Z`);
  const add = (i: number): SetEntry => {
    t0 += 130e3;
    const e: SetEntry = { id: `knee${i}`, date, seq: 1e7 + i, exercise: SIM_LIFTS[Math.floor(i / 4)].name, setNo: (i % 4) + 1, weight: 100, reps: 8, flags: [], source: 'app', loggedAt: new Date(t0).toISOString() };
    log.push(e);
    return e;
  };
  const slots = SIM_LIFTS.slice(0, 5).map((l) => ({ exercise: l.name, sets: 4 }));
  kneeAfter([...log], add(0));
  restDelta([...log], date, slots, 30);
  const knee: number[] = [], delta: number[] = [];
  for (let i = 1; i < 12; i++) {
    const before = [...log], e = add(i), after = [...log];
    let t = performance.now();
    const k = kneeAfter(before, e);
    knee.push(performance.now() - t);
    expect(k?.use).toBe(true);
    t = performance.now();
    expect(restDelta(after, date, slots, 30)).toBeGreaterThan(DELTA);
    delta.push(performance.now() - t);
  }
  knee.sort((a, b) => a - b); delta.sort((a, b) => a - b);
  expect(knee[0], `knee per set (ms): ${knee.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(5 * SLACK);
  expect(delta[0], `δ per log (ms): ${delta.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(25 * SLACK);
}, 120000);

// Item 06's check (learn/deload) runs on Today with each change of the log: the core as of the days before today (kept while they're
// the same sets, learn/rest coreFor), every lift's recent shift, the pool, and the shift scale over his past stretches (kept per
// core). 5 years of training with a week off after every 24 training days; desktop ~1.5 ms a set; gated at 10 ms.
it('the deload check stays cheap as today’s sets are logged', () => {
  const { entries } = simulate(5, { sessions: 1000 });
  const days = [...new Set(entries.map((e) => e.date))].sort();
  // A week off after every 24th training day: about 40 stretches for the scale to learn from.
  const shift = new Map(days.map((d, i) => [d, Math.floor(i / 24) * 7]));
  const move = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
  const log = entries.map((e) => ({ ...e, date: move(e.date, shift.get(e.date)!) }));
  const date = move(log.reduce((d, e) => (e.date > d ? e.date : d), ''), 2);
  const body = [{ date, energy: 3 as const }];
  let n = 0;
  const add = (): SetEntry[] => { n++; log.push({ ...log[0], id: `deload${n}`, date, seq: 1e7 + n, setNo: n }); return [...log]; };
  systemic(add(), body, date);
  const times: number[] = [];
  for (let k = 0; k < 9; k++) {
    const next = add();
    const t = performance.now();
    const s = systemic(next, body, date);
    times.push(performance.now() - t);
    expect(s).not.toBeNull();
  }
  times.sort((a, b) => a - b);
  expect(times[0], `per set (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(10 * SLACK);
}, 120000);

// Item 07's steps (learn/volume) on Stats, after a set is logged: 06's check, three weeks' muscle counts, the pooled per-muscle
// shift, and item 08's pain risk for each muscle below its range (a refit of the pain fit per new log array, shared with Today's
// cards). 5 years of training, every muscle priority 1 at 20–24 so all are below and asked; desktop ~3 ms a set; gated at 15 ms.
it('the volume steps stay cheap after a set is logged', () => {
  const { entries } = simulate(5, { sessions: 1000 });
  const date = new Date(Date.parse(entries.reduce((d, e) => (e.date > d ? e.date : d), '')) + 2 * 864e5).toISOString().slice(0, 10);
  const log = [...entries];
  const p = defaultProfile();
  const profile = { ...p, tiers: Object.fromEntries(Object.keys(p.tiers).map((m) => [m, 1])) as typeof p.tiers, targets: { ...p.targets, 1: [20, 24] as [number, number] } };
  let n = 0;
  const add = (): SetEntry[] => { n++; log.push({ ...log[0], id: `vol${n}`, date, seq: 1e7 + n, setNo: n }); return [...log]; };
  volumeAdvice(add(), [], profile, date);
  const times: number[] = [];
  let asked = 0;
  for (let k = 0; k < 9; k++) {
    const next = add();
    const t = performance.now();
    const a = volumeAdvice(next, [], profile, date)!;
    times.push(performance.now() - t);
    asked = a.muscles.filter((x) => x.kind === 'raise' || x.kind === 'hold').length;
  }
  times.sort((a, b) => a - b);
  expect(asked).toBeGreaterThan(3);
  expect(times[0], `per set (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(15 * SLACK);
}, 120000);

// Item 16's reminder fit (learn/remind) reads only the days before today, so it refits once a day (or after an edit to a past
// day), 3 s after the log changes, off any tap's path; a set logged today reuses it. 5 years of timed sessions (1,000, each with
// a first-entry time): the prequential kernel score is pairs × half-lives, ~50 ms on desktop Node. Gated at 100 ms: twice the
// phone's per-set budget, once a day. Best of several, each a new day (so a real refit).
it('fits 5 years of reminder history in under 100 ms, once a day; a set logged today reuses it in under 5 ms', () => {
  const { entries } = paceLog(3, { sessions: 1000, breaks: 0.02 });
  const last = entries.reduce((d, e) => (e.date > d ? e.date : d), '');
  for (let k = 0; k < 3; k++) fitReminder([...entries], addDays(last, 1 + k), 'UTC');
  const times: number[] = [];
  for (let k = 0; k < 7; k++) {
    const next = [...entries];
    const t = performance.now();
    fitReminder(next, addDays(last, 10 + k), 'UTC');
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const today = addDays(last, 10);
  expect(fitReminder(entries, today, 'UTC').timed).toBeGreaterThan(990);
  expect(times[0], `fits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(100 * SLACK);
  const per: number[] = [];
  const log = [...entries];
  for (let k = 0; k < 9; k++) {
    log.push({ ...log[0], id: `remind${k}`, date: today, seq: 1e7 + k, loggedAt: `${today}T18:0${k}:00.000Z` });
    const next = [...log];
    const t = performance.now();
    fitReminder(next, today, 'UTC');
    per.push(performance.now() - t);
  }
  per.sort((a, b) => a - b);
  expect(per[0], `per set (ms): ${per.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(5 * SLACK);
}, 120000);

// Item 15's gap model (learn/switch) refits once a day, on the first read of a new day: 5 years of timed sessions (1,000, most
// with a pair alternated or supersetted: every one offers a group to judge) is ~80 ms on desktop Node, soft EM to convergence.
// Gated at 150 ms; a set logged today reuses the day's fit (the days before are the same objects) in under 5 ms.
it('fits 5 years of supersets in under 150 ms, once a day; a set logged today reuses it in under 5 ms', () => {
  const log = switchSim({ walk: 30, set: 40, rest: 120 }, '2026-01-05', 1000, 3, (_, r) => (r.next() < 0.5 ? 'superset' : r.next() < 0.5 ? 'alternate' : 'straight'));
  const last = log.reduce((d, e) => (e.date > d ? e.date : d), '');
  for (let k = 0; k < 3; k++) gapModel([...log], addDays(last, 1 + k));
  const times: number[] = [];
  for (let k = 0; k < 5; k++) {
    const next = [...log];
    const t = performance.now();
    gapModel(next, addDays(last, 10 + k));
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const today = addDays(last, 10), m = gapModel(log, today);
  expect(m.days).toBe(1000);
  expect(m.switches).toBeGreaterThan(500);
  expect(times[0], `fits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(150 * SLACK);
  const per: number[] = [];
  const day = [...log];
  for (let k = 0; k < 9; k++) {
    day.push({ ...log[0], id: `gap${k}`, date: today, seq: 1e7 + k, loggedAt: `${today}T18:0${k}:00.000Z` });
    const next = [...day];
    const t = performance.now();
    expect(gapModel(next, today)).toBe(m);
    per.push(performance.now() - t);
  }
  per.sort((a, b) => a - b);
  expect(per[0], `per set (ms): ${per.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(5 * SLACK);
}, 120000);

it('refits per-muscle recovery on 2k sets in under 20 ms after one more set', () => {
  const { entries } = simulateRecovery(1, { sessions: 190, failFrac: 0.2 });
  const last = entries.at(-1)!, today = addDays(last.date, 1), core = fitCore(entries);
  for (let k = 0; k < 3; k++) fitRecovery([...entries], core, today, 'UTC');
  const times: number[] = [];
  for (let k = 0; k < 7; k++) {
    const next = [...entries, { ...last, id: `rec${k}`, seq: last.seq + 1 + k, setNo: last.setNo + 1 + k }];
    const t = performance.now();
    fitRecovery(next, core, today, 'UTC').freshBy('Chest');
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(entries.length).toBeGreaterThan(2000);
  expect(times[0], `refits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(20 * SLACK);
}, 60000);

// Readiness S2 (learn/readiness) on Today: the day's number over a 4-day program (the quick day isn't a candidate with a program,
// S3), on 2k sets of recovery history, after one more set today (as the store makes a new log array on every add): the fits
// before today are the last call's, so what's left is the candidates' cells, pain and the verdict. ~6–15 ms on desktop Node;
// gated at 25 ms (best of several).
it('re-reads the day’s readiness on 2k sets in under 25 ms after one more set today', () => {
  const { entries, body } = simulateRecovery(1, { sessions: 190, failFrac: 0.2, energy: { slope: 0.02 } });
  const last = entries.at(-1)!, today = addDays(last.date, 1);
  const s = (exercise: string, sets = 3) => ({ exercise, sets, repMin: 8, repMax: 12 });
  const program: Program = { key: 'program', perSession: 12, createdAt: '', days: [
    { name: 'A', slots: [s('Bench Press', 4), s('Incline DB Press'), s('Cable Pushdown')] },
    { name: 'B', slots: [s('Seated Cable Row', 4), s('Lat Pulldown'), s('DB Curl')] },
    { name: 'C', slots: [s('Leg Press', 4), s('DB Lateral Raise')] },
    { name: 'D', slots: [s('Bench Press'), s('Lat Pulldown'), s('Leg Press'), s('DB Curl')] }] };
  const at = (es: SetEntry[]) => readiness({ entries: es, body, weeklyGoal: 3, program, plans: [], quick: [s('DB Curl', 2), s('Cable Pushdown', 2)], today, tz: 'UTC' });
  for (let k = 0; k < 3; k++) at([...entries]);
  const times: number[] = [];
  for (let k = 0; k < 7; k++) {
    const next = [...entries, { ...last, id: `rdy${k}`, date: today, seq: last.seq + 1 + k, setNo: last.setNo + 1 + k, loggedAt: undefined }];
    const t = performance.now();
    const r = at(next);
    times.push(performance.now() - t);
    expect(r.candidates.length).toBe(4);
  }
  times.sort((a, b) => a - b);
  expect(entries.length).toBeGreaterThan(2000);
  expect(times[0], `per set (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(25 * SLACK);
}, 60000);

// Readiness S3 (learn/schedule) when Today opens on a Monday: the week's plan over a 4-day program, all 128 patterns, every day's
// Ready for each day of the program (28 sessions read), the volume aims and his usual days, plus the day's readiness with the
// plan's answer; on 2k sets of recovery history, each call on a new log array (as the store makes one). The fits before today are
// cached (by what they read), so the cost is the 28 sessions' cells. ~10–20 ms on desktop Node; gated at 50 ms, the phone's per-set
// refit budget (best of several).
it('plans the week (128 patterns, a 4-day program) with the day’s readiness on 2k sets in under 50 ms', () => {
  const { entries, body } = simulateRecovery(1, { sessions: 190, failFrac: 0.2, energy: { slope: 0.02 } });
  let today = addDays(entries.at(-1)!.date, 1);
  while (new Date(`${today}T00:00:00Z`).getUTCDay() !== 1) today = addDays(today, 1);
  const s = (exercise: string, sets = 3) => ({ exercise, sets, repMin: 8, repMax: 12 });
  const program: Program = { key: 'program', perSession: 12, createdAt: '', days: [
    { name: 'A', slots: [s('Bench Press', 4), s('Incline DB Press'), s('Cable Pushdown')] },
    { name: 'B', slots: [s('Seated Cable Row', 4), s('Lat Pulldown'), s('DB Curl')] },
    { name: 'C', slots: [s('Leg Press', 4), s('DB Lateral Raise')] },
    { name: 'D', slots: [s('Bench Press'), s('Lat Pulldown'), s('Leg Press'), s('DB Curl')] }] };
  const at = (es: SetEntry[]) => readinessPlanned({ entries: es, body, weeklyGoal: 3, program, plans: [], quick: null, today, tz: 'UTC', profile: defaultProfile() });
  for (let k = 0; k < 3; k++) at([...entries]);
  const times: number[] = [];
  for (let k = 0; k < 7; k++) {
    const next = [...entries];
    const t = performance.now();
    const r = at(next);
    times.push(performance.now() - t);
    expect(r.plan!.patterns).toBe(128);
    expect(r.plan!.days.filter((d) => d.train).length).toBe(3);
  }
  times.sort((a, b) => a - b);
  expect(entries.length).toBeGreaterThan(2000);
  expect(times[0], `per plan (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(50 * SLACK);
}, 60000);
