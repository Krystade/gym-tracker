// Walk-forward backtest of the app's predictions against what was actually done, on an exported log (More → Export CSV).
//
//   npx jiti scripts/backtest.ts log.csv [--out result.json] [--tz Area/City]
//
// Every prediction for a session date D is made from the log before D only (the app's own rule: a target doesn't move under you
// while you train); a within-session prediction also sees that day's sets done before the set it predicts, never the set itself
// or anything after. The log goes through the app's own CSV parser (domain/csv), so the sets are the ones the app sees, and every
// prediction is the app's own function called as the app calls it, unless the line says it is an alternative being tried.
// Prints a summary; --out writes every aggregate (and the small point lists the charts need) as JSON. Nothing is sent anywhere.
// The log is personal data: keep it and the output out of the repo.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../src/domain/csv';
import { byOrderDone, doneAt, learnable, sessionsFor } from '../src/domain/stats';
import { weeklyMuscleSets } from '../src/domain/analytics';
import { coreBefore, fatigueOf, logBefore, type Core, type Features } from '../src/domain/learn';
import { TAUS } from '../src/domain/learn/capacity';
import { strengthOf } from '../src/domain/learn/strength';
import { liftKey } from '../src/domain/ids';
import { resolveLift } from '../src/domain/lifts';
import { overlap } from '../src/domain/learn/tags';
import { isCardio, isCardioEntry } from '../src/domain/cardio';
import { isHold, isHoldLift } from '../src/domain/care';
import { bodyShare } from '../src/domain/learn/bodyweight';
import { defaultSettings, isTraining, isWorking, nextTarget, priorE1rm, type Target } from '../src/domain/progression';
import { nextSet, suggest } from '../src/domain/suggest';
import { restFor, planSeconds, sessionMinutes, usualMinutes, SET_WORK, type Step } from '../src/domain/timing';
import { kneeAfter } from '../src/domain/learn/rest';
import { gapModel } from '../src/domain/learn/switch';
import { supersets } from '../src/domain/superset';
import { paceBefore } from '../src/domain/learn/session';
import { testDue, TEST_EVERY_DAYS } from '../src/domain/estimators';
import { painRisk } from '../src/domain/learn/pain';
import { systemic } from '../src/domain/learn/deload';
import { flatness } from '../src/domain/learn/trend';
import { dayOf } from '../src/domain/learn';
import { volumeAdvice } from '../src/domain/learn/volume';
import { defaultProfile } from '../src/domain/profile';
import { readinessModel } from '../src/domain/learn/readiness';
import { addDays, weekStart } from '../src/domain/analytics';
import { hurts, type SetEntry } from '../src/domain/types';
import { MUSCLES } from '../src/domain/muscles';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) { console.error('usage: npx jiti scripts/backtest.ts log.csv [--out result.json] [--tz Area/City]'); process.exit(1); }
const TZ = opt('--tz') ?? 'UTC';
const { entries: raw, errors } = parseCsv(readFileSync(file, 'utf8'));
if (errors.length) console.error(`${errors.length} rows not read, e.g.`, errors.slice(0, 3));
const log = learnable(raw);
const dates = [...new Set(log.map((e) => e.date))].sort();
const appDay = new Set(dates.filter((d) => log.some((e) => e.date === d && e.loggedAt)));
const eraOf = (d: string) => (appDay.has(d) ? 'app' : log.find((e) => e.date === d)!.source);

// ---- Metrics ----------------------------------------------------------------------------------------------------------------
type Pair = { p: number; a: number };
function stats(xs: Pair[]) {
  const n = xs.length;
  if (!n) return { n: 0, mae: null, bias: null, rmse: null, within1: null, exact: null };
  const e = xs.map((x) => x.p - x.a);
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n, mae: r(e.reduce((s, v) => s + Math.abs(v), 0) / n), bias: r(e.reduce((s, v) => s + v, 0) / n),
    rmse: r(Math.sqrt(e.reduce((s, v) => s + v * v, 0) / n)), within1: r(100 * e.filter((v) => Math.abs(v) <= 1).length / n),
    exact: r(100 * e.filter((v) => Math.abs(v) < 0.5).length / n) };
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function ols(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxy / sxx, a = my - b * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i] - a - b * xs[i]) ** 2;
  const se = Math.sqrt(rss / (n - 2) / sxx);
  const syy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  return { n, slope: b, intercept: a, se, r: sxy / Math.sqrt(sxx * syy) };
}
/** Multiple regression y ~ 1 + X (normal equations, Gauss–Jordan); coefficients and SEs. */
function mreg(X: number[][], y: number[], names: string[]) {
  const n = y.length, p = X[0].length + 1;
  if (n <= p + 1) return null;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) { const x = [1, ...X[i]]; for (let j = 0; j < p; j++) { b[j] += x[j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += x[j] * x[k]; } }
  const M = A.map((row, i) => [...row, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c]; if (Math.abs(d) < 1e-12) return null;
    for (let k = 0; k < 2 * p; k++) M[c][k] /= d;
    for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * p; k++) M[r][k] -= f * M[c][k]; }
  }
  const inv = M.map((row) => row.slice(p));
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
  let rss = 0;
  for (let i = 0; i < n; i++) { const x = [1, ...X[i]]; rss += (y[i] - x.reduce((s, v, j) => s + v * beta[j], 0)) ** 2; }
  const s2 = rss / (n - p);
  return { n, coef: Object.fromEntries(['intercept', ...names].map((k, j) => [k, { b: beta[j], se: Math.sqrt(s2 * inv[j][j]) }])) };
}

// ---- Set helpers --------------------------------------------------------------------------------------------------------------
const cardio = (e: SetEntry) => isCardioEntry(e) || isCardio(e.exercise);
const isHard = (e: SetEntry) => !e.flags.includes('warmup') && !e.flags.includes('partial') && e.reps != null && e.reps > 0 && !cardio(e);
/** A set the capacity model reads (a loaded, counted, non-hold set of ≤ 30 reps) and the targets aim (a training set). */
const measured = (e: SetEntry) => isTraining(e) && isHard(e) && e.weight > 0 && !e.flags.includes('bodyweight') && bodyShare(e.exercise) == null
  && !e.flags.includes('hold') && !isHold(e.exercise) && (e.reps as number) <= 30;
const NT = TAUS.length;
/** The capacity equation's fatigue features of hard[a] from hard[0..a) at times t (s), as learn/capacity's blockOf builds them. */
function featuresOf(hard: SetEntry[], a: number, t: number[]): Features {
  const f: Features = { nS: 0, nC: 0, nY: 0, eS: new Float64Array(NT), eC: new Float64Array(NT) };
  const key = liftKey(hard[a].exercise), v = resolveLift(hard[a].exercise).m;
  for (let b = 0; b < a; b++) {
    const dt = Math.max(1, t[a] - t[b]);
    if (liftKey(hard[b].exercise) === key) { f.nS++; for (let k = 0; k < NT; k++) f.eS[k] += Math.exp(-dt / TAUS[k]); }
    else { f.nY++; const o = overlap(resolveLift(hard[b].exercise).m, v); if (o > 0) { f.nC += o; for (let k = 0; k < NT; k++) f.eC[k] += o * Math.exp(-dt / TAUS[k]); } }
  }
  return f;
}
/** Only the same-lift term (the cross-lift and any-set terms zeroed): what the fatigue model is without A_cross and γ. */
const sameOnly = (f: Features): Features => ({ nS: f.nS, nC: 0, nY: 0, eS: f.eS, eC: new Float64Array(NT) });

// ---- Per-set predictions -------------------------------------------------------------------------------------------------------
interface Row {
  date: string; era: string; lift: string; k: number; weight: number; reps: number; rir: number | null; timed: boolean;
  layoff: number | null; pos: number; liftOrder: number; inter: boolean | null; rest: number | null; sinceAny: number | null;
  rule: { kind: string; weight: number; reps: number } | null;
  last: { same: number; mean: number; best: number; sameRir: number | null; sameW: number; sameRirLogged: number | null } | null;
  cap: { habit: number; rir: number | null; noFat: number; sameOnly: number; typGap: number; anch: number | null; anchRir: number | null; F: number;
    /** Last time's same set, moved by how much more (or less) fatigue today's set carries than it did and by any change of weight. */
    hybrid: number | null; hybridHalf: number | null; dFat: number | null } | null;
  ns: { reps: number; weight: number; learned: boolean; raised: boolean } | null;
  prevReps: number | null; prevW: number | null;
}
const rows: Row[] = [];
const sessionRows: { date: string; lift: string; best: SetEntry; epley3: number | null; epley1: number | null; cap: number | null; capNoFat: number | null }[] = [];
const coreOf = new Map<string, Core | null>();
const HARD = new Map<string, { hard: SetEntry[]; t: number[] }>();
/** A day's hard sets in the order done and their times (s; an untimed day spaced at the typical gap, as the core does). */
function dayHard(date: string, gap: number) {
  const k = `${date}|${gap}`;
  let h = HARD.get(k);
  if (!h) {
    const hard = log.filter((e) => e.date === date && isHard(e)).sort(byOrderDone), ts = hard.map(doneAt);
    h = { hard, t: hard.length && ts.every(Number.isFinite) ? ts.map((x) => (x - ts[0]) / 1000) : hard.map((_, i) => i * gap) };
    HARD.set(k, h);
  }
  return h;
}

for (const D of dates) {
  const before = logBefore(log, D) as SetEntry[];
  if (!before.length) continue;
  // --in-sample (a check of this script, not a backtest): the core fitted with D's own sets, so its error is the model's fit alone.
  const core = coreBefore(log, args.includes('--in-sample') ? addDays(D, 1) : D);
  coreOf.set(D, core);
  const day = log.filter((e) => e.date === D).sort(byOrderDone);
  const hard = day.filter(isHard);
  const times = hard.map(doneAt);
  const timed = hard.length > 0 && times.every(Number.isFinite);
  const gap = core?.gap ?? 180;
  const tAct = timed ? times.map((x) => (x - times[0]) / 1000) : hard.map((_, i) => i * gap);
  const tTyp = hard.map((_, i) => i * gap);
  const liftOrder = new Map<string, number>();
  for (const e of hard) if (!liftOrder.has(liftKey(e.exercise))) liftOrder.set(liftKey(e.exercise), liftOrder.size + 1);
  const rules = new Map<string, Target | null>(), lasts = new Map<string, SetEntry[] | null>(), sugs = new Map<string, ReturnType<typeof suggest>>();
  for (let a = 0; a < hard.length; a++) {
    const e = hard[a];
    if (!measured(e)) continue;
    const L = e.exercise, key = liftKey(L);
    const mine = hard.slice(0, a).filter((x) => liftKey(x.exercise) === key);
    const k = mine.filter(isTraining).length;
    if (!rules.has(key)) {
      let t: Target | null = null;
      try { t = nextTarget(before, L, defaultSettings(L), D, null); } catch { t = null; }
      rules.set(key, t);
      const s = sessionsFor(before, L).find((x) => x.sets.some(isTraining));
      lasts.set(key, s ? s.sets.filter(isTraining) : null);
      try { sugs.set(key, suggest(before, L, defaultSettings(L), D, null)); } catch { /* none */ }
    }
    const t = rules.get(key)!, lt = lasts.get(key)!;
    const prevSess = sessionsFor(before, L)[0];
    const layoff = prevSess ? dayOf(D) - dayOf(prevSess.date) : null;
    const prevOwn = mine.at(-1);
    const prevIdx = prevOwn ? hard.indexOf(prevOwn) : -1;
    const inter = prevOwn ? hard.slice(prevIdx + 1, a).some((x) => liftKey(x.exercise) !== key) : null;
    const rest = timed && prevOwn ? tAct[a] - tAct[prevIdx] : null;
    const sinceAny = timed && a > 0 ? tAct[a] - tAct[a - 1] : null;
    const rule = t && (t.perSet || t.reps != null) ? { kind: t.kind, weight: t.weight, reps: t.perSet ? t.perSet[Math.min(k, t.perSet.length - 1)] : t.reps } : null;
    const last = lt && lt.length ? (() => {
      const same = lt[Math.min(k, lt.length - 1)];
      return { same: same.reps as number, mean: lt.reduce((s, x) => s + (x.reps as number), 0) / lt.length, best: Math.max(...lt.map((x) => x.reps as number)),
        sameRir: e.rir != null ? (same.reps as number) + (same.rir ?? 2) - Math.min(4, e.rir) : null, sameW: same.weight, sameRirLogged: same.rir ?? null };
    })() : null;
    let cap: Row['cap'] = null;
    const s = core ? strengthOf(core, L, D) : null;
    if (core && s) {
      const lc = core.lifts.get(key)!;
      const b = lc.bias.mean, h = core.habit.mean;
      const C = (w: number) => s.kappa * (s.e1rm / w - 1);
      const f = featuresOf(hard, a, tAct), fT = featuresOf(hard, a, tTyp);
      const F = C(e.weight) - fatigueOf(core, key, f);
      const anchor = (() => {
        const p = [...mine].reverse().find(measured);
        if (!p) return null;
        const pi = hard.indexOf(p);
        const Fp = (p.reps as number) + (p.rir != null ? Math.min(4, p.rir) + b : h) + fatigueOf(core, key, featuresOf(hard, pi, tAct));
        const Et = p.weight * (1 + Fp / s.kappa);
        return s.kappa * (Et / e.weight - 1) - fatigueOf(core, key, f);
      })();
      // Hybrid: last time's same set (the rule's anchor) plus the core's fatigue difference between then and now (prior sets of the
      // lift and of other lifts, at the actual rests) and the reps–load slope for a change of weight.
      const hy = (() => {
        if (!lt || !lt.length) return null;
        const same = lt[Math.min(k, lt.length - 1)];
        const ld = dayHard(same.date, core.gap), i = ld.hard.indexOf(same);
        if (i < 0 || same.weight !== e.weight) return null; // the same weight only: no reps–load slope in it
        const dF = fatigueOf(core, key, featuresOf(ld.hard, i, ld.t)) - fatigueOf(core, key, f);
        return { dF, w: C(e.weight) - C(same.weight), r: same.reps as number };
      })();
      cap = { F, habit: F - h, hybrid: hy ? hy.r + hy.dF : null, hybridHalf: hy ? hy.r + 0.5 * hy.dF : null, dFat: hy ? hy.dF : null, rir: e.rir != null ? F - Math.min(4, e.rir) - b : null, noFat: C(e.weight) - h,
        sameOnly: C(e.weight) - fatigueOf(core, key, sameOnly(f)) - h, typGap: C(e.weight) - fatigueOf(core, key, fT) - h,
        anch: anchor == null ? null : anchor - h, anchRir: anchor == null || e.rir == null ? null : anchor - Math.min(4, e.rir) - b };
    }
    let ns: Row['ns'] = null;
    const sug = sugs.get(key);
    if (sug && k >= 1) {
      const done = day.filter((x) => liftKey(x.exercise) === key && byOrderDone(x, e) < 0);
      try {
        const n = nextSet(before, L, D, sug, done);
        if (n) ns = { reps: n.reps, weight: n.weight, learned: n.learned, raised: /in reserve/.test(n.why) };
      } catch { /* none */ }
    }
    const prevM = [...mine].reverse().find(isTraining);
    rows.push({ date: D, era: eraOf(D), lift: L, k, weight: e.weight, reps: e.reps as number, rir: e.rir ?? null, timed, layoff, pos: a,
      liftOrder: liftOrder.get(key)!, inter, rest, sinceAny, rule, last, cap, ns, prevReps: prevM ? prevM.reps : null, prevW: prevM ? prevM.weight : null });
  }
  // Strength: each lift's best set of the day (highest Epley), predicted from before D.
  const byLift = new Map<string, SetEntry[]>();
  for (const e of hard) if (measured(e)) { const k = liftKey(e.exercise); byLift.set(k, [...(byLift.get(k) ?? []), e]); }
  for (const [key, sets] of byLift) {
    const best = sets.reduce((x, y) => ((y.weight * (1 + (y.reps as number) / 30)) > (x.weight * (1 + (x.reps as number) / 30)) ? y : x));
    const L = best.exercise;
    const e3 = priorE1rm(before, L, D);
    const s1 = sessionsFor(before, L).find((x) => x.sets.some(measured));
    const e1 = s1 ? Math.max(...s1.sets.filter(measured).map((x) => x.weight * (1 + (x.reps as number) / 30))) : null;
    const r = rows.find((x) => x.date === D && liftKey(x.lift) === key && x.k === sets.filter(isTraining).indexOf(best) && x.weight === best.weight && x.reps === best.reps);
    sessionRows.push({ date: D, lift: L, best, epley3: e3 ? 30 * (e3 / best.weight - 1) : null, epley1: e1 ? 30 * (e1 / best.weight - 1) : null,
      cap: r?.cap?.habit ?? null, capNoFat: r?.cap?.noFat ?? null });
  }
}

// Walk-forward shrink of the fatigue difference: c_D, the least-squares slope through 0 of (reps − last time's) on dFat over the
// rows before D (0 until 30 of them), so no row's own outcome sets its coefficient.
const shrinkAt = new Map<string, number>();
{
  let sxy = 0, sxx = 0, n = 0, at = 0;
  const ok = rows.filter((r) => r.cap?.dFat != null && r.last);
  for (const D of dates) {
    for (; at < ok.length && ok[at].date < D; at++) { const r = ok[at]; sxy += r.cap!.dFat! * (r.reps - r.last!.same); sxx += r.cap!.dFat! ** 2; n++; }
    shrinkAt.set(D, n >= 30 && sxx > 0 ? Math.max(0, Math.min(1, sxy / sxx)) : 0);
  }
}
// ---- 1. Per-set reps ------------------------------------------------------------------------------------------------------------
const P = (f: (r: Row) => number | null | undefined, xs: Row[]) => xs.flatMap((r) => { const p = f(r); return p == null || !Number.isFinite(p) ? [] : [{ p, a: r.reps }]; });
const METHODS: Record<string, (r: Row) => number | null | undefined> = {
  rule: (r) => r.rule?.reps, lastSame: (r) => r.last?.same, lastMean: (r) => r.last?.mean, lastBest: (r) => r.last?.best,
  hybrid: (r) => r.cap?.hybrid, hybridHalf: (r) => r.cap?.hybridHalf, hybridLearned: (r) => (r.cap?.dFat == null || !r.last ? null : r.last.same + shrinkAt.get(r.date)! * r.cap.dFat),
  hybridLearnedRounded: (r) => (r.cap?.dFat == null || !r.last ? null : Math.round(r.last.same + shrinkAt.get(r.date)! * r.cap.dFat)),
  capHabit: (r) => r.cap?.habit, capNoFatigue: (r) => r.cap?.noFat, capSameLiftOnly: (r) => r.cap?.sameOnly, capTypicalGap: (r) => r.cap?.typGap,
};
const RIR_METHODS: Record<string, (r: Row) => number | null | undefined> = {
  rule: (r) => r.rule?.reps, lastSame: (r) => r.last?.same, lastSamePlusRir: (r) => r.last?.sameRir, hybrid: (r) => r.cap?.hybrid, capHabit: (r) => r.cap?.habit, capGivenRir: (r) => r.cap?.rir,
};
const table = (xs: Row[], ms: Record<string, (r: Row) => number | null | undefined>) => Object.fromEntries(Object.entries(ms).map(([k, f]) => [k, stats(P(f, xs))]));
// The common subset: the rule aimed a number at the weight he did, and every method has a prediction.
const atRule = rows.filter((r) => r.rule && r.rule.weight === r.weight);
const common = atRule.filter((r) => Object.values(METHODS).every((f) => f(r) != null));
const commonAny = atRule.filter((r) => ['rule', 'lastSame', 'capHabit'].every((k) => METHODS[k](r) != null));
const rirCommon = common.filter((r) => r.rir != null && r.cap?.rir != null && r.last?.sameRir != null);
const bucket = (xs: Row[], by: (r: Row) => string | null, ms = METHODS) => {
  const g = new Map<string, Row[]>();
  for (const r of xs) { const b = by(r); if (b != null) g.set(b, [...(g.get(b) ?? []), r]); }
  return Object.fromEntries([...g].map(([k, v]) => [k, table(v, ms)]));
};
const layoffB = (r: Row) => (r.layoff == null ? null : r.layoff <= 4 ? 'a ≤4 d' : r.layoff <= 7 ? 'b 5–7 d' : r.layoff <= 14 ? 'c 8–14 d' : 'd 15+ d');
const setB = (r: Row) => (r.k === 0 ? 'set 1' : r.k === 1 ? 'set 2' : r.k === 2 ? 'set 3' : 'set 4+');
const orderB = (r: Row) => (r.liftOrder === 1 ? '1st lift' : r.liftOrder <= 3 ? '2nd–3rd lift' : '4th+ lift');
const interB = (r: Row) => (r.inter == null ? 'first set of lift' : r.inter ? 'other lift between (superset)' : 'straight sets');
const restB = (r: Row) => (r.rest == null ? null : r.rest < 150 ? 'a <2:30' : r.rest < 240 ? 'b 2:30–4:00' : r.rest < 360 ? 'c 4:00–6:00' : 'd 6:00+');
const kindB = (r: Row) => r.rule?.kind ?? null;
const eraB = (r: Row) => r.era;

/** Paired: mean |error| of method a less method b on the same sets, with its SE clustered by day (sets of a day aren't independent). */
function paired(xs: Row[], a: (r: Row) => number | null | undefined, b: (r: Row) => number | null | undefined) {
  const byDay = new Map<string, number[]>();
  for (const r of xs) { const pa = a(r), pb = b(r); if (pa == null || pb == null) continue; const d = Math.abs(pa - r.reps) - Math.abs(pb - r.reps); byDay.set(r.date, [...(byDay.get(r.date) ?? []), d]); }
  const all = [...byDay.values()].flat(), n = all.length, G = byDay.size;
  if (n < 2 || G < 2) return null;
  const m = all.reduce((x, y) => x + y, 0) / n;
  let v = 0;
  for (const ds of byDay.values()) { const s0 = ds.reduce((x, y) => x + y - m, 0); v += s0 * s0; }
  const se = Math.sqrt(v * G / (G - 1)) / n;
  return { n, days: G, diff: Math.round(m * 1000) / 1000, se: Math.round(se * 1000) / 1000 };
}
const perSet = {
  note: 'common: sets where the current rule aimed a number at the weight he did and every method had a prediction',
  counts: { rows: rows.length, atRule: atRule.length, common: common.length, rirCommon: rirCommon.length },
  dates: { first: common[0]?.date, last: common.at(-1)?.date },
  all: table(common, METHODS), allAnyWeight: table(commonAny, { rule: METHODS.rule, lastSame: METHODS.lastSame, lastMean: METHODS.lastMean, capHabit: METHODS.capHabit }),
  shrinkFinal: shrinkAt.get(dates.at(-1)!),
  pairedAny: { capVsRule: paired(commonAny, METHODS.capHabit, METHODS.rule), lastVsRule: paired(commonAny, METHODS.lastSame, METHODS.rule), meanVsRule: paired(commonAny, METHODS.lastMean, METHODS.rule) },
  pairedSame: { lastVsRule: paired(common, METHODS.lastSame, METHODS.rule), hybridVsLast: paired(common, METHODS.hybridLearned, METHODS.lastSame), capVsLast: paired(common, METHODS.capHabit, METHODS.lastSame), noFatVsCap: paired(common, METHODS.capNoFatigue, METHODS.capHabit), typGapVsCap: paired(common, METHODS.capTypicalGap, METHODS.capHabit) },
  plusOne: (() => { const xs = rows.filter((r) => r.last?.sameRirLogged != null && r.last.sameW === r.weight); const g = (f: (r: Row) => boolean) => { const v = xs.filter(f).map((r) => r.reps - r.last!.same); return { n: v.length, gain: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }; }; return { lastRir2plus: g((r) => r.last!.sameRirLogged! >= 2), lastRir0to1: g((r) => r.last!.sameRirLogged! < 2) }; })(), byEra: bucket(common, eraB), byLayoff: bucket(common, layoffB), bySet: bucket(common, setB),
  byOrder: bucket(common, orderB), bySuperset: bucket(common, interB), byRest: bucket(common, restB), byKind: bucket(common, kindB),
  rir: table(rirCommon, RIR_METHODS), rirBySet: bucket(rirCommon, setB, RIR_METHODS), rirBySuperset: bucket(rirCommon, interB, RIR_METHODS),
  rirByRest: bucket(rirCommon, restB, RIR_METHODS),
  // Is his logged RIR informative? Reps against last time's same set, on the change in logged RIR (−1 if RIR were exact).
  rirSignal: (() => { const xs = rows.filter((r) => r.rir != null && r.last?.sameRirLogged != null && r.last.sameW === r.weight); return ols(xs.map((r) => Math.min(4, r.rir!) - Math.min(4, r.last!.sameRirLogged!)), xs.map((r) => r.reps - r.last!.same)); })(),
  // Fatigue difference vs the miss of copying last time: does the core's dFat explain (reps − last time's)?
  fatSignal: (() => { const xs = common.filter((r) => r.cap?.dFat != null && r.last!.sameW === r.weight); return ols(xs.map((r) => r.cap!.dFat!), xs.map((r) => r.reps - r.last!.same)); })(),
  // Every set the core reads, at any weight: the core against last time's same set.
  anyWeight: table(rows.filter((r) => r.cap && r.last), { lastSame: METHODS.lastSame, capHabit: METHODS.capHabit, capNoFatigue: METHODS.capNoFatigue }),
  // Did the rule's number come true as a target (reps ≥ target)?
  ruleHit: (() => { const x = atRule; return { n: x.length, hitPct: Math.round(100 * x.filter((r) => r.reps >= r.rule!.reps).length / Math.max(1, x.length)) }; })(),
  // The rule's target against his reps by set number, for the chart (app era).
  bySetMeans: ['set 1', 'set 2', 'set 3', 'set 4+'].map((b) => {
    const xs = common.filter((r) => setB(r) === b);
    const m = (f: (r: Row) => number | null | undefined) => { const v = xs.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; };
    return { set: b, n: xs.length, actual: m((r) => r.reps), rule: m(METHODS.rule), capHabit: m(METHODS.capHabit), lastSame: m(METHODS.lastSame) };
  }),
};

// ---- 2. nextSet --------------------------------------------------------------------------------------------------------------
const nsRows = rows.filter((r) => r.ns && r.ns.weight === r.weight && r.prevReps != null);
const NS: Record<string, (r: Row) => number | null | undefined> = {
  nextSetApp: (r) => r.ns?.reps, sameAsLastSet: (r) => (r.prevW === r.weight ? r.prevReps : null), capAnchored: (r) => r.cap?.anch, capAnchoredGivenRir: (r) => r.cap?.anchRir,
};
const nsCommon = nsRows.filter((r) => Object.values(NS).every((f) => f(r) != null));
const nextSetOut = { n: nsRows.length, paired: { appVsSame: paired(nsCommon, NS.nextSetApp, NS.sameAsLastSet), anchVsApp: paired(nsCommon, NS.capAnchored, NS.nextSetApp) }, common: table(nsCommon, NS), all: table(nsRows, { nextSetApp: NS.nextSetApp }),
  raised: table(nsRows.filter((r) => r.ns!.raised), { nextSetApp: NS.nextSetApp, sameAsLastSet: NS.sameAsLastSet }),
  learnedShare: Math.round(100 * nsRows.filter((r) => r.ns!.learned).length / Math.max(1, nsRows.length)),
  bySuperset: bucket(nsCommon, interB, NS), byRest: bucket(nsCommon, restB, NS) };

// ---- 3. Strength (e1RM) ---------------------------------------------------------------------------------------------------------
const sr = sessionRows.filter((x) => x.epley3 != null && x.cap != null && x.epley1 != null);
const strengthOut = {
  note: 'each lift-session: its best set (highest Epley), its reps predicted at its weight from the log before',
  ...Object.fromEntries(Object.entries({ coreLevel: (x: typeof sr[0]) => x.cap, coreNoFatigue: (x: typeof sr[0]) => x.capNoFat, epleyBestOf3: (x: typeof sr[0]) => x.epley3, epleyLastSession: (x: typeof sr[0]) => x.epley1 })
    .map(([k, f]) => [k, stats(sr.map((x) => ({ p: f(x)!, a: x.best.reps as number })))])),
  tests: log.filter((e) => e.flags.includes('test')).map((e) => {
    const core = coreBefore(log, e.date), s = core && strengthOf(core, e.exercise, e.date);
    const e3 = priorE1rm(logBefore(log, e.date) as SetEntry[], e.exercise, e.date);
    return { date: e.date, lift: e.exercise, weight: e.weight, reps: e.reps, rir: e.rir ?? null,
      coreReps: s ? Math.round(10 * s.kappa * (s.e1rm / e.weight - 1)) / 10 : null, epleyReps: e3 ? Math.round(10 * 30 * (e3 / e.weight - 1)) / 10 : null };
  }),
};

// ---- 4. Rest timer, switches, set time --------------------------------------------------------------------------------------------
const restPairs: { prescribed: number; gap: number; nextReps: number; knee: boolean; kneeS: number | null; rir: number | null; iso: boolean }[] = [];
const switchPairs: { predicted: number; gap: number; nextReps: number; prevReps: number; pairN: number }[] = [];
const straightGaps: { gap: number; nextReps: number }[] = [];
/** Alternating pairs (A, B, A or B, A, B by the order done): the gap from A's set to B's is a walk plus B's set, never B's rest. */
const altGaps: { gap: number; nextReps: number; date: string; app: boolean }[] = [];
for (const D of dates.filter((d) => appDay.has(d))) {
  const before = logBefore(log, D) as SetEntry[];
  const dayAll = log.filter((e) => e.date === D);
  const day = dayAll.filter((e) => e.loggedAt && isWorking(e) && !cardio(e)).sort(byOrderDone);
  const model = gapModel(log, D);
  const groups = supersets(dayAll, D, model);
  const nextOf = new Map<string, string | null>();
  for (const g of groups) for (const [id, nx] of g.after) nextOf.set(id, nx);
  for (let i = 0; i + 1 < day.length; i++) {
    const a = day[i], b = day[i + 1];
    const ka = liftKey(a.exercise), kb = liftKey(b.exercise);
    const alt = ka !== kb && ((day[i + 2] && liftKey(day[i + 2].exercise) === ka) || (i > 0 && liftKey(day[i - 1].exercise) === kb));
    const g0 = (doneAt(b) - doneAt(a)) / 1000;
    if (alt && g0 > 0 && g0 <= 600 && !a.enteredAt && !b.enteredAt && !b.flags.includes('hold') && !isHold(b.exercise)) altGaps.push({ gap: g0, nextReps: b.reps as number, date: D, app: !!nextOf.get(a.id) });
    const gap = (doneAt(b) - doneAt(a)) / 1000;
    if (!(gap > 0) || gap > 900 || a.enteredAt || b.enteredAt) continue;
    const nx = nextOf.get(a.id);
    if (nx && liftKey(nx) === liftKey(b.exercise) && liftKey(a.exercise) !== liftKey(b.exercise)) {
      switchPairs.push({ predicted: model.switchSeconds(a.exercise, b.exercise, {}), gap, nextReps: b.reps as number, prevReps: a.reps as number, pairN: model.pairSwitches(a.exercise, b.exercise) });
    } else if (liftKey(a.exercise) === liftKey(b.exercise) && !a.flags.includes('warmup')) {
      const knee = kneeAfter([...before, ...dayAll], a);
      const r = restFor(a, { knee });
      restPairs.push({ prescribed: r.seconds, gap, nextReps: b.reps as number, knee: !!knee?.use, kneeS: knee ? knee.usual : null, rir: a.rir ?? null, iso: defaultSettings(a.exercise).repMin >= 10 });
      straightGaps.push({ gap, nextReps: b.reps as number });
    }
  }
}
const restOut = {
  n: restPairs.length, kneeInUse: restPairs.filter((x) => x.knee).length,
  kneeMedian: median(restPairs.filter((x) => x.kneeS != null).map((x) => x.kneeS!)),
  prescribedMedian: median(restPairs.map((x) => x.prescribed)), actualGapMedian: median(restPairs.map((x) => x.gap)),
  // The timer's rest plus the set itself (40 s) against the gap he took (done-time to done-time).
  vsActual: stats(restPairs.map((x) => ({ p: x.prescribed + SET_WORK, a: x.gap }))),
  vsActualPerRep: stats(restPairs.map((x) => ({ p: x.prescribed + 4 * x.nextReps, a: x.gap }))),
  within60: Math.round(100 * restPairs.filter((x) => Math.abs(x.prescribed + SET_WORK - x.gap) <= 60).length / Math.max(1, restPairs.length)),
  longerThanTimer: Math.round(100 * restPairs.filter((x) => x.gap > x.prescribed + SET_WORK).length / Math.max(1, restPairs.length)),
  byClass: { iso: median(restPairs.filter((x) => x.iso).map((x) => x.gap)), compound: median(restPairs.filter((x) => !x.iso).map((x) => x.gap)) },
  points: restPairs.map((x) => [Math.round(x.prescribed), Math.round(x.gap)]),
};
const swOut = {
  n: switchPairs.length,
  model: stats(switchPairs.map((x) => ({ p: x.predicted, a: x.gap }))),
  timer: stats(switchPairs.map((x) => ({ p: Math.max(0, x.predicted - SET_WORK), a: x.gap }))),
  medianGap: median(switchPairs.map((x) => x.gap)), medianPredicted: median(switchPairs.map((x) => x.predicted)),
  // Set time: does the switch gap (rest-free: a walk plus the partner's set) grow with the partner set's reps?
  slopeSwitch: ols(switchPairs.map((x) => x.nextReps), switchPairs.map((x) => x.gap)),
  slopeSwitchLog: ols(switchPairs.map((x) => x.nextReps), switchPairs.map((x) => Math.log(x.gap))),
  alternating: { n: altGaps.length, days: new Set(altGaps.map((x) => x.date)).size, median: median(altGaps.map((x) => x.gap)),
    slope: ols(altGaps.map((x) => x.nextReps), altGaps.map((x) => x.gap)),
    // Robust to the odd long gap: the slope of the median gap by rep band.
    byReps: [[0, 8], [8, 11], [11, 14], [14, 99]].map(([lo, hi]) => { const xs = altGaps.filter((x) => x.nextReps >= lo && x.nextReps < hi); return { reps: `${lo}–${hi === 99 ? '' : hi - 1}`, n: xs.length, median: median(xs.map((x) => x.gap)) }; }),
    points: altGaps.map((x) => [x.nextReps, Math.round(x.gap)]) },
  slopeStraight: ols(straightGaps.map((x) => x.nextReps), straightGaps.map((x) => x.gap)),
  points: switchPairs.map((x) => [x.nextReps, Math.round(x.gap), Math.round(x.predicted)]),
};

// ---- 5. Session length --------------------------------------------------------------------------------------------------------
const sessOut: { date: string; actual: number; pace: number | null; lo: number | null; hi: number | null; plan: number; usual: number; sets: number }[] = [];
for (const D of dates.filter((d) => appDay.has(d))) {
  const actual = sessionMinutes(log as SetEntry[], D);
  if (actual == null) continue;
  const day = log.filter((e) => e.date === D).sort(byOrderDone);
  const steps: Step[] = day.filter((e) => isWorking(e) || e.flags.includes('warmup') || cardio(e)).map((e) => (cardio(e) && e.cardio ? { exercise: e.exercise, seconds: e.cardio.seconds } : { exercise: e.exercise, ...(e.flags.includes('warmup') && { warmup: true }) }));
  const fit = paceBefore(log, D);
  const f = fit ? fit.forecast(steps, { date: D }) : null;
  sessOut.push({ date: D, actual, pace: f ? Math.round(f.seconds / 60) : null, lo: f ? Math.round(f.lo / 60) : null, hi: f ? Math.round(f.hi / 60) : null,
    plan: Math.round(planSeconds(steps) / 60), usual: usualMinutes(log as SetEntry[], D), sets: steps.length });
}
const so = sessOut.filter((x) => x.pace != null);
const sessionOut = { n: so.length, pace: stats(so.map((x) => ({ p: x.pace!, a: x.actual }))), plan: stats(so.map((x) => ({ p: x.plan, a: x.actual }))),
  usual: stats(so.map((x) => ({ p: x.usual, a: x.actual }))), band80: Math.round(100 * so.filter((x) => x.actual >= x.lo! && x.actual <= x.hi!).length / Math.max(1, so.length)), days: sessOut };

// ---- 6. Pain risk --------------------------------------------------------------------------------------------------------------
const painRows: { date: string; lift: string; p: number; base: number; y: number; era: string }[] = [];
for (const D of dates) {
  const before = logBefore(log, D) as SetEntry[];
  if (!before.length) continue;
  const day = log.filter((e) => e.date === D && !cardio(e));
  const lifts = [...new Set(day.map((e) => liftKey(e.exercise)))];
  // The running base rate: lift-sessions with pain over all lift-sessions before D.
  const ls = new Map<string, boolean>();
  for (const e of before) if (!cardio(e)) { const k = `${e.date}|${liftKey(e.exercise)}`; ls.set(k, (ls.get(k) ?? false) || hurts(e)); }
  const base = ([...ls.values()].filter(Boolean).length + 1) / (ls.size + 2);
  for (const k of lifts) {
    const sets = day.filter((e) => liftKey(e.exercise) === k);
    painRows.push({ date: D, lift: sets[0].exercise, p: painRisk(before, sets[0].exercise, D).p, base, y: sets.some(hurts) ? 1 : 0, era: eraOf(D) });
  }
}
const brier = (f: (x: typeof painRows[0]) => number, xs = painRows) => xs.reduce((s, x) => s + (f(x) - x.y) ** 2, 0) / Math.max(1, xs.length);
const logloss = (f: (x: typeof painRows[0]) => number, xs = painRows) => -xs.reduce((s, x) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, f(x))); return s + (x.y ? Math.log(p) : Math.log(1 - p)); }, 0) / Math.max(1, xs.length);
const bins = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 1.01];
const painOut = {
  n: painRows.length, pains: painRows.filter((x) => x.y).length,
  brier: { model: brier((x) => x.p), base: brier((x) => x.base) }, logloss: { model: logloss((x) => x.p), base: logloss((x) => x.base) },
  reliability: bins.slice(0, -1).map((lo, i) => { const xs = painRows.filter((x) => x.p >= lo && x.p < bins[i + 1]); return { bin: `${lo}–${Math.min(1, bins[i + 1])}`, n: xs.length, predicted: xs.length ? xs.reduce((s, x) => s + x.p, 0) / xs.length : null, observed: xs.length ? xs.filter((x) => x.y).length / xs.length : null }; }),
  // Ranking: of the lift-sessions with pain, the share whose risk was in the top quarter of the day-ahead risks.
  auc: (() => { const pos = painRows.filter((x) => x.y), neg = painRows.filter((x) => !x.y); let s = 0; for (const a of pos) for (const b of neg) s += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0; return pos.length && neg.length ? s / (pos.length * neg.length) : null; })(),
  byEra: Object.fromEntries([...new Set(painRows.map((x) => x.era))].map((era) => { const xs = painRows.filter((x) => x.era === era); return [era, { n: xs.length, pains: xs.filter((x) => x.y).length, brierModel: brier((x) => x.p, xs), brierBase: brier((x) => x.base, xs) }]; })),
};

// ---- 7. Test due ----------------------------------------------------------------------------------------------------------------
const testCounts: Record<string, number> = {};
const fired: Record<string, number> = {};
let testChecked = 0;
for (const D of dates) {
  const before = logBefore(log, D) as SetEntry[];
  if (!before.length) continue;
  const lifts = [...new Set(log.filter((e) => e.date === D && isWorking(e) && !cardio(e)).map((e) => e.exercise))];
  for (const L of lifts) {
    testChecked++;
    // The cadence (estimators testDue): every TEST_EVERY_DAYS from the last test, else from the lift's first session.
    const why = (() => {
      if (isHoldLift(L, before)) return 'a hold';
      if (before.some((e) => e.date === D && e.flags.includes('test'))) return 'a test already today';
      const mine = before.filter((e) => liftKey(e.exercise) === liftKey(L) && e.reps != null && !e.flags.includes('warmup'));
      const tested = mine.filter((e) => e.flags.includes('test')).map((e) => e.date).sort().at(-1);
      const since = tested ?? mine.map((e) => e.date).sort()[0];
      if (!since) return 'first session';
      if (dayOf(D) - dayOf(since) < TEST_EVERY_DAYS) return tested ? 'under 4 weeks since its test' : 'under 4 weeks since it started';
      let t: Target | null = null;
      try { t = nextTarget(before, L, defaultSettings(L), D, null); } catch { /* none */ }
      return testDue(before, L, D, { increment: 5 }, t) ? 'FIRED' : 'no level to read a weight from';
    })();
    testCounts[why] = (testCounts[why] ?? 0) + 1;
    if (why === 'FIRED') fired[D.slice(0, 7)] = (fired[D.slice(0, 7)] ?? 0) + 1;
  }
}
const testOut = { checked: testChecked, byRule: testCounts, firedByMonth: fired, testsDone: log.filter((e) => e.flags.includes('test')).length };

// ---- 8. Volume ------------------------------------------------------------------------------------------------------------------
const profile = defaultProfile();
const volRows: { week: string; muscle: string; base: number | null; kind: string; aim: number | null; band: [number, number]; actual: number }[] = [];
const weeks = [...new Set(log.map((e) => weekStart(e.date)))].sort();
for (const W of weeks.slice(3)) {
  const adv = volumeAdvice(logBefore(log, W), [], profile, W);
  if (!adv) continue;
  const actual = weeklyMuscleSets(log as SetEntry[], W).sets;
  if (!MUSCLES.some((m) => actual[m] > 0)) continue;
  for (const m of adv.muscles) volRows.push({ week: W, muscle: m.muscle, base: m.base, kind: m.kind, aim: m.aim, band: m.band, actual: actual[m.muscle] });
}
const vr = volRows.filter((x) => x.base != null);
const volumeOut = {
  weeks: new Set(volRows.map((x) => x.week)).size, rows: vr.length,
  baseAsForecast: stats(vr.map((x) => ({ p: x.base!, a: x.actual }))),
  plannedAsForecast: stats(vr.map((x) => ({ p: x.kind === 'raise' ? x.aim! : x.base!, a: x.actual }))),
  kinds: vr.reduce((o, x) => ({ ...o, [x.kind]: (o[x.kind] ?? 0) + 1 }), {} as Record<string, number>),
  raiseMet: (() => { const xs = vr.filter((x) => x.kind === 'raise'); return { n: xs.length, met: xs.filter((x) => x.actual >= x.aim! - 0.25).length }; })(),
  inBand: Math.round(100 * vr.filter((x) => x.actual >= x.band[0] && x.actual <= x.band[1]).length / Math.max(1, vr.length)),
  byMuscle: Object.fromEntries(MUSCLES.map((m) => { const xs = vr.filter((x) => x.muscle === m); return [m, { n: xs.length, base: xs.length ? xs.reduce((s, x) => s + x.base!, 0) / xs.length : null, actual: xs.length ? xs.reduce((s, x) => s + x.actual, 0) / xs.length : null, band: xs[0]?.band ?? null }]; })),
};

// ---- 9. Superset / rest effects on reps (timed sets) ----------------------------------------------------------------------------
// Later sets of a lift at the same weight as its first set that day: the reps lost since that first set, against the set's number,
// a superset (another lift between), the rest since its own last set and since any set (ln s), and the RIR logged.
const eff = rows.filter((r) => r.timed && r.k >= 1 && r.rest != null && r.sinceAny != null);
const firstOf = new Map<string, Row>();
for (const r of rows) if (r.k === 0) firstOf.set(`${r.date}|${liftKey(r.lift)}`, r);
const effRows = eff.flatMap((r) => { const f = firstOf.get(`${r.date}|${liftKey(r.lift)}`); return f && f.weight === r.weight ? [{ r, drop: f.reps - r.reps, f }] : []; });
const effectOut = {
  n: effRows.length,
  model: mreg(effRows.map(({ r }) => [r.k, r.inter ? 1 : 0, Math.log(r.rest!), Math.log(Math.max(5, r.sinceAny!))]), effRows.map((x) => x.drop), ['setNumber', 'superset', 'lnOwnRest', 'lnSinceAnySet']),
  modelRir: (() => { const xs = effRows.filter(({ r, f }) => r.rir != null && f.rir != null); return mreg(xs.map(({ r, f }) => [r.k, r.inter ? 1 : 0, Math.log(r.rest!), (r.rir as number) - (f.rir as number)]), xs.map((x) => x.drop), ['setNumber', 'superset', 'lnOwnRest', 'rirChange']); })(),
  meanDrop: { superset: (() => { const xs = effRows.filter((x) => x.r.inter); return { n: xs.length, drop: xs.reduce((s, x) => s + x.drop, 0) / Math.max(1, xs.length), rest: median(xs.map((x) => x.r.rest!)) }; })(),
    straight: (() => { const xs = effRows.filter((x) => !x.r.inter); return { n: xs.length, drop: xs.reduce((s, x) => s + x.drop, 0) / Math.max(1, xs.length), rest: median(xs.map((x) => x.r.rest!)) }; })() },
  ownRest: ols(effRows.map((x) => Math.log(x.r.rest!)), effRows.map((x) => x.drop)),
  sinceAny: ols(effRows.map((x) => Math.log(Math.max(5, x.r.sinceAny!))), effRows.map((x) => x.drop)),
  points: effRows.map(({ r, drop }) => [Math.round(r.rest!), drop, r.inter ? 1 : 0, r.k]),
};

// ---- 10. Readiness (recovery) against how the day went --------------------------------------------------------------------------
const readyRows: { date: string; lift: string; pFull: number; resid: number }[] = [];
for (const D of dates) {
  const firsts = rows.filter((r) => r.date === D && r.k === 0 && r.cap);
  if (!firsts.length) continue;
  let m;
  try { m = readinessModel(logBefore(log, D), [], D, TZ); } catch { continue; }
  const sr2 = m.sessionReady(firsts.map((r) => ({ exercise: r.lift, sets: 1, repMin: 8, repMax: 12 })), D);
  for (const r of firsts) { const l = sr2.lifts.find((x) => x.exercise === r.lift); if (l) readyRows.push({ date: D, lift: r.lift, pFull: l.pFull, resid: r.reps - r.cap!.habit }); }
}
const readyOut = { n: readyRows.length, fit: ols(readyRows.map((x) => x.pFull), readyRows.map((x) => x.resid)),
  low: (() => { const xs = readyRows.filter((x) => x.pFull < 0.5); return { n: xs.length, resid: xs.reduce((s, x) => s + x.resid, 0) / Math.max(1, xs.length) }; })(),
  high: (() => { const xs = readyRows.filter((x) => x.pFull >= 0.5); return { n: xs.length, resid: xs.reduce((s, x) => s + x.resid, 0) / Math.max(1, xs.length) }; })(),
  pFullMedian: median(readyRows.map((x) => x.pFull)), pFullMin: Math.min(...readyRows.map((x) => x.pFull)) };

// ---- 11. Deload and plateau calls by date -----------------------------------------------------------------------------------------
const deloadOut: Record<string, number> = {};
const plateau = { checked: 0, flagged: 0 };
for (const D of dates) {
  const before = logBefore(log, D);
  if (!before.length) continue;
  try { const s = systemic(before, [], D); const v = s?.verdict ?? 'none'; deloadOut[v] = (deloadOut[v] ?? 0) + 1; } catch { deloadOut.error = (deloadOut.error ?? 0) + 1; }
  const core = coreOf.get(D);
  if (core) for (const L of new Set(log.filter((e) => e.date === D && measured(e)).map((e) => e.exercise))) { const f = flatness(core, L, D); if (f) { plateau.checked++; if (f.p > 0.5) plateau.flagged++; } }
}

// ---- The fit itself, on the whole log ----------------------------------------------------------------------------------------------
const whole = coreBefore(log, '9999-12-31');
const fitOut = whole && { aSame: whole.aSame, aCross: whole.aCross, gamma: whole.gamma, tau: whole.tau, rho: whole.rho, habit: whole.habit, bias: whole.bias,
  noise: whole.noise, gap: whole.gap, sessions: whole.sessions, timed: whole.timed, tests: whole.tests, fit: whole.fit,
  rest: { sets: whole.rest.sets, sessions: whole.rest.sessions, gaps: whole.rest.gaps } };

const out = { generated: new Date().toISOString(), data: { sets: raw.length, dates: dates.length, from: dates[0], to: dates.at(-1), appDays: appDay.size,
  timedSets: log.filter((e) => e.loggedAt).length, rirSets: log.filter((e) => e.rir != null).length, pains: log.filter(hurts).length },
  fit: fitOut, perSet, nextSet: nextSetOut, strength: strengthOut, rest: restOut, switches: swOut, session: sessionOut, pain: painOut, test: testOut,
  volume: volumeOut, effects: effectOut, readiness: readyOut, deload: deloadOut, plateau };
const o = opt('--out');
if (o) writeFileSync(o, JSON.stringify(out, null, 1));
const show = (label: string, t: Record<string, ReturnType<typeof stats>>) => { console.log(`\n${label}`); for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(22)} n ${String(v.n).padStart(4)}  MAE ${v.mae}  bias ${v.bias}  ±1 ${v.within1}%`); };
console.log(`${raw.length} sets, ${dates.length} days (${dates[0]} – ${dates.at(-1)}), ${appDay.size} timed days.`);
show('Per-set reps, common subset', perSet.all);
show('Per-set reps, RIR logged (capGivenRir knows the RIR he then logged)', perSet.rir);
show('Next set within the session', nextSetOut.common);
show('Best set of each lift-session (strength)', Object.fromEntries(Object.entries(strengthOut).filter(([k]) => !['note', 'tests'].includes(k))) as unknown as Record<string, ReturnType<typeof stats>>);
console.log('\nRest timer: n', restOut.n, 'median timer', restOut.prescribedMedian, 'median gap', restOut.actualGapMedian, 'knee in use', restOut.kneeInUse);
console.log('Switches: n', swOut.n, 'median gap', swOut.medianGap, 'predicted', swOut.medianPredicted, 'slope s/rep', swOut.slopeSwitch?.slope.toFixed(2), '±', swOut.slopeSwitch?.se.toFixed(2));
console.log('Session length: pace', sessionOut.pace, 'plan', sessionOut.plan, 'usual', sessionOut.usual);
console.log('Pain: Brier', painOut.brier, 'AUC', painOut.auc);
console.log('Test due:', testOut.byRule);
console.log('Volume:', volumeOut.baseAsForecast, volumeOut.kinds);
console.log('Readiness:', readyOut.fit);
if (!o) console.log('\n(--out file.json writes every aggregate)');
