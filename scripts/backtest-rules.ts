// Round 2 of the walk-forward backtest (scripts/backtest.ts is round 1): progression-rule variants, the built-but-unused models
// stacked on the current rule, a strength trend, readiness power, what rest costs, and expected against actual strength growth.
//
//   npx jiti scripts/backtest-rules.ts log.csv [--body body.csv] [--settings settings.json] [--out result.json] [--tz Area/City]
//
// Every prediction for a session date D sees the log before D only (within a session, also that day's sets before the one it
// predicts). The guard against fitting noise: each tuned variant has at most 3 free parameters, is chosen on the first 70 % of
// dates and scored on the last 30 % (held-out), as a paired difference against the current rule with its SE clustered by day;
// and again walk-forward, its parameters chosen afresh on the dates before each date. Anything that needs logged RIR or set
// times can only use the days that have them (the app's own sessions), split the same way. `--body`: the app's body CSV (for
// energy 1–5); `--settings`: the lift settings as a JSON array of ExerciseSettings (saved ranges and rests).
// §G (days since the lift, learn/away): "the rule" everywhere here is nextTarget without that term (NO_AWAY), `shipped` with it.
// The log is personal data: keep it, the body file and the output out of the repo (AWAY_DIFFS=1 prints dates and lifts). Nothing
// is sent anywhere.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { parseCsv } from '../src/domain/csv';
import { parseBodyFile, type BodyDay } from '../src/domain/body';
import { byOrderDone, doneAt, learnable, sessionsFor } from '../src/domain/stats';
import { coreBefore, dayOf, logBefore, type Core, type Features } from '../src/domain/learn';
import { calibratedE1rm, e1rmAdjusted, paceOf } from './backtest-retired';
import { TAUS } from '../src/domain/learn/capacity';
import { strengthOf } from '../src/domain/learn/strength';
import { liftKey } from '../src/domain/ids';
import { resolveLift } from '../src/domain/lifts';
import { overlap } from '../src/domain/learn/tags';
import { isCardio, isCardioEntry } from '../src/domain/cardio';
import { isHold } from '../src/domain/care';
import { bodyShare } from '../src/domain/learn/bodyweight';
import { awayFitOf, awayPoints as appAwayPoints, defaultSettings, isTraining, isWorking, LAYOFF_AVERAGE_DAYS, nextTarget, priorE1rm, resolveSettings, settingsKey, TARGET_RULES, type ExerciseSettings, type Target } from '../src/domain/progression';
import { AWAY_CAP, AWAY_PRIOR_SD, awayShift, awaySlope, type AwayPoint } from '../src/domain/learn/away';
import { nextSet, suggest, type Suggestion } from '../src/domain/suggest';
import { isIsolation, restFor, sessionMinutes, usualMinutes, SET_WORK, type Step } from '../src/domain/timing';
import { kneeAfter } from '../src/domain/learn/rest';
import { gapModel } from '../src/domain/learn/switch';
import { paceBefore } from '../src/domain/learn/session';
import { energyFit, readinessModel, sessionResiduals } from '../src/domain/learn/readiness';
import { addDays } from '../src/domain/analytics';
import type { SetEntry } from '../src/domain/types';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) { console.error('usage: npx jiti scripts/backtest-rules.ts log.csv [--body body.csv] [--settings settings.json] [--out result.json] [--tz Area/City]'); process.exit(1); }
const TZ = opt('--tz') ?? 'UTC';
const NO_AWAY = { ...TARGET_RULES, away: false };
const TRAIN_SHARE = 0.7;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- Numbers ------------------------------------------------------------------------------------------------------------------
type Pair = { p: number; a: number };
const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
function stats(xs: Pair[]) {
  const n = xs.length;
  if (!n) return { n: 0, mae: null, bias: null, within1: null, hit: null };
  const e = xs.map((x) => x.p - x.a);
  return { n, mae: r3(e.reduce((s, v) => s + Math.abs(v), 0) / n), bias: r3(e.reduce((s, v) => s + v, 0) / n),
    within1: r2(100 * e.filter((v) => Math.abs(v) <= 1).length / n), hit: r2(100 * xs.filter((x) => x.a >= Math.round(x.p) - 1e-9).length / n) };
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sdOf = (xs: number[]) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) : NaN; };
const quant = (xs: number[], q: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };
const median = (xs: number[]) => quant(xs, 0.5);
function invert(A: number[][]): number[][] | null {
  const p = A.length, M = A.map((row, i) => [...row, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c]; if (Math.abs(d) < 1e-12) return null;
    for (let k = 0; k < 2 * p; k++) M[c][k] /= d;
    for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * p; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row) => row.slice(p));
}
/** OLS y ~ 1 + X, SEs clustered by `g` (CR1). `noIntercept`: y ~ X. */
function creg(X: number[][], y: number[], g: string[], names: string[], noIntercept = false) {
  const n = y.length, Z = X.map((r) => (noIntercept ? r : [1, ...r])), p = Z[0]?.length ?? 0;
  if (n <= p + 1) return null;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) { b[j] += Z[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += Z[i][j] * Z[i][k]; }
  const inv = invert(A);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
  const e = Z.map((z, i) => y[i] - z.reduce((s, v, j) => s + v * beta[j], 0));
  const groups = new Map<string, number[]>();
  Z.forEach((z, i) => { const s = groups.get(g[i]) ?? new Array(p).fill(0); for (let j = 0; j < p; j++) s[j] += z[j] * e[i]; groups.set(g[i], s); });
  const meat = Array.from({ length: p }, () => new Array(p).fill(0));
  for (const s of groups.values()) for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) meat[j][k] += s[j] * s[k];
  const G = groups.size, c = G > 1 ? (G / (G - 1)) * ((n - 1) / (n - p)) : 1;
  const V = inv.map((row) => meat[0].map((_, k) => row.reduce((s, v, j) => s + v * meat[j].reduce((t, m, l) => t + m * inv[l][k], 0), 0)));
  const all = noIntercept ? names : ['intercept', ...names];
  const rse = Math.sqrt(e.reduce((s, v) => s + v * v, 0) / (n - p));
  return { n, G, rse, coef: Object.fromEntries(all.map((k, j) => [k, { b: beta[j], se: Math.sqrt(Math.max(0, c * V[j][j])) }])) as Record<string, { b: number; se: number }> };
}
/** Paired: mean |error| of `a` less `b` on the same sets, SE clustered by day. */
function paired<R extends { date: string; reps: number }>(xs: R[], a: (r: R) => number | null | undefined, b: (r: R) => number | null | undefined) {
  const byDay = new Map<string, number[]>();
  for (const r of xs) { const pa = a(r), pb = b(r); if (pa == null || pb == null || !Number.isFinite(pa) || !Number.isFinite(pb)) continue; const d = Math.abs(pa - r.reps) - Math.abs(pb - r.reps); byDay.set(r.date, [...(byDay.get(r.date) ?? []), d]); }
  const all = [...byDay.values()].flat(), n = all.length, G = byDay.size;
  if (n < 2 || G < 2) return { n, days: G, diff: null as number | null, se: null as number | null };
  const m = all.reduce((x, y) => x + y, 0) / n;
  let v = 0;
  for (const ds of byDay.values()) { const s0 = ds.reduce((x, y) => x + y - m, 0); v += s0 * s0; }
  return { n, days: G, diff: r3(m), se: r3(Math.sqrt(v * G / (G - 1)) / n) };
}
const P = <R extends { reps: number }>(f: (r: R) => number | null | undefined, xs: R[]) => xs.flatMap((r) => { const p = f(r); return p == null || !Number.isFinite(p) ? [] : [{ p, a: r.reps }]; });

// ---- The log --------------------------------------------------------------------------------------------------------------------
const { entries: raw, errors } = parseCsv(readFileSync(file, 'utf8'));
if (errors.length) console.error(`${errors.length} rows not read, e.g.`, errors.slice(0, 3));
const log = learnable(raw);
const bodyFile = opt('--body');
const body: BodyDay[] = bodyFile ? parseBodyFile(readFileSync(bodyFile, 'utf8')).days : [];
const settingsFile = opt('--settings');
const saved = new Map<string, ExerciseSettings>(settingsFile ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as ExerciseSettings[]).map((s) => [s.key, s]) : []);
const stOf = (L: string) => resolveSettings(saved.get(settingsKey(L)), L, undefined, 'size');
const dates = [...new Set(log.map((e) => e.date))].sort();
const appDay = new Set(dates.filter((d) => log.some((e) => e.date === d && e.loggedAt)));
const appDates = dates.filter((d) => appDay.has(d));
const heldFrom = dates[Math.round(TRAIN_SHARE * dates.length)];
const appHeldFrom = appDates[Math.round(TRAIN_SHARE * appDates.length)];
const split = { trainDates: dates.filter((d) => d < heldFrom).length, heldDates: dates.filter((d) => d >= heldFrom).length, heldFrom,
  appTrainDates: appDates.filter((d) => d < appHeldFrom).length, appHeldDates: appDates.filter((d) => d >= appHeldFrom).length, appHeldFrom };

const cardio = (e: SetEntry) => isCardioEntry(e) || isCardio(e.exercise);
const isHard = (e: SetEntry) => !e.flags.includes('warmup') && !e.flags.includes('partial') && e.reps != null && e.reps > 0 && !cardio(e);
const measured = (e: SetEntry) => isTraining(e) && isHard(e) && e.weight > 0 && !e.flags.includes('bodyweight') && bodyShare(e.exercise) == null
  && !e.flags.includes('hold') && !isHold(e.exercise) && (e.reps as number) <= 30;
const epley = (w: number, r: number) => w * (1 + r / 30);

/** The capacity equation's fatigue features of hard[a] from hard[0..a) at times t (s), on a τ grid, as learn/capacity builds them. */
function featuresOf(hard: SetEntry[], a: number, t: number[], taus: readonly number[] = TAUS): Features {
  const NT = taus.length;
  const f: Features = { nS: 0, nC: 0, nY: 0, eS: new Float64Array(NT), eC: new Float64Array(NT) };
  const key = liftKey(hard[a].exercise), v = resolveLift(hard[a].exercise).m;
  for (let b = 0; b < a; b++) {
    const dt = Math.max(1, t[a] - t[b]);
    if (liftKey(hard[b].exercise) === key) { f.nS++; for (let k = 0; k < NT; k++) f.eS[k] += Math.exp(-dt / taus[k]); }
    else { f.nY++; const o = overlap(resolveLift(hard[b].exercise).m, v); if (o > 0) { f.nC += o; for (let k = 0; k < NT; k++) f.eC[k] += o * Math.exp(-dt / taus[k]); } }
  }
  return f;
}
/** fatigueOf split into its three terms: the lift's own earlier sets (A_same), overlapping lifts (A_cross), any earlier set (γ). */
interface Terms { same: number; cross: number; gamma: number }
function termsOf(core: Core, key: string, f: Features): Terms {
  const { kTau: k, rho, theta } = core.fit;
  const a = core.lifts.get(key)?.aSame.mean ?? theta[0];
  return { same: a * (rho * f.nS + (1 - rho) * f.eS[k]), cross: theta[1] * (rho * f.nC + (1 - rho) * f.eC[k]), gamma: theta[2] * f.nY };
}
const tot = (t: Terms) => t.same + t.cross + t.gamma;
const HARD = new Map<string, { hard: SetEntry[]; t: number[] }>();
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

// ---- Strength trend: each lift's slope of ln e1RM per day from the core's session readings, shrunk to the lifts' pooled slope --
/** (h: recency half-life, days; s: prior SD of a lift's slope around the pooled one, %/week; Infinity = none). */
const HALF = [90, 180, 365, Infinity] as const;
const SPREAD = [0, 0.1, 0.25, 0.5, 1, Infinity] as const;
type TrendKey = `${number}|${number}`;
const SLOPES = new Map<string, Map<TrendKey, Map<string, number>>>();
function slopesFor(D: string, core: Core): Map<TrendKey, Map<string, number>> {
  let hit = SLOPES.get(D);
  if (hit) return hit;
  hit = new Map();
  const today = dayOf(D);
  for (const h of HALF) {
    const own = new Map<string, { b: number; se: number }>();
    for (const [key, l] of core.lifts) {
      if (l.unit !== 'lb' || l.obs.length < 4) continue;
      const w = l.obs.map((o) => (Number.isFinite(h) ? 2 ** (-(today - o.day) / h) : 1) / Math.max(1e-6, o.v));
      const W = w.reduce((a, b) => a + b, 0), mx = l.obs.reduce((s, o, i) => s + w[i] * o.day, 0) / W, my = l.obs.reduce((s, o, i) => s + w[i] * o.z, 0) / W;
      let sxx = 0, sxy = 0;
      l.obs.forEach((o, i) => { sxx += w[i] * (o.day - mx) ** 2; sxy += w[i] * (o.day - mx) * (o.z - my); });
      if (!(sxx > 0)) continue;
      const b = sxy / sxx;
      let chi = 0;
      l.obs.forEach((o, i) => { chi += w[i] * (o.z - my - b * (o.day - mx)) ** 2; });
      const se = Math.sqrt(Math.max(1, chi / (l.obs.length - 2)) / sxx);
      own.set(key, { b, se });
    }
    const pw = [...own.values()].reduce((a, x) => a + 1 / x.se ** 2, 0);
    const pooled = pw > 0 ? [...own.values()].reduce((a, x) => a + x.b / x.se ** 2, 0) / pw : 0;
    for (const s of SPREAD) {
      const m = new Map<string, number>();
      const s2 = (s / 100 / 7) ** 2;
      for (const key of core.lifts.keys()) {
        const o = own.get(key);
        m.set(key, !o ? pooled : s === Infinity ? o.b : s === 0 ? pooled : (o.b / o.se ** 2 + pooled / s2) / (1 / o.se ** 2 + 1 / s2));
      }
      m.set('__pooled', pooled);
      hit.set(`${h}|${s}` as TrendKey, m);
    }
  }
  SLOPES.set(D, hit);
  return hit;
}

// ---- Per-set rows -------------------------------------------------------------------------------------------------------------
interface SetRead { reps: number; rir: number | null }
/** One lift's target for a day, as the rule made it, with what the variants need. */
interface Tgt {
  date: string; lift: string; key: string; kind: string; repPath: boolean; max: number; weight: number; top: number;
  last: SetRead[]; prev: (SetRead | null)[] | null; lastDate: string; days: number; perSet: number[] | null; iso: boolean;
}
interface Row {
  date: string; app: boolean; lift: string; key: string; k: number; weight: number; reps: number; rir: number | null; e: SetEntry;
  timed: boolean; iso: boolean; inter: boolean | null; rest: number | null; T: Tgt | null; rule: number | null; lastSame: number | null;
  shown: { weight: number | null; reps: number } | null;
  cap: { pred: number; now: Terms; d: Terms | null; kappa: number; e1rm: number; days: number; w: number; habit: number } | null;
  ext: number | null;
  /** The target as the app makes it, the days-away term (learn/away) in, learned before the day: `rule` is the rule without it. */
  shipped: number | null;
  ns: { app: number; base: number; rir: number | null; top: number; dX: number; raised: boolean } | null;
}
const rows: Row[] = [];
const tgts: Tgt[] = [];
const coreOf = new Map<string, Core | null>();
const unspot = (x: SetEntry): SetEntry => (x.flags.includes('no_spot') && x.target?.weight != null && x.target.weight === x.weight && x.reps != null && x.reps < x.target.reps ? { ...x, reps: x.target.reps } : x);

for (const D of dates) {
  const before = logBefore(log, D) as SetEntry[];
  if (!before.length) continue;
  const core = coreBefore(log, D);
  coreOf.set(D, core);
  const day = log.filter((e) => e.date === D).sort(byOrderDone);
  const hard = day.filter(isHard);
  const times = hard.map(doneAt);
  const timed = hard.length > 0 && times.every(Number.isFinite);
  const gap = core?.gap ?? 180;
  const tAct = timed ? times.map((x) => (x - times[0]) / 1000) : hard.map((_, i) => i * gap);
  const perLift = new Map<string, { t: Target | null; ts: Target | null; T: Tgt | null; sug: Suggestion | null }>();
  for (let a = 0; a < hard.length; a++) {
    const e = hard[a];
    if (!measured(e)) continue;
    const L = e.exercise, key = liftKey(L), st = stOf(L);
    if (!perLift.has(key)) {
      let t: Target | null = null;
      // The rule without the days-away term (§G scores that term on top of it), and as the app ships it.
      try { t = nextTarget(before, L, st, D, null, false, NO_AWAY); } catch { t = null; }
      let ts: Target | null = null;
      try { ts = nextTarget(before, L, st, D, null); } catch { ts = null; }
      let T: Tgt | null = null;
      const train = t ? t.last.filter(isTraining) : [];
      if (t && train.length && t.kind !== 'test' && t.kind !== 'carry') {
        const top = Math.max(...train.map((x) => x.weight));
        const atTop = train.filter((x) => x.weight === top).map(unspot);
        const lastDate = t.last[0].date;
        const prevS = sessionsFor(before, L).find((x) => x.date < lastDate && x.sets.some(isTraining));
        const prevTop = prevS ? Math.max(...prevS.sets.filter(isTraining).map((x) => x.weight)) : null;
        const prev = prevS && prevTop === top ? prevS.sets.filter((x) => isTraining(x) && x.weight === top).map(unspot).map((x) => ({ reps: x.reps as number, rir: x.rir ?? null })) : null;
        const stacked = t.parts.some((p) => p.key === 'stack');
        T = { date: D, lift: L, key, kind: t.kind, repPath: t.kind === 'reps' && !t.parts.some((p) => p.key === 'layoff'), max: stacked ? Infinity : t.range?.repMax ?? st.repMax,
          weight: t.weight, top, last: atTop.map((x) => ({ reps: x.reps as number, rir: x.rir ?? null })), prev: prev && prev.length ? prev : null, lastDate,
          days: dayOf(D) - dayOf(lastDate), perSet: t.perSet ?? null, iso: isIsolation(L) };
        tgts.push(T);
      }
      let sug: Suggestion | null = null;
      try { sug = suggest(before, L, st, D, null); } catch { /* none */ }
      perLift.set(key, { t, ts, T, sug });
    }
    const { t, ts, T, sug } = perLift.get(key)!;
    const mine = hard.slice(0, a).filter((x) => liftKey(x.exercise) === key);
    const k = mine.filter(isTraining).length;
    const prevOwn = mine.at(-1), pi = prevOwn ? hard.indexOf(prevOwn) : -1;
    const inter = prevOwn ? hard.slice(pi + 1, a).some((x) => liftKey(x.exercise) !== key) : null;
    const rest = timed && prevOwn ? tAct[a] - tAct[pi] : null;
    const ruleOf = (x: Target | null) => (x && x.weight === e.weight && (x.perSet || x.reps != null) ? (x.perSet ? x.perSet[Math.min(k, x.perSet.length - 1)] : x.reps) : null);
    const rule = ruleOf(t);
    const lastTrain = t ? t.last.filter((x) => isTraining(x) && T && x.weight === T.top) : [];
    const sameSet = lastTrain.length ? lastTrain[Math.min(k, lastTrain.length - 1)] : null;
    let cap: Row['cap'] = null;
    const s = core ? strengthOf(core, L, D) : null;
    if (core && s) {
      const f = featuresOf(hard, a, tAct), now = termsOf(core, key, f);
      const C = s.kappa * (s.e1rm / e.weight - 1);
      let d: Terms | null = null;
      if (sameSet && sameSet.weight === e.weight) {
        const ld = dayHard(sameSet.date, core.gap), i = ld.hard.indexOf(sameSet);
        if (i >= 0) { const then = termsOf(core, key, featuresOf(ld.hard, i, ld.t)); d = { same: then.same - now.same, cross: then.cross - now.cross, gamma: then.gamma - now.gamma }; }
      }
      cap = { pred: C - tot(now) - core.habit.mean, now, d, kappa: s.kappa, e1rm: s.e1rm, days: s.days, w: e.weight, habit: core.habit.mean };
    }
    let ns: Row['ns'] = null;
    if (sug && k >= 1 && appDay.has(D)) {
      const done = day.filter((x) => liftKey(x.exercise) === key && byOrderDone(x, e) < 0);
      try {
        const n = nextSet(before, L, D, sug, done), nb = nextSet(before, L, D, sug, done.map((x) => ({ ...x, rir: undefined })));
        const lastT = done.filter((x) => isWorking(x) && !x.flags.includes('test'));
        const lr = (lastT.findLast((x) => x.loggedAt) ?? lastT.at(-1))?.rir;
        let dX = 0;
        if (core && pi >= 0) {
          const fN = termsOf(core, key, featuresOf(hard, a, tAct)), fP = termsOf(core, key, featuresOf(hard, pi, tAct));
          dX = (fN.cross - fP.cross) + (fN.gamma - fP.gamma);
        }
        if (n && nb) ns = { app: n.reps, base: nb.reps, rir: lr == null ? null : Math.min(4, Math.max(0, lr)), top: sug.stacked ? Infinity : sug.top ?? sug.repMax, dX, raised: n.reps !== nb.reps };
      } catch { /* none */ }
    }
    rows.push({ date: D, app: appDay.has(D), lift: L, key, k, weight: e.weight, reps: e.reps as number, rir: e.rir ?? null, e, timed, iso: isIsolation(L), inter, rest,
      T: T && T.weight === e.weight ? T : null, rule, lastSame: sameSet && sameSet.weight === e.weight ? (unspot(sameSet).reps as number) : null,
      shown: e.target ? { weight: e.target.weight, reps: e.target.reps } : null, cap, ext: null, ns, shipped: ruleOf(ts) });
  }
}

// ---- Validation: rolling-origin (forward-chaining) cross-validation -------------------------------------------------------------
// The dates after an initial stretch are cut into consecutive test blocks. Each block is scored by a model fitted (and, for a
// family, chosen) on every date before the block less a gap, so a lift's sessions next to the block can't carry its level into
// the fit. The blocks' scores are pooled; paired SEs are clustered by day. Never a random split of days: a day between two
// training days is "predicted" from its own future (see randomSplit below for how much that flatters).
type Pred<R> = (r: R) => number | null | undefined;
interface Fold { start: string; end: string; trainBefore: string }
function foldsOf(ds: string[], n: number, firstShare: number, gapDays: number): Fold[] {
  const test = ds.slice(Math.round(firstShare * ds.length)), size = Math.ceil(test.length / n);
  return Array.from({ length: n }, (_, f) => test.slice(f * size, (f + 1) * size)).filter((b) => b.length)
    .map((b) => ({ start: b[0], end: b.at(-1)!, trainBefore: addDays(b[0], -gapDays) }));
}
/** Every date: 5 blocks over the last 60 %, a 14-day gap. App days (RIR, times): 4 blocks over the last 70 %, a 7-day gap. */
const FOLDS = foldsOf(dates, 5, 0.4, 14);
const APP_FOLDS = foldsOf(appDates, 4, 0.3, 7);
interface Cand<R> { name: string; params: number; fit: (train: R[]) => Pred<R> }
const fixed = <R,>(name: string, params: number, pred: Pred<R>): Cand<R> => ({ name, params, fit: () => pred });
const maeOn = <R extends { reps: number }>(xs: R[], f: Pred<R>) => { let s = 0, n = 0; for (const r of xs) { const p = f(r); if (p == null || !Number.isFinite(p)) continue; s += Math.abs(p - r.reps); n++; } return n ? s / n : Infinity; };
/**
 * Each fold: every candidate fitted on the fold's training rows, the one with the lowest training MAE chosen (the first, the
 * current rule, winning ties and any fold with no training rows), and the block predicted by it. Pooled over the blocks against
 * `base`; `table`: each candidate on its own (fitted per fold, no choosing). `pred`: the pooled out-of-sample prediction.
 */
function cv<R extends { date: string; reps: number }>(xs: R[], cands: Cand<R>[], base: Pred<R>, folds: Fold[]) {
  const chosen = new Map<R, number | null | undefined>(), per = cands.map(() => new Map<R, number | null | undefined>());
  const picks: Record<string, number> = {}, foldOut: { start: string; end: string; train: number; test: number; pick: string }[] = [];
  for (const f of folds) {
    const train = xs.filter((r) => r.date < f.trainBefore), block = xs.filter((r) => r.date >= f.start && r.date <= f.end);
    if (!block.length) continue;
    const fits = cands.map((c) => c.fit(train));
    // Choosing is itself out of sample (nested): each candidate fitted on the first 70 % of the fold's training dates (less the
    // same gap) and scored on the rest of them; with too little for that, on the training rows themselves.
    const td = [...new Set(train.map((r) => r.date))].sort(), cut = td[Math.round(0.7 * td.length)];
    const gapDays = dayOf(f.start) - dayOf(f.trainBefore);
    const inner = cut ? train.filter((r) => r.date < addDays(cut, -gapDays)) : [], val = cut ? train.filter((r) => r.date >= cut) : [];
    const m = cands.map((c, i) => (!train.length ? Infinity : inner.length && val.length ? maeOn(val, c.fit(inner)) : maeOn(train, fits[i])));
    let bi = 0;
    m.forEach((v, i) => { if (v < m[bi] - 1e-9) bi = i; });
    picks[cands[bi].name] = (picks[cands[bi].name] ?? 0) + 1;
    foldOut.push({ start: f.start, end: f.end, train: train.length, test: block.length, pick: cands[bi].name });
    for (const r of block) { chosen.set(r, fits[bi](r)); fits.forEach((p, i) => per[i].set(r, p(r))); }
  }
  const tested = [...chosen.keys()], pred: Pred<R> = (r) => chosen.get(r);
  return { folds: foldOut, picks, pred,
    cv: { ...stats(P(pred, tested)), base: stats(P(base, tested)), vsBase: paired(tested, pred, base) },
    table: cands.map((c, i) => { const f: Pred<R> = (r) => per[i].get(r); return { name: c.name, params: c.params, ...stats(P(f, tested)), vsBase: paired(tested, f, base) }; }) };
}
const strip = <T extends { pred: unknown }>(x: T) => { const { pred: _p, ...rest } = x; return rest; };
/** A coefficient c for y − base ≈ c·x, least squares through 0 on `xs`. */
const coefOn = <R extends { reps: number }>(xs: R[], base: Pred<R>, x: (r: R) => number) => { let sxy = 0, sxx = 0; for (const r of xs) { const b = base(r); if (b == null) continue; const v = x(r); sxy += v * (r.reps - b); sxx += v * v; } return sxx > 0 ? sxy / sxx : 0; };
/** Several coefficients at once: y − base ≈ Σ c_j·x_j. */
function coefsOn<R extends { reps: number; date: string }>(xs: R[], base: Pred<R>, x: (r: R) => number[]) {
  const ok = xs.filter((r) => base(r) != null);
  if (ok.length < 10) return null;
  const fit = creg(ok.map(x), ok.map((r) => r.reps - (base(r) as number)), ok.map((r) => r.date), x(ok[0]).map((_, j) => `c${j}`), true);
  return fit ? x(ok[0]).map((_, j) => fit.coef[`c${j}`].b) : null;
}
/** base + Σ c_j·x_j, the c fitted on each fold's training rows (base alone until there are 10). */
const coefCand = <R extends { reps: number; date: string }>(name: string, base: Pred<R>, feats: (r: R) => number[], round = false): Cand<R> => ({ name, params: feats.length, fit: (train) => {
  const c = coefsOn(train, base, feats);
  return (r) => { const b = base(r); if (b == null) return null; const v = b + (c ? feats(r).reduce((s, x, j) => s + x * c[j], 0) : 0); return round ? Math.round(v) : v; };
} });
/** A fitted family on its own: its pooled CV score against base, and its coefficients on the whole set (for reading only). */
function fitted<R extends { date: string; reps: number }>(xs: R[], base: Pred<R>, feats: (r: R) => number[], folds: Fold[], round = false) {
  const res = cv(xs, [coefCand('fitted', base, feats, round)], base, folds);
  return { coefAll: coefsOn(xs, base, feats)?.map((v) => r3(v)), ...strip(res), pred: res.pred };
}

// ---- D. Progression-rule variants ---------------------------------------------------------------------------------------------
type Variant = { thr: number; one: boolean; consec: boolean } | 'never' | 'alwaysEach' | 'alwaysOne';
const vName = (v: Variant) => (typeof v === 'string' ? v : `RIR≥${v.thr} · ${v.one ? 'one set' : 'each set'}${v.consec ? ' · 2 sessions running' : ''}`);
function aimOf(T: Tgt, v: Variant): number[] {
  const last = T.last, max = T.max;
  if (v === 'never') return last.map((x) => x.reps);
  if (v === 'alwaysEach') return last.map((x) => (x.reps < max ? x.reps + 1 : x.reps));
  if (v === 'alwaysOne') { let b = -1; last.forEach((x, i) => { if (x.reps < max && (b < 0 || x.reps < last[b].reps)) b = i; }); return last.map((x, i) => x.reps + (i === b ? 1 : 0)); }
  const ok = (i: number) => last[i].rir != null && last[i].rir! >= v.thr && last[i].reps < max
    && (!v.consec || (!!T.prev && !!T.prev[i] && T.prev[i]!.rir != null && T.prev[i]!.rir! >= v.thr));
  if (!v.one) return last.map((x, i) => x.reps + (ok(i) ? 1 : 0));
  let b = -1;
  last.forEach((x, i) => { if (ok(i) && (b < 0 || x.rir! > last[b].rir! || (x.rir === last[b].rir && x.reps < last[b].reps))) b = i; });
  return last.map((x, i) => x.reps + (i === b ? 1 : 0));
}
const CURRENT: Variant = { thr: 2, one: false, consec: false };
const variantPred = (v: Variant) => (r: Row) => {
  if (r.rule == null) return null;
  if (!r.T || !r.T.repPath) return r.rule;
  const aim = aimOf(r.T, v);
  return aim[Math.min(r.k, aim.length - 1)];
};
// The replay must reproduce the rule: the current variant against the rule's own number, on every repStep row.
const repRows = rows.filter((r) => r.rule != null && r.T?.repPath);
const replayMismatch = repRows.filter((r) => variantPred(CURRENT)(r) !== r.rule).length;
const RIR_VARIANTS: Variant[] = ['never', ...[1, 2, 3, 4].flatMap((thr) => [false, true].flatMap((one) => [false, true].map((consec) => ({ thr, one, consec }))))];
const atRule = rows.filter((r) => r.rule != null);
const rirRows = atRule.filter((r) => r.app);
/** A lift-day's implied change in e1RM (Epley, share) if every set hit its target, against last time's same sets. */
function impliedOf(T: Tgt, aim: number[]): number | null {
  if (!T.last.length) return null;
  const n = Math.min(aim.length, T.last.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += epley(T.weight, aim[i]) / epley(T.top, T.last[i].reps) - 1;
  return s / n;
}
const tAim = (T: Tgt, v: Variant) => (T.repPath ? aimOf(T, v) : T.perSet ?? null);
function progression(v: Variant | ((T: Tgt) => number[] | null), from: string, to = '9999') {
  const byLift = new Map<string, { date: string; d: number }[]>();
  for (const T of tgts) {
    if (T.date < from || T.date >= to) continue;
    const aim = typeof v === 'function' ? (T.repPath ? v(T) : T.perSet ?? null) : tAim(T, v);
    const d = aim ? impliedOf(T, aim) : null;
    if (d == null || !Number.isFinite(d)) continue;
    byLift.set(T.key, [...(byLift.get(T.key) ?? []), { date: T.date, d }]);
  }
  const perLift = [...byLift].filter(([, xs]) => xs.length >= 5).map(([key, xs]) => {
    const weeks = (dayOf(xs.at(-1)!.date) - dayOf(xs[0].date)) / 7;
    return { key, n: xs.length, perSession: mean(xs.map((x) => x.d)), perWeek: weeks > 0 ? xs.reduce((a, x) => a + x.d, 0) / weeks : null };
  });
  const all = [...byLift.values()].flat();
  return { lifts: perLift.length, perSessionPct: r3(100 * mean(all.map((x) => x.d))), perWeekPctMedian: r3(100 * median(perLift.flatMap((x) => (x.perWeek == null ? [] : [x.perWeek])))),
    shareUp: r2(100 * all.filter((x) => x.d > 1e-9).length / Math.max(1, all.length)) };
}
const variantTable = (xs: Row[], vs: Variant[]) => vs.map((v) => ({ name: vName(v), ...stats(P(variantPred(v), xs)), vsCurrent: paired(xs, variantPred(v), variantPred(CURRENT)) }));
const shownRows = rows.filter((r) => r.shown && r.shown.weight === r.weight && isTraining(r.e));
const progressionOut = {
  replay: { repStepRows: repRows.length, mismatches: replayMismatch },
  // Does he stop at the target the app showed? (app era: sets logged with the target on screen)
  shown: { n: shownRows.length, exactly: r2(100 * shownRows.filter((r) => r.reps === r.shown!.reps).length / Math.max(1, shownRows.length)),
    above: r2(100 * shownRows.filter((r) => r.reps > r.shown!.reps).length / Math.max(1, shownRows.length)), below: r2(100 * shownRows.filter((r) => r.reps < r.shown!.reps).length / Math.max(1, shownRows.length)),
    replayAgrees: r2(100 * shownRows.filter((r) => r.rule === r.shown!.reps).length / Math.max(1, shownRows.filter((r) => r.rule != null).length)) },
  rirRows: { n: rirRows.length, days: new Set(rirRows.map((r) => r.date)).size, differs: rirRows.filter((r) => RIR_VARIANTS.some((v) => variantPred(v)(r) !== r.rule)).length,
    lastRirLogged: rirRows.filter((r) => r.T?.last.some((x) => x.rir != null)).length },
  rirGuard: strip(cv(rirRows, [CURRENT, ...RIR_VARIANTS.filter((v) => v !== CURRENT && vName(v) !== vName(CURRENT))].map((v) => fixed<Row>(vName(v), typeof v === 'string' ? 0 : 1 + (v.one ? 1 : 0) + (v.consec ? 1 : 0), variantPred(v))), variantPred(CURRENT), APP_FOLDS)),
  rirAll: variantTable(rirRows, RIR_VARIANTS),
  // Variants that need no RIR, on every date (the 2025–26 imports have none, so the current rule only repeats there).
  noRirGuard: strip(cv(atRule, ([CURRENT, 'never', 'alwaysOne', 'alwaysEach'] as Variant[]).map((v) => fixed<Row>(vName(v), 0, variantPred(v))), variantPred(CURRENT), FOLDS)),
  noRirAll: variantTable(atRule, ['never', 'alwaysOne', 'alwaysEach', CURRENT]),
  implied: Object.fromEntries((['never', 'alwaysOne', 'alwaysEach', CURRENT, { thr: 1, one: false, consec: false }, { thr: 3, one: false, consec: false }, { thr: 2, one: true, consec: false }, { thr: 2, one: false, consec: true }] as Variant[])
    .map((v) => [vName(v), { all: progression(v, dates[0]), app: progression(v, appDates[0]) }])),
};

// ---- D. A rate rule: each set aims at last time's same set plus a learned gain a session, per lift, shrunk toward its lift type
// (isolation / compound) and the type toward everyone (hierarchical shrinkage: a lift's own mean counts as n sets against k of
// its type's), or a literature rate. Rounded: a target is a whole number.
interface Gains { all: number; type: Map<boolean, number>; lift: Map<string, number> }
function gainsOf(train: Row[], k: number): Gains {
  const d = train.filter((r) => r.T?.repPath && r.lastSame != null && r.rule != null).map((r) => ({ key: r.key, iso: r.iso, g: r.reps - r.lastSame! }));
  const all = d.length ? mean(d.map((x) => x.g)) : 0;
  const type = new Map<boolean, number>(), lift = new Map<string, number>();
  for (const iso of [false, true]) { const xs = d.filter((x) => x.iso === iso); type.set(iso, k === Infinity ? all : (xs.reduce((a, x) => a + x.g, 0) + k * all) / (xs.length + k)); }
  for (const key of new Set(d.map((x) => x.key))) { const xs = d.filter((x) => x.key === key); const t = type.get(xs[0].iso)!; lift.set(key, k === Infinity ? t : (xs.reduce((a, x) => a + x.g, 0) + k * t) / (xs.length + k)); }
  return { all, type, lift };
}
const gainFor = (G: Gains, r: { key: string; iso: boolean }) => G.lift.get(r.key) ?? G.type.get(r.iso) ?? G.all;
const rateCand = (k: number, round = true): Cand<Row> => ({ name: k === Infinity ? 'one gain for everyone' : `per-lift gain, shrinkage k=${k}`, params: k === Infinity ? 1 : 2, fit: (train) => {
  const G = gainsOf(train, k);
  return (r) => (r.rule == null ? null : !r.T?.repPath || r.lastSame == null ? r.rule : round ? Math.round(r.lastSame + gainFor(G, r)) : r.lastSame + gainFor(G, r));
} });
/** A literature pace as reps: pct %/week of e1RM is pct/100 × (30 + reps) reps a week by Epley, times the weeks since last time. */
const litPred = (pct: number): Pred<Row> => (r) => (r.rule == null ? null : !r.T?.repPath || r.lastSame == null ? r.rule : Math.round(r.lastSame + pct / 100 * (30 + r.lastSame) * r.T.days / 7));
const KS = [0, 2, 5, 10, 20, 50, Infinity];
const rateCands = [fixed<Row>(vName(CURRENT), 0, variantPred(CURRENT)), ...KS.map((k) => rateCand(k)), fixed<Row>('literature 0.2 %/wk (trained)', 0, litPred(0.2)), fixed<Row>('literature 1 %/wk', 0, litPred(1))];
const rateAll = cv(atRule, rateCands, variantPred(CURRENT), FOLDS);
const rateApp = cv(rirRows, rateCands, variantPred(CURRENT), APP_FOLDS);
/** The implied progression of a rate rule, its gains learned walk-forward (from the rows before each target's date). */
function rateProgression(k: number, from: string) {
  const G = new Map<string, Gains>();
  return progression((T) => { let g = G.get(T.date); if (!g) { g = gainsOf(atRule.filter((r) => r.date < T.date), k); G.set(T.date, g); } const v = gainFor(g, T); return T.last.map((x) => x.reps + v); }, from);
}
const kAll = KS.find((k) => rateAll.picks[rateCand(k).name]) ?? 10;
const finalGains = gainsOf(atRule, kAll);
const rateOut = {
  all: strip(rateAll), app: strip(rateApp), k: kAll,
  fractional: strip(cv(atRule, KS.map((k) => ({ ...rateCand(k, false), name: `${rateCand(k).name}, unrounded` })), variantPred(CURRENT), FOLDS)),
  gains: { all: r3(finalGains.all), compound: r3(finalGains.type.get(false)), isolation: r3(finalGains.type.get(true)),
    lifts: [...finalGains.lift].map(([key, g]) => ({ key, g: r3(g), n: atRule.filter((r) => r.key === key && r.T?.repPath && r.lastSame != null).length })).sort((a, b) => b.n - a.n).slice(0, 15) },
  implied: { [`per-lift gain, k=${kAll}`]: { all: rateProgression(kAll, dates[0]), app: rateProgression(kAll, appDates[0]) },
    'one gain for everyone': { all: rateProgression(Infinity, dates[0]), app: rateProgression(Infinity, appDates[0]) } },
};

// ---- B and A: the capacity model's terms and a strength trend, on top of the current rule ---------------------------------
const capRows = atRule.filter((r) => r.cap);
const RULE: Pred<Row> = (r) => r.rule;
const dOf = (r: Row) => r.cap?.d ?? { same: 0, cross: 0, gamma: 0 };
const trendOf = (r: Row, key: TrendKey) => {
  if (!r.cap) return 0;
  const b = slopesFor(r.date, coreOf.get(r.date)!).get(key)!.get(r.key) ?? 0;
  return r.cap.kappa * r.cap.e1rm * (Math.exp(b * r.cap.days) - 1) / r.cap.w;
};
const TREND_KEYS = HALF.flatMap((h) => SPREAD.map((s) => `${h}|${s}` as TrendKey));
const trendName = (k: TrendKey) => `trend h=${k.split('|')[0]} d, s=${k.split('|')[1]} %/wk`;
const capTrendCv = cv(capRows, [fixed<Row>('no trend (the core as in the app)', 0, (r: Row) => r.cap?.pred),
  ...TREND_KEYS.map((k) => fixed<Row>(trendName(k), 2, (r: Row) => (r.cap ? r.cap.pred + trendOf(r, k) : null)))], RULE, FOLDS);
const capTrendGuard = strip(capTrendCv);
// The trend most folds chose (for the trend's other uses below).
const trendPicks = TREND_KEYS.map((k) => [k, capTrendGuard.picks[trendName(k)] ?? 0] as const).sort((a, b) => b[1] - a[1]);
const chosenTrend: TrendKey = trendPicks[0][1] > 0 ? trendPicks[0][0] : '365|0.25';
const pooledSlopes = dates.filter((d) => coreOf.get(d)).map((d) => ({ date: d, pctWeek: r3(100 * 7 * (slopesFor(d, coreOf.get(d)!).get(chosenTrend)!.get('__pooled') ?? 0)) }));
const stackOut = {
  n: capRows.length, days: new Set(capRows.map((r) => r.date)).size,
  capVsRule: { all: { rule: stats(P(RULE, capRows)), cap: stats(P((r: Row) => r.cap?.pred, capRows)) } },
  capTrend: capTrendGuard, chosenTrend,
  capTrendAll: { cap: stats(P((r: Row) => r.cap?.pred, capRows)), capTrend: stats(P((r: Row) => (r.cap ? r.cap.pred + trendOf(r, chosenTrend) : null), capRows)) },
  pooledSlope: { first: pooledSlopes[0], last: pooledSlopes.at(-1), points: pooledSlopes },
  // Rule + c × the model's fatigue difference (then − now); rule + c × the trend's reps since last time; and the split by term.
  ruleFat: fitted(capRows, RULE, (r) => [tot(dOf(r))], FOLDS),
  ruleFatRounded: fitted(capRows, RULE, (r) => [tot(dOf(r))], FOLDS, true),
  ruleTrend: fitted(capRows, RULE, (r) => [trendOf(r, chosenTrend)], FOLDS),
  ruleTrendRounded: fitted(capRows, RULE, (r) => [trendOf(r, chosenTrend)], FOLDS, true),
  ruleSame: fitted(capRows, RULE, (r) => [dOf(r).same], FOLDS),
  ruleTerms: fitted(capRows, RULE, (r) => [dOf(r).same, dOf(r).cross, dOf(r).gamma], FOLDS),
  ruleTermsApp: fitted(capRows.filter((r) => r.app), RULE, (r) => [dOf(r).same, dOf(r).cross, dOf(r).gamma], APP_FOLDS),
  ruleSameApp: fitted(capRows.filter((r) => r.app), RULE, (r) => [dOf(r).same], APP_FOLDS),
  withDiff: capRows.filter((r) => r.cap!.d).length,
  dSpread: { same: r3(sdOf(capRows.filter((r) => r.cap!.d).map((r) => r.cap!.d!.same))), cross: r3(sdOf(capRows.filter((r) => r.cap!.d).map((r) => r.cap!.d!.cross))), gamma: r3(sdOf(capRows.filter((r) => r.cap!.d).map((r) => r.cap!.d!.gamma))) },
};

// ---- G. Days since the lift: a learned per-day coefficient on top of the rule (learn/away, owner 2026-11-23) -----------------
// The rule's targets less the layoff rule's (15+ days: each set at last time's average) and anything not the rep rule: there the
// term never applies. x: days since the lift's last session (1–14). Fitted per fold on its training rows' lift-sessions (one point
// each: its mean miss of the rule), with the prior learn/away ships and others; rounded as a target is.
const awayX = (r: Row) => (r.T?.repPath && r.T.days >= 1 && r.T.days < LAYOFF_AVERAGE_DAYS ? r.T.days : null);
function awayPoints(xs: Row[]): AwayPoint[] {
  const by = new Map<string, { x: number; d: number[] }>();
  for (const r of xs) { const x = awayX(r); if (x == null || r.rule == null) continue; const k = `${r.date}|${r.key}`; const p = by.get(k) ?? { x: Math.min(AWAY_CAP, x), d: [] }; p.d.push(r.reps - r.rule); by.set(k, p); }
  return [...by].map(([k, p]) => ({ x: p.x, r: mean(p.d), date: k.split('|')[0], key: k.split('|')[1] }));
}
/** The rule's target moved by `shift` reps, as progression does it: up never past the range's top (a set already past it keeps its reps), down never under 1. */
const shifted = (rule: number, shift: number, max: number) => (shift > 0 ? Math.min(Math.max(rule, max), rule + shift) : Math.max(Math.min(rule, 1), rule + shift));
/** `from`: the sets the fit reads (every set, or each lift-session's first); `to`: the sets it moves. */
const awayCand = (sd: number, round = true, from: 'all' | 'first' = 'all', to: 'all' | 'first' = 'all'): Cand<Row> => ({
  name: `days away, prior SD ${sd}${round ? '' : ', unrounded'}${from === 'first' ? ', fitted on first sets' : ''}${to === 'first' ? ', first sets moved' : ''}`, params: 1, fit: (train) => {
  const f = awaySlope(awayPoints(from === 'first' ? train.filter((r) => r.k === 0) : train), sd);
  return (r) => { if (r.rule == null) return null; const x = awayX(r); if (x == null || !r.T || (to === 'first' && r.k > 0)) return r.rule; return round ? shifted(r.rule, awayShift(f, x, LAYOFF_AVERAGE_DAYS), r.T.max) : r.rule + f.c * (Math.min(AWAY_CAP, x) - f.ref); };
} });
const AWAY_SDS = [0.025, AWAY_PRIOR_SD, 0.1, Infinity];
const awayRows = atRule.filter((r) => awayX(r) != null);
function awayOutOf() {
  const all = cv(atRule, [fixed<Row>(vName(CURRENT), 0, RULE), ...AWAY_SDS.map((s) => awayCand(s))], RULE, FOLDS);
  const shipped = cv(atRule, [awayCand(AWAY_PRIOR_SD)], RULE, FOLDS);
  const unrounded = cv(atRule, AWAY_SDS.map((s) => awayCand(s, false)), RULE, FOLDS);
  const firsts = atRule.filter((r) => r.k === 0);
  const whole = awaySlope(awayPoints(atRule)), wholeOls = awaySlope(awayPoints(atRule), Infinity);
  const firstOls = awaySlope(awayPoints(firsts), Infinity), firstShrunk = awaySlope(awayPoints(firsts));
  // The readiness proxy's own rows (§C: first sets, every rule row, 15+ days counted as 14), for where its 0.1 a day came from.
  const proxyRows = rRows.filter((x) => x.ruleResid != null && x.since != null);
  const proxyOls = creg(proxyRows.map((x) => [Math.min(14, x.since!)]), proxyRows.map((x) => x.ruleResid!), proxyRows.map((x) => x.date), ['days']);
  const proxyUnder15 = proxyRows.filter((x) => x.since! < LAYOFF_AVERAGE_DAYS);
  const proxyOlsUnder15 = creg(proxyUnder15.map((x) => [x.since!]), proxyUnder15.map((x) => x.ruleResid!), proxyUnder15.map((x) => x.date), ['days']);
  // What ships: the app's own replay and fit (progression awayPoints, awayFitOf), refitted before each date (walk-forward).
  const shippedRows = atRule.filter((r) => r.shipped != null);
  const appCv = cv(shippedRows, [fixed<Row>('as the app ships it', 0, (r) => r.shipped)], RULE, FOLDS);
  // The replay against the rule's own rows: the same lift-sessions, and the same mean miss on them.
  const mine = awayPoints(atRule), app = appAwayPoints(learnable(log));
  const appBy = new Map(app.map((p) => [`${p.date}|${p.key}`, p]));
  const both = mine.filter((p) => appBy.has(`${p.date}|${p.key}`));
  const lastFit = awayFitOf(logBefore(log, addDays(dates.at(-1)!, 1)));
  return { rows: awayRows.length, liftSessions: mine.length,
    app: { ...strip(appCv), differs: shippedRows.filter((r) => r.shipped !== r.rule).length, rows: shippedRows.length,
      lastFit: { c: r3(lastFit.c), sd: r3(lastFit.sd), ref: r2(lastFit.ref), ols: r3(lastFit.ols), n: lastFit.n } },
    replay: { rule: mine.length, app: app.length, both: both.length, sameMiss: both.filter((p) => Math.abs(appBy.get(`${p.date}|${p.key}`)!.r - p.r) < 1e-9).length,
      // AWAY_DIFFS=1: each lift-session where they differ (dates and lift names: personal, so only on asking).
      diffs: process.env.AWAY_DIFFS ? [...mine.filter((p) => !appBy.has(`${p.date}|${p.key}`)).map((p) => ['rule only', p.date, p.key, p.x, r2(p.r)]),
        ...app.filter((p) => !mine.some((q) => q.date === p.date && q.key === p.key)).map((p) => ['app only', p.date, p.key, p.x, r2(p.r)]),
        ...both.filter((p) => Math.abs(appBy.get(`${p.date}|${p.key}`)!.r - p.r) >= 1e-9).map((p) => ['miss', p.date, p.key, p.x, r2(p.r), r2(appBy.get(`${p.date}|${p.key}`)!.r)])] : undefined },
    firstSets: { ols: r3(firstOls.c), olsSd: r3(firstOls.sd), c: r3(firstShrunk.c), n: firstOls.n, ref: r2(firstOls.ref) },
    proxy: { n: proxyRows.length, slope: proxyOls && r3(proxyOls.coef.days.b), se: proxyOls && r3(proxyOls.coef.days.se),
      under15: { n: proxyUnder15.length, slope: proxyOlsUnder15 && r3(proxyOlsUnder15.coef.days.b), se: proxyOlsUnder15 && r3(proxyOlsUnder15.coef.days.se) } },
    variants: strip(cv(atRule, [awayCand(AWAY_PRIOR_SD, true, 'first', 'first'), awayCand(AWAY_PRIOR_SD, true, 'first', 'all'), awayCand(Infinity, true, 'first', 'first'), awayCand(Infinity, true, 'first', 'all'), awayCand(Infinity, false, 'first', 'first')], RULE, FOLDS)).table
      .map((t) => ({ name: t.name, mae: t.mae, vsRule: t.vsBase })),
    xSpread: { p5: quant(awayRows.map((r) => awayX(r)!), 0.05), median: median(awayRows.map((r) => awayX(r)!)), p95: quant(awayRows.map((r) => awayX(r)!), 0.95) },
    whole: { c: r3(whole.c), sd: r3(whole.sd), ref: r2(whole.ref), ols: r3(wholeOls.c), olsSd: r3(wholeOls.sd), n: whole.n,
      moves: awayRows.filter((r) => awayShift(whole, awayX(r)!, LAYOFF_AVERAGE_DAYS) !== 0).length },
    shipped: strip(shipped), all: strip(all), unrounded: strip(unrounded),
    onFirstSets: strip(cv(firsts, [awayCand(AWAY_PRIOR_SD)], RULE, FOLDS)) };
}

// ---- A. Next set: the RIR raise, and cross-lift / any-set fatigue since the lift's last set ---------------------------------
const nsRows = rows.filter((r) => r.ns && r.ns.app != null);
const NS_APP: Pred<Row> = (r) => r.ns?.app, NS_BASE: Pred<Row> = (r) => r.ns?.base;
const NS_4: Pred<Row> = (r) => (!r.ns ? null : r.ns.rir != null && r.ns.rir >= 4 && r.ns.base < r.ns.top ? Math.min(r.ns.top, r.ns.base + 1) : r.ns.base);
const nextSetOut = {
  n: nsRows.length, days: new Set(nsRows.map((r) => r.date)).size, raised: nsRows.filter((r) => r.ns!.raised).length,
  all: { current: stats(P(NS_APP, nsRows)), none: stats(P(NS_BASE, nsRows)), fourPlus: stats(P(NS_4, nsRows)),
    noneVsCurrent: paired(nsRows, NS_BASE, NS_APP), fourVsCurrent: paired(nsRows, NS_4, NS_APP) },
  onRaised: (() => { const xs = nsRows.filter((r) => r.ns!.raised); return { n: xs.length, current: stats(P(NS_APP, xs)), none: stats(P(NS_BASE, xs)), fourPlus: stats(P(NS_4, xs)) }; })(),
  guard: strip(cv(nsRows, [fixed<Row>('current raise', 0, NS_APP), fixed<Row>('no raise', 0, NS_BASE), fixed<Row>('raise 1 at 4+ only', 1, NS_4)], NS_APP, APP_FOLDS)),
  crossGamma: fitted(nsRows, NS_APP, (r) => [-r.ns!.dX], APP_FOLDS),
  crossGammaOnBase: fitted(nsRows, NS_BASE, (r) => [-r.ns!.dX], APP_FOLDS),
  dXspread: { sd: r3(sdOf(nsRows.map((r) => r.ns!.dX))), nonzero: nsRows.filter((r) => Math.abs(r.ns!.dX) > 0.01).length },
};

// ---- A. Strength estimates: Epley, calibratedE1rm (the level), e1rmAdjusted, the level with a trend -------------------------
interface SRow { date: string; lift: string; reps: number; w: number; epleyLast: number | null; epley3: number | null; level: number | null; calibrated: number | null;
  adjMean: number | null; adjMax: number | null; trend: number | null; capBase: number | null; kappa: number | null; fat: number | null; habit: number | null }
const sRows: SRow[] = [];
for (const D of dates) {
  const core = coreOf.get(D);
  if (!core) continue;
  const before = logBefore(log, D) as SetEntry[];
  const byLift = new Map<string, Row[]>();
  for (const r of rows) if (r.date === D) byLift.set(r.key, [...(byLift.get(r.key) ?? []), r]);
  for (const [key, rs] of byLift) {
    const best = rs.reduce((x, y) => (epley(y.weight, y.reps) > epley(x.weight, x.reps) ? y : x));
    const L = best.lift;
    const s1 = sessionsFor(before, L).find((x) => x.sets.some(measured));
    const lastM = s1 ? s1.sets.filter(measured) : [];
    const adj = lastM.map((x) => e1rmAdjusted(core, x)).filter((x): x is number => x != null);
    const st = strengthOf(core, L, D);
    const b = st ? slopesFor(D, core).get(chosenTrend)!.get(key) ?? 0 : 0;
    sRows.push({ date: D, lift: L, reps: best.reps, w: best.weight, epleyLast: lastM.length ? Math.max(...lastM.map((x) => epley(x.weight, x.reps as number))) : null,
      epley3: priorE1rm(before, L, D), level: st?.e1rm ?? null, calibrated: calibratedE1rm(log, L, D), adjMean: adj.length ? mean(adj) : null, adjMax: adj.length ? Math.max(...adj) : null,
      trend: st ? st.e1rm * Math.exp(b * st.days) : null, capBase: best.cap ? best.cap.pred : null, kappa: st?.kappa ?? null, fat: best.cap ? tot(best.cap.now) : null, habit: best.cap?.habit ?? null });
  }
}
const sOk = sRows.filter((x) => x.epleyLast && x.epley3 && x.level && x.adjMean && x.kappa != null && x.fat != null);
const epleyReps = (E: number | null, x: SRow) => (E ? 30 * (E / x.w - 1) : null);
const coreReps = (E: number | null, x: SRow) => (E && x.kappa != null ? x.kappa * (E / x.w - 1) - x.fat! - x.habit! : null);
const S_METHODS: Record<string, (x: SRow) => number | null> = {
  epleyLast: (x) => epleyReps(x.epleyLast, x), epleyBestOf3: (x) => epleyReps(x.epley3, x), level: (x) => coreReps(x.level, x), calibratedE1rm: (x) => coreReps(x.calibrated, x),
  e1rmAdjustedMean: (x) => coreReps(x.adjMean, x), e1rmAdjustedMax: (x) => coreReps(x.adjMax, x), levelTrend: (x) => coreReps(x.trend, x),
};
/** Each estimator with its bias taken out (1 parameter: its mean miss), on train for held-out, and on the dates before walk-forward. */
const strengthOut = {
  n: sOk.length, calibratedEqualsLevel: sOk.filter((x) => Math.abs(x.calibrated! - x.level!) > 1e-6).length === 0,
  raw: Object.fromEntries(Object.entries(S_METHODS).map(([k, f]) => [k, stats(P(f, sOk))])),
  ...(() => {
    const deb = Object.fromEntries(Object.entries(S_METHODS).map(([k, f]) => [k, fitted(sOk, f, () => [1], FOLDS)]));
    const tested = sOk.filter((x) => deb.epleyLast.pred(x) != null);
    return { debiased: Object.fromEntries(Object.entries(deb).map(([k, v]) => [k, { cv: v.cv, bias: v.coefAll }])),
      vsEpleyCv: Object.fromEntries(Object.entries(deb).map(([k, v]) => [k, paired(tested, v.pred, deb.epleyLast.pred)])) };
  })(),
};

// ---- A. The rest knee with the τ grid extended past 600 s (the app's module, its grid alone changed, in a temp copy) ----------
const EXT_TAUS = [30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600];
async function extModules() {
  const learnDir = join(ROOT, 'src/domain/learn').replace(/\\/g, '/');
  const tmp = mkdtempSync(join(tmpdir(), 'gt-ext-')).replace(/\\/g, '/');
  const rewrite = (code: string) => code.replace(/from '(\.\.?\/[^']+)'/g, (m, rel: string) => (rel === './capacity' || rel === './index' ? m : `from '${resolve(learnDir, rel).replace(/\\/g, '/')}'`));
  const cap = rewrite(readFileSync(join(learnDir, 'capacity.ts'), 'utf8'));
  const grid = /export const TAUS = \[[^\]]*\] as const;/;
  if (!grid.test(cap)) throw new Error('capacity.ts: the TAUS line moved; update the extended-grid copy');
  writeFileSync(`${tmp}/capacity.ts`, cap.replace(grid, `export const TAUS = [${EXT_TAUS.join(', ')}] as const;`));
  writeFileSync(`${tmp}/index.ts`, `import { perLog, learnable } from '${ROOT.replace(/\\/g, '/')}/src/domain/stats';\nimport { fitCore } from './capacity';\n`
    + `export { logBefore } from '${learnDir}/index';\nexport const learn = perLog((log) => ({ core: fitCore(learnable(log)), pace: null }));\n`);
  writeFileSync(`${tmp}/rest.ts`, rewrite(readFileSync(join(learnDir, 'rest.ts'), 'utf8')));
  const jiti = createJiti(import.meta.url);
  const rest = await jiti.import(`${tmp}/rest.ts`) as typeof import('../src/domain/learn/rest');
  const idx = await jiti.import(`${tmp}/index.ts`) as { learn: (e: readonly SetEntry[]) => { core: Core } };
  return { rest, learn: idx.learn };
}
const tauSummary = (c: Core | null) => c && { tau: { mean: r2(c.tau.mean), lo: c.tau.lo, hi: c.tau.hi }, rho: r3(c.rho.mean), aSame: r3(c.aSame.mean), aCross: r3(c.aCross.mean), gamma: r3(c.gamma.mean),
  restTau: (() => { const w = new Map<number, number>(); for (const x of c.rest.cells) w.set(x.tau, (w.get(x.tau) ?? 0) + x.w); return Object.fromEntries([...w].filter(([, v]) => v > 0.005).map(([k, v]) => [k, r3(v)])); })() };

// ---- F. What a minute of rest costs: straight-set pairs at the same weight, app era --------------------------------------------
interface RestPair { date: string; lift: string; iso: boolean; rest: number; drop: number; k: number; rir: number | null; a: SetEntry; dayAll: SetEntry[]; before: SetEntry[] }
const restPairs: RestPair[] = [];
for (const D of appDates) {
  const before = logBefore(log, D) as SetEntry[];
  const dayAll = log.filter((e) => e.date === D);
  const day = dayAll.filter((e) => e.loggedAt && isWorking(e) && !cardio(e)).sort(byOrderDone);
  const count = new Map<string, number>();
  for (let i = 0; i + 1 < day.length; i++) {
    const a = day[i], b = day[i + 1], ka = liftKey(a.exercise);
    count.set(ka, (count.get(ka) ?? 0) + (a.flags.includes('warmup') ? 0 : 1));
    if (ka !== liftKey(b.exercise) || a.flags.includes('warmup') || a.enteredAt || b.enteredAt || a.weight !== b.weight) continue;
    const g = (doneAt(b) - doneAt(a)) / 1000;
    if (!(g > 0) || g > 900) continue;
    restPairs.push({ date: D, lift: a.exercise, iso: isIsolation(a.exercise), rest: Math.max(0, g - SET_WORK), drop: (a.reps as number) - (b.reps as number), k: count.get(ka)!, rir: a.rir ?? null, a, dayAll, before });
  }
}
function restCost(xs: RestPair[]) {
  const lin = creg(xs.map((x) => [x.rest / 60, x.k]), xs.map((x) => x.drop), xs.map((x) => x.date), ['restMin', 'setNumber']);
  const lg = creg(xs.map((x) => [Math.log(Math.max(30, x.rest)), x.k]), xs.map((x) => x.drop), xs.map((x) => x.date), ['lnRest', 'setNumber']);
  const c = lin?.coef.restMin;
  return { n: xs.length, days: new Set(xs.map((x) => x.date)).size, medianRest: r2(median(xs.map((x) => x.rest))), p10: r2(quant(xs.map((x) => x.rest), 0.1)), p90: r2(quant(xs.map((x) => x.rest), 0.9)),
    meanDrop: r3(mean(xs.map((x) => x.drop))),
    // reps lost per minute of rest cut = −(the slope of the drop on rest); its 95 % interval
    perMinuteCut: c ? { est: r3(-c.b), lo: r3(-c.b - 1.96 * c.se), hi: r3(-c.b + 1.96 * c.se), se: r3(c.se) } : null,
    perLnRest: lg ? { est: r3(-lg.coef.lnRest.b), se: r3(lg.coef.lnRest.se) } : null, setNumber: lin ? { b: r3(lin.coef.setNumber.b), se: r3(lin.coef.setNumber.se) } : null };
}

// ---- How much a random split of days flatters: the capacity model fitted on a random 70 % of days (the future included) and
// scored on the other 30 %, against the same model fitted on the past only (as every other number here), on the same sets.
function randomSplit(seeds = 5) {
  const runs: any[] = [];
  const rateCv = cv(atRule, [rateCand(5, false)], RULE, FOLDS);
  // Seed 0 is a check of this instrument, not a split: every day in the fit, the test day too (should land near round 1's 1.53).
  for (let s = 0; s <= seeds; s++) {
    let x = (s * 2654435761) >>> 0;
    const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
    const ds = [...dates];
    for (let i = ds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ds[i], ds[j]] = [ds[j], ds[i]]; }
    const trainDays = new Set(s === 0 ? ds : ds.slice(0, Math.round(TRAIN_SHARE * ds.length)));
    const core = coreBefore(log.filter((e) => trainDays.has(e.date)), '9999-12-31');
    if (!core) continue;
    const test = s === 0 ? capRows : capRows.filter((r) => !trainDays.has(r.date));
    const pred = new Map<Row, number>();
    for (const r of test) {
      const l = core.lifts.get(r.key);
      if (!l || l.unit !== 'lb' || !l.level.length) continue;
      const day = dayOf(r.date), lv = l.level;
      const j = lv.findIndex((p) => p.day > day);
      const xl = j < 0 ? lv.at(-1)!.x : j === 0 ? lv[0].x : lv[j - 1].x + (lv[j].x - lv[j - 1].x) * (day - lv[j - 1].day) / (lv[j].day - lv[j - 1].day);
      const h = dayHard(r.date, core.gap), a = h.hard.indexOf(r.e);
      if (a < 0) continue;
      pred.set(r, l.kappa.mean * (Math.exp(xl) / r.weight - 1) - tot(termsOf(core, r.key, featuresOf(h.hard, a, h.t))) - core.habit.mean);
    }
    const xs = test.filter((r) => pred.has(r));
    // The same for a learned per-lift gain (k = 5, unrounded): learned from random days, against learned from the past (CV).
    const rTrain = atRule.filter((r) => trainDays.has(r.date)), rTest = atRule.filter((r) => !trainDays.has(r.date) && rateCv.pred(r) != null);
    const rp = rateCand(5, false).fit(rTrain);
    const gain = s === 0 ? null : { n: rTest.length, random: r3(maeOn(rTest, rp)), pastOnly: r3(maeOn(rTest, rateCv.pred)), rule: r3(maeOn(rTest, RULE)), randomVsPast: paired(rTest, rp, rateCv.pred) };
    runs.push({ seed: s, n: xs.length, gain, random: stats(P((r: Row) => pred.get(r), xs)).mae, pastOnly: stats(P((r: Row) => r.cap?.pred, xs)).mae, rule: stats(P(RULE, xs)).mae,
      randomVsRule: paired(xs, (r) => pred.get(r), RULE), pastVsRule: paired(xs, (r) => r.cap?.pred, RULE) });
  }
  const m = (k: 'random' | 'pastOnly' | 'rule') => r3(mean(runs.filter((x) => x.seed > 0).map((x) => x[k] as number)));
  const gm = (k: 'random' | 'pastOnly' | 'rule') => r3(mean(runs.flatMap((x) => (x.gain ? [x.gain[k] as number] : []))));
  return { runs, mean: { random: m('random'), pastOnly: m('pastOnly'), rule: m('rule') }, gainMean: { random: gm('random'), pastOnly: gm('pastOnly'), rule: gm('rule') },
    inSample: runs.find((x) => x.seed === 0)?.random ?? null };
}

// ---- 5. Set time: what a switch gap (A's done-time to B's, an alternating pair) is made of, and straight-set gaps as a check -----
interface GapRow { date: string; reps: number; gap: number; x: Record<string, number>; alt: boolean }
const GAP_X = ['partnerReps', 'rir', 'loadPct', 'setNumber', 'prevReps', 'sinceOwn'] as const;
const gapRows: GapRow[] = [];
for (const D of appDates) {
  const core = coreOf.get(D);
  const day = log.filter((e) => e.date === D && e.loggedAt && isWorking(e) && !cardio(e) && !e.flags.includes('hold') && !isHold(e.exercise)).sort(byOrderDone);
  const seen = new Map<string, SetEntry[]>();
  for (let i = 0; i < day.length; i++) {
    const b = day[i], kb = liftKey(b.exercise), own = seen.get(kb) ?? [];
    seen.set(kb, [...own, b]);
    if (i === 0) continue;
    const a = day[i - 1], ka = liftKey(a.exercise);
    const g = (doneAt(b) - doneAt(a)) / 1000;
    if (!(g > 0) || g > 900 || a.enteredAt || b.enteredAt || b.flags.includes('warmup')) continue;
    const alt = ka !== kb && ((day[i + 1] && liftKey(day[i + 1].exercise) === ka) || (i > 1 && liftKey(day[i - 2].exercise) === kb));
    const straight = ka === kb && !a.flags.includes('warmup');
    if (!alt && !straight) continue;
    const s = core ? strengthOf(core, b.exercise, D) : null;
    const e1 = s?.e1rm ?? priorE1rm(logBefore(log, D) as SetEntry[], b.exercise, D);
    const lastOwn = own.at(-1);
    gapRows.push({ date: D, reps: g, gap: g, alt, x: { partnerReps: b.reps as number, rir: b.rir ?? 2, loadPct: e1 && b.weight > 0 ? 100 * b.weight / e1 : 70, setNumber: own.length + 1,
      prevReps: a.reps as number, sinceOwn: lastOwn ? Math.min(900, (doneAt(b) - doneAt(lastOwn)) / 1000) : 0 } });
  }
}
/** (c) Prior: a set takes 40 s, about 4 s a rep (timing.SET_WORK, its per-rep reading); SDs only shape the shrinkage. */
const GAP_PRIOR: Record<string, { mu: number; sd: number }> = { partnerReps: { mu: 4, sd: 2 }, rir: { mu: 0, sd: 5 }, loadPct: { mu: 0, sd: 1 }, setNumber: { mu: 0, sd: 5 }, prevReps: { mu: 0, sd: 2 }, sinceOwn: { mu: 0, sd: 0.1 } };
/** Huber regression (IRLS, c = 1.345 MADs) with a ridge toward the prior on every slope; the intercept is free. */
function huber(xs: GapRow[], names: readonly string[]) {
  const n = xs.length, p = names.length + 1;
  if (n < p + 2) return null;
  const X = xs.map((r) => [1, ...names.map((k) => r.x[k])]), y = xs.map((r) => r.gap);
  let w = new Array(n).fill(1), beta = new Array(p).fill(0), s2 = 100 ** 2;
  for (let it = 0; it < 30; it++) {
    const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) { b[j] += w[i] * X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += w[i] * X[i][j] * X[i][k]; }
    names.forEach((k, j) => { const pr = GAP_PRIOR[k]; const lam = s2 / pr.sd ** 2; A[j + 1][j + 1] += lam; b[j + 1] += lam * pr.mu; });
    const inv = invert(A);
    if (!inv) return null;
    beta = inv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
    const res = y.map((v, i) => v - X[i].reduce((s, x, j) => s + x * beta[j], 0));
    const mad = median(res.map((v) => Math.abs(v - median(res)))) / 0.6745 || 1;
    s2 = mad * mad;
    w = res.map((v) => Math.min(1, (1.345 * mad) / Math.max(1e-9, Math.abs(v))));
  }
  return { coef: Object.fromEntries(['intercept', ...names].map((k, j) => [k, beta[j]])), predict: (r: GapRow) => beta[0] + names.reduce((s, k, j) => s + beta[j + 1] * r.x[k], 0) };
}
/** A fixed set time: the gap's robust location (median) of what's left after it, plus the set. */
const fixedSet = (set: (r: GapRow) => number): Cand<GapRow> => ({ name: '', params: 1, fit: (train) => { const a = train.length ? median(train.map((r) => r.gap - set(r))) : 60; return (r) => a + set(r); } });
function setTimeOut() {
  const out: Record<string, unknown> = {};
  for (const [label, keep] of [['alternating, all ≤ 10 min', (r: GapRow) => r.alt && r.gap <= 600], ['alternating, ≤ 6 min (probable supersets)', (r: GapRow) => r.alt && r.gap <= 360]] as const) {
    const xs = gapRows.filter(keep);
    const ds = [...new Set(xs.map((r) => r.date))].sort();
    // One block a day, trained on the days before it (no gap: a set's time doesn't carry a strength level into the fit).
    const folds = ds.slice(1).map((d) => ({ start: d, end: d, trainBefore: d }));
    const fits = (names: readonly string[]): Cand<GapRow> => ({ name: names.join(' + '), params: names.length + 1, fit: (train) => { const h = huber(train, names); return (r) => (h ? h.predict(r) : null); } });
    const cands = [{ ...fixedSet(() => SET_WORK), name: 'fixed 40 s' }, { ...fixedSet((r) => 4 * r.x.partnerReps), name: '4 s a rep' }, fits(['partnerReps']), fits(['partnerReps', 'rir']),
      fits(['partnerReps', 'loadPct']), fits(['partnerReps', 'setNumber', 'prevReps']), fits(['partnerReps', 'sinceOwn']), fits(GAP_X)];
    const preds = cands.map((c) => cv(xs, [c], () => null, folds).pred);
    const tested = xs.filter((r) => preds[0](r) != null);
    const whole = huber(xs, GAP_X), only = huber(xs, ['partnerReps']);
    const ols = creg(xs.map((r) => [r.x.partnerReps]), xs.map((r) => r.gap), xs.map((r) => r.date), ['partnerReps']);
    out[label] = { n: xs.length, days: ds.length, tested: tested.length,
      table: cands.map((c, i) => ({ name: c.name, params: c.params, ...stats(P(preds[i], tested)), medianAE: r2(median(tested.map((r) => Math.abs((preds[i](r) ?? NaN) - r.gap)).filter(Number.isFinite))),
        vsFixed40: paired(tested, preds[i], preds[0]), vsPerRep: paired(tested, preds[i], preds[1]) })),
      coefAll: whole && Object.fromEntries(Object.entries(whole.coef).map(([k, v]) => [k, r2(v)])), repsOnly: only && r2(only.coef.partnerReps),
      olsSlope: ols && { b: r2(ols.coef.partnerReps.b), se: r2(ols.coef.partnerReps.se), G: ols.G },
      // Days of supersets for a 95 % interval of ±1 s/rep (SE 0.51): the clustered SE falls as 1/√days.
      daysForPm1: ols ? Math.ceil(ols.G * (ols.coef.partnerReps.se / 0.51) ** 2) : null };
  }
  const st = gapRows.filter((r) => !r.alt && r.gap <= 900);
  const sOls = creg(st.map((r) => [r.x.partnerReps, r.x.setNumber]), st.map((r) => r.gap), st.map((r) => r.date), ['partnerReps', 'setNumber']);
  const sHub = huber(st, ['partnerReps', 'setNumber']);
  out.straight = { n: st.length, days: new Set(st.map((r) => r.date)).size, ols: sOls && { b: r2(sOls.coef.partnerReps.b), se: r2(sOls.coef.partnerReps.se) }, huber: sHub && r2(sHub.coef.partnerReps),
    daysForPm1: sOls ? Math.ceil(sOls.G * (sOls.coef.partnerReps.se / 0.51) ** 2) : null };
  out.points = gapRows.filter((r) => r.alt && r.gap <= 600).map((r) => [r.x.partnerReps, Math.round(r.gap)]);
  return out;
}

// ---- C. Readiness: the input's spread, the effect it could detect, a crude recovery proxy, energy --------------------------------
interface RRow { date: string; lift: string; pFull: number; resid: number; ruleResid: number | null; since: number | null; recent: number; iso: boolean }
const rRows: RRow[] = [];
for (const D of dates) {
  const firsts = rows.filter((r) => r.date === D && r.k === 0 && r.cap);
  if (!firsts.length) continue;
  const before = logBefore(log, D) as SetEntry[];
  let m;
  try { m = readinessModel(before, body, D, TZ); } catch { continue; }
  const sr = m.sessionReady(firsts.map((r) => ({ exercise: r.lift, sets: 1, repMin: 8, repMax: 12 })), D);
  const recentSets = before.filter((e) => e.date >= addDays(D, -3) && isHard(e));
  for (const r of firsts) {
    const l = sr.lifts.find((x) => x.exercise === r.lift);
    if (!l) continue;
    const prevS = sessionsFor(before, r.lift)[0];
    const v = resolveLift(r.lift).m;
    rRows.push({ date: D, lift: r.lift, pFull: l.pFull, resid: r.reps - r.cap!.pred, ruleResid: r.rule == null ? null : r.reps - r.rule, since: prevS ? dayOf(D) - dayOf(prevS.date) : null,
      recent: recentSets.reduce((s, e) => s + overlap(resolveLift(e.exercise).m, v), 0), iso: r.iso });
  }
}
function readinessOut() {
  // The outcome: the first set's reps less the current rule's target (its miss has an SD near 2 reps; the core's own miss is heavy-
  // tailed, a few sets at light weights 20+ reps out, which would swamp any effect). Sets the rule aimed at another weight are left out.
  const all = rRows;
  const rr = rRows.filter((x) => x.ruleResid != null);
  const p = rr.map((x) => x.pFull), y = rr.map((x) => x.ruleResid!);
  const fit = creg(rr.map((x) => [x.pFull]), y, rr.map((x) => x.date), ['pFull']);
  const fitCore = creg(all.map((x) => [x.pFull]), all.map((x) => x.resid), all.map((x) => x.date), ['pFull']);
  const se = fit?.coef.pFull.se ?? NaN;
  const spread = quant(p, 0.95) - quant(p, 0.05);
  const G = new Set(rr.map((x) => x.date)).size;
  // 80 % power at two-sided 5 %: the true slope must be 2.80 SEs from 0 (z 1.96 + 0.84).
  const px = rr.filter((x) => x.since != null);
  const proxy = creg(px.map((x) => [Math.min(14, x.since!), x.recent]), px.map((x) => x.ruleResid!), px.map((x) => x.date), ['daysSinceLift', 'muscleSetsLast3d']);
  // Energy: each session's mean first-set residual against its logged energy (1–5).
  const eOf = new Map(body.filter((d) => d.energy != null).map((d) => [d.date, d.energy as number]));
  const sess = [...new Set(rr.map((x) => x.date))].filter((d) => eOf.has(d)).map((d) => ({ d, e: eOf.get(d)!, r: mean(rr.filter((x) => x.date === d).map((x) => x.ruleResid!)), n: rr.filter((x) => x.date === d).length }));
  const eFit = sess.length >= 4 ? creg(sess.map((s) => [s.e]), sess.map((s) => s.r), sess.map((s) => s.d), ['energy']) : null;
  const lastCore = coreBefore(log, addDays(dates.at(-1)!, 1));
  const appEnergy = lastCore ? energyFit(sessionResiduals(lastCore, addDays(dates.at(-1)!, 1)), body, addDays(dates.at(-1)!, 1)) : null;
  return {
    n: rr.length, days: G, allLiftSessions: all.length, coreResid: fitCore && { slope: r3(fitCore.coef.pFull.b), se: r3(fitCore.coef.pFull.se), residSd: r3(sdOf(all.map((x) => x.resid))) },
    pFull: { min: r3(Math.min(...p)), p5: r3(quant(p, 0.05)), p25: r3(quant(p, 0.25)), median: r3(median(p)), p75: r3(quant(p, 0.75)), p95: r3(quant(p, 0.95)), max: r3(Math.max(...p)),
      sd: r3(sdOf(p)), under90: p.filter((x) => x < 0.9).length, under50: p.filter((x) => x < 0.5).length },
    residSd: r3(sdOf(y)),
    fit: fit && { slope: r3(fit.coef.pFull.b), se: r3(se), r: r3(((): number => { const mp = mean(p), my = mean(y); let sxy = 0, sxx = 0, syy = 0; p.forEach((v, i) => { sxy += (v - mp) * (y[i] - my); sxx += (v - mp) ** 2; syy += (y[i] - my) ** 2; }); return sxy / Math.sqrt(sxx * syy); })()) },
    mde: { slope: r3(2.8 * se), acrossP5toP95: r3(2.8 * se * spread), across90to100: r3(2.8 * se * 0.1), rClustered: r3(2.8 / Math.sqrt(Math.max(1, G - 2))), rIfIndependent: r3(2.8 / Math.sqrt(rr.length - 3)) },
    lowVsHigh: (() => { const lo = rr.filter((x) => x.pFull < 0.9), hi = rr.filter((x) => x.pFull >= 0.9); return { nLow: lo.length, low: r3(mean(lo.map((x) => x.ruleResid!))), high: r3(mean(hi.map((x) => x.ruleResid!))) }; })(),
    // The effect the model itself claims: a lift short of full strength is short by at least a day's readiness, 3 % of e1RM, which
    // at ~10 reps is ~1.2 reps; so (1 − pFull) × 1.2 is the least loss it implies.
    implied: (() => { const l = rr.map((x) => (1 - x.pFull) * 1.2); return { mean: r3(mean(l)), sd: r3(sdOf(l)), p95: r3(quant(l, 0.95)), max: r3(Math.max(...l)) }; })(),
    proxy: proxy && { n: proxy.n, G: proxy.G, daysSinceLift: { b: r3(proxy.coef.daysSinceLift.b), se: r3(proxy.coef.daysSinceLift.se) }, muscleSetsLast3d: { b: r3(proxy.coef.muscleSetsLast3d.b), se: r3(proxy.coef.muscleSetsLast3d.se) },
      spread: { since: { p5: quant(px.map((x) => Math.min(14, x.since!)), 0.05), p95: quant(px.map((x) => Math.min(14, x.since!)), 0.95) },
        recent: { p5: r2(quant(px.map((x) => x.recent), 0.05)), p95: r2(quant(px.map((x) => x.recent), 0.95)) } } },
    energy: { days: sess.length, values: sess.map((s) => [s.e, r2(s.r), s.n]), fit: eFit && { slope: r3(eFit.coef.energy.b), se: r3(eFit.coef.energy.se), mde: r3(2.8 * eFit.coef.energy.se) },
      app: appEnergy && { status: appEnergy.status, n: appEnergy.n, usual: appEnergy.usual, slope: appEnergy.slope && { mean: r3(appEnergy.slope.mean), sd: r3(appEnergy.slope.sd) }, ci: appEnergy.ci?.map((v) => r3(v)) } },
  };
}

// ---- A. Session length: learn/pace (the dead person-level pace) against learn/session ---------------------------------------
function sessionsOut() {
  const out: { date: string; actual: number; session: number | null; pace: number | null; usual: number }[] = [];
  for (const D of appDates) {
    const actual = sessionMinutes(log as SetEntry[], D);
    if (actual == null) continue;
    const day = log.filter((e) => e.date === D).sort(byOrderDone);
    const steps: Step[] = day.filter((e) => isWorking(e) || e.flags.includes('warmup') || cardio(e)).map((e) => (cardio(e) && e.cardio ? { exercise: e.exercise, seconds: e.cardio.seconds } : { exercise: e.exercise, ...(e.flags.includes('warmup') && { warmup: true }) }));
    const fit = paceBefore(log, D);
    const f = fit ? fit.forecast(steps, { date: D }) : null;
    const before = logBefore(log, D) as SetEntry[];
    const pace = paceOf(before), model = gapModel(log, D);
    let pSec: number | null = null;
    if (pace && f) {
      // Duan's smearing: a sum of gaps is predicted by the mean gap, exp(σ²/2) above the median pace gives.
      const smear = Math.exp(pace.logSd ** 2 / 2);
      pSec = SET_WORK;
      for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1], b = steps[i];
        if (b.seconds != null) { pSec += b.seconds + 120; continue; }
        pSec += liftKey(a.exercise) === liftKey(b.exercise) ? pace.lift(a.exercise).gap * smear : model.switchSeconds(a.exercise, b.exercise, {});
      }
    }
    out.push({ date: D, actual, session: f ? Math.round(f.seconds / 60) : null, pace: pSec != null ? Math.round(pSec / 60) : null, usual: usualMinutes(log as SetEntry[], D) });
  }
  const ok = out.filter((x) => x.session != null && x.pace != null);
  const pr = (f: (x: typeof ok[0]) => number) => stats(ok.map((x) => ({ p: f(x), a: x.actual })));
  const diffs = ok.map((x) => Math.abs(x.pace! - x.actual) - Math.abs(x.session! - x.actual));
  return { n: ok.length, session: pr((x) => x.session!), pace: pr((x) => x.pace!), usual: pr((x) => x.usual), paceMinusSession: { diff: r2(mean(diffs)), se: r2(sdOf(diffs) / Math.sqrt(diffs.length)) }, days: out };
}

// ---- E. Expected against actual strength, per main lift ---------------------------------------------------------------------
/** Latella 2023 (Sports Med 54:753): ~7.5–12.5 % in a lifter's first competitive year, ~20 % after 10; a linear-log curve through 10 % and 20 %. */
const LIT = { a: 0.1 / Math.log(9), t0: 0.125 };
const litAt = (years: number, firstYear = 0.1) => (firstYear / 0.1) * LIT.a * Math.log(1 + years / LIT.t0);
const GROWTH_RATES: { key: string; lift: string; n: number; pctWeek: number | null; se: number | null }[] = [];
function growthOut() {
  const sessionsBy = new Map<string, { date: string; e: number; lift: string }[]>();
  for (const D of dates) {
    const byLift = new Map<string, SetEntry[]>();
    for (const e of log) if (e.date === D && measured(e)) byLift.set(liftKey(e.exercise), [...(byLift.get(liftKey(e.exercise)) ?? []), e]);
    for (const [key, xs] of byLift) sessionsBy.set(key, [...(sessionsBy.get(key) ?? []), { date: D, e: Math.max(...xs.map((x) => epley(x.weight, x.reps as number))), lift: xs[0].exercise }]);
  }
  const rates = [...sessionsBy].filter(([, xs]) => xs.length >= 8).map(([key, xs]) => { const d0 = dayOf(xs[0].date); const f = creg(xs.map((x) => [dayOf(x.date) - d0]), xs.map((x) => Math.log(x.e)), xs.map((x) => x.date), ['day']); return { key, lift: xs.at(-1)!.lift, n: xs.length, pctWeek: f ? r3(100 * 7 * f.coef.day.b) : null, se: f ? r3(100 * 7 * f.coef.day.se) : null }; });
  GROWTH_RATES.push(...rates);
  const top = [...sessionsBy].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  return top.map(([key, xs]) => {
    const d0 = dayOf(xs[0].date);
    const fit = creg(xs.map((x) => [dayOf(x.date) - d0]), xs.map((x) => Math.log(x.e)), xs.map((x) => x.date), ['day']);
    const a = fit!.coef.intercept.b, b = fit!.coef.day.b;
    // The rule's own path: from the first session, each later session's targets met exactly (their implied e1RM change, compounded).
    const ts = tgts.filter((T) => T.key === key);
    let ruleE = xs[0].e;
    const rule = xs.map((x, i) => { if (i > 0) { const T = ts.find((t) => t.date === x.date); const aim = T ? tAim(T, CURRENT) : null; const dd = T && aim ? impliedOf(T, aim) : null; if (dd != null && Number.isFinite(dd)) ruleE *= 1 + dd; } return [x.date, r2(ruleE)]; });
    const e0 = Math.exp(a);
    const lit = xs.map((x) => { const yrs = (dayOf(x.date) - d0) / 365.25; return [x.date, r2(e0 * (1 + litAt(yrs, 0.075))), r2(e0 * (1 + litAt(yrs, 0.125)))]; });
    const weeks = (dayOf(xs.at(-1)!.date) - d0) / 7;
    return { key, lift: xs.at(-1)!.lift, sessions: xs.length, from: xs[0].date, to: xs.at(-1)!.date, actual: xs.map((x) => [x.date, r2(x.e)]),
      fit: { pctWeek: r3(100 * 7 * b), se: r3(100 * 7 * fit!.coef.day.se), start: r2(e0), end: r2(Math.exp(a + b * (dayOf(xs.at(-1)!.date) - d0))) },
      totalPct: r2(100 * (Math.exp(b * (dayOf(xs.at(-1)!.date) - d0)) - 1)), weeks: r2(weeks), rule, lit,
      litTotalPct: [r2(100 * litAt((dayOf(xs.at(-1)!.date) - d0) / 365.25, 0.075)), r2(100 * litAt((dayOf(xs.at(-1)!.date) - d0) / 365.25, 0.125))],
      rulePct: r2(100 * (ruleE / xs[0].e - 1)) };
  });
}

async function main() {
  // A. The extended τ grid: the whole log's fit, and walk-forward over the app days (the knee, and the core's own per-set error).
  const ext = await extModules();
  const extWhole = ext.learn(log).core;
  const stdWhole = coreBefore(log, '9999-12-31');
  const kneeRows: { date: string; std: { use: boolean; mid: number } | null; ext: { use: boolean; mid: number; lo: number; hi: number; tight: boolean; tried: boolean } | null; gap: number; prescribedStd: number; prescribedExt: number }[] = [];
  for (const p of restPairs) {
    const all = [...p.before, ...p.dayAll];
    const ks = kneeAfter(all, p.a), ke = ext.rest.kneeAfter(all, p.a);
    kneeRows.push({ date: p.date, std: ks && { use: ks.use, mid: ks.mid }, ext: ke && { use: ke.use, mid: ke.mid, lo: ke.lo, hi: ke.hi, tight: ke.tight, tried: ke.tried }, gap: p.rest + SET_WORK,
      prescribedStd: restFor(p.a, { knee: ks }).seconds, prescribedExt: restFor(p.a, { knee: ke }).seconds });
  }
  // The core's per-set prediction with the extended grid, walk-forward on every date (its own fatigue features at its own τ).
  const extCoreOf = new Map<string, Core | null>();
  for (const D of dates) { const b = logBefore(log, D); try { extCoreOf.set(D, b.length ? ext.learn(b).core : null); } catch { extCoreOf.set(D, null); } }
  for (const r of capRows) {
    const c = extCoreOf.get(r.date), s = c ? strengthOf(c, r.lift, r.date) : null;
    if (!c || !s) continue;
    const h = dayHard(r.date, coreOf.get(r.date)!.gap), a = h.hard.indexOf(r.e);
    const hh = a >= 0 ? h : dayHard(r.date, c.gap), aa = hh.hard.indexOf(r.e);
    if (aa < 0) continue;
    r.ext = s.kappa * (s.e1rm / r.weight - 1) - tot(termsOf(c, r.key, featuresOf(hh.hard, aa, hh.t, EXT_TAUS))) - c.habit.mean;
  }
  const extRows = capRows.filter((r) => r.ext != null);
  const knees = kneeRows.filter((k) => k.ext);
  // What the extended fit says a minute of rest is worth, at his median rest: one same-lift set just done, (1 − ρ)·A·e^(−(t + w)/τ)/τ.
  const perMin = (c: Core, t: number) => (1 - c.fit.rho) * c.fit.theta[0] * Math.exp(-(t + SET_WORK) / c.fit.tau) / c.fit.tau * 60;
  const tauOut = {
    grid: EXT_TAUS, std: tauSummary(stdWhole), ext: tauSummary(extWhole),
    extFitTau: extWhole.fit.tau, stdFitTau: stdWhole?.fit.tau,
    knee: { n: knees.length, useStd: kneeRows.filter((k) => k.std?.use).length, useExt: knees.filter((k) => k.ext!.use).length, tightExt: knees.filter((k) => k.ext!.tight).length, triedExt: knees.filter((k) => k.ext!.tried).length,
      midExt: r2(median(knees.map((k) => k.ext!.mid))), loExt: r2(median(knees.map((k) => k.ext!.lo))), hiExt: r2(median(knees.map((k) => k.ext!.hi))), midStd: r2(median(kneeRows.filter((k) => k.std).map((k) => k.std!.mid))),
      prescribedStd: r2(median(kneeRows.map((k) => k.prescribedStd))), prescribedExt: r2(median(kneeRows.map((k) => k.prescribedExt))), gap: r2(median(kneeRows.map((k) => k.gap))) },
    perSet: { n: extRows.length, std: stats(P((r: Row) => r.cap?.pred, extRows)), ext: stats(P((r: Row) => r.ext, extRows)), rule: stats(P(RULE, extRows)),
      extVsStdHeld: paired(extRows.filter((r) => r.date >= heldFrom), (r) => r.ext, (r) => r.cap?.pred), extVsStdAll: paired(extRows, (r) => r.ext, (r) => r.cap?.pred) },
    perMinuteAtMedian: { std: stdWhole ? r3(perMin(stdWhole, median(restPairs.map((p) => p.rest)))) : null, ext: r3(perMin(extWhole, median(restPairs.map((p) => p.rest)))) },
  };

  // F. Rest cost, per class, and a rule.
  const restAll = restCost(restPairs), restIso = restCost(restPairs.filter((x) => x.iso)), restComp = restCost(restPairs.filter((x) => !x.iso));
  const perDay = appDates.map((d) => ({ d, iso: restPairs.filter((x) => x.date === d && x.iso).length, comp: restPairs.filter((x) => x.date === d && !x.iso).length }));
  const allStraight = appDates.map((d) => { const day = log.filter((e) => e.date === d && e.loggedAt && isWorking(e) && !cardio(e)).sort(byOrderDone); let n = 0; for (let i = 0; i + 1 < day.length; i++) if (liftKey(day[i].exercise) === liftKey(day[i + 1].exercise) && !day[i].flags.includes('warmup')) n++; return n; });
  const byLift = [...new Set(restPairs.map((x) => liftKey(x.lift)))].map((k) => { const xs = restPairs.filter((x) => liftKey(x.lift) === k); return { lift: xs.at(-1)!.lift, iso: xs[0].iso, n: xs.length, median: r2(median(xs.map((x) => x.rest))), saved: saved.get(k)?.rest ?? null }; }).sort((a, b) => b.n - a.n);
  /** Cut from his median until 30 s more cut would cost, at the interval's upper end, more than the rounding error of a rep (1/√12) per set, floored. */
  const propose = (c: ReturnType<typeof restCost>, floor: number, restsPerSession: number) => {
    const hi = Math.max(c.perMinuteCut?.hi ?? 0, 0.05), est = c.perMinuteCut?.est ?? 0;
    const cutMin = Math.min((c.medianRest! - floor) / 60, (1 / Math.sqrt(12)) / hi);
    const to = Math.round((c.medianRest! - cutMin * 60) / 15) * 15;
    const cut = (c.medianRest! - to) / 60;
    return { from: c.medianRest, to, cutMin: r2(cut), floor, restsPerSession, minutesSaved: r2(cut * restsPerSession),
      repsLostPerSet: { est: r3(est * cut), hi: r3((c.perMinuteCut?.hi ?? 0) * cut), lo: r3((c.perMinuteCut?.lo ?? 0) * cut) },
      repsLostPerSession: { est: r3(est * cut * restsPerSession), hi: r3((c.perMinuteCut?.hi ?? 0) * cut * restsPerSession), lo: r3((c.perMinuteCut?.lo ?? 0) * cut * restsPerSession) } };
  };
  const restOut = { all: restAll, iso: restIso, compound: restComp, byLift,
    perSession: { straightRests: median(allStraight), iso: median(perDay.map((x) => x.iso)), comp: median(perDay.map((x) => x.comp)), meanIso: r2(mean(perDay.map((x) => x.iso))), meanComp: r2(mean(perDay.map((x) => x.comp))) },
    proposal: { iso: propose(restIso, 90, mean(perDay.map((x) => x.iso))), compound: propose(restComp, 150, mean(perDay.map((x) => x.comp))) },
    points: restPairs.map((x) => [Math.round(x.rest), x.drop, x.iso ? 1 : 0]),
    literature: { rahimi2005: { set2: { '1': 4.8, '2': 5.4, '5': 6.7 }, set3: { '1': 3.5, '2': 4.45, '5': 6.0 }, set4: { '1': 2.2, '2': 3.2, '5': 4.65 }, load: '85 % 1RM squat' } } };

  const out = { generated: new Date().toISOString(), split, data: { sets: raw.length, dates: dates.length, appDays: appDates.length, energyDays: body.filter((d) => d.energy != null).length,
    painSeverity: log.filter((e) => e.painSeverity != null).length, enteredLate: log.filter((e) => e.enteredAt).length, savedSettings: saved.size },
    folds: { all: FOLDS, app: APP_FOLDS }, randomSplit: randomSplit(), rate: rateOut, setTime: setTimeOut(),
    progression: progressionOut, stack: stackOut, away: awayOutOf(), growthRates: GROWTH_RATES, nextSet: nextSetOut, strength: strengthOut, tau: tauOut, rest: restOut, readiness: readinessOut(), sessions: sessionsOut(), growth: growthOut() };
  const o = opt('--out');
  if (o) writeFileSync(o, JSON.stringify(out, null, 1));
  const g = (x: { picks: Record<string, number>; cv: { mae: number | null; base: { mae: number | null }; vsBase: { diff: number | null; se: number | null; n?: number } } }) => `${JSON.stringify(x.picks)}: CV ${x.cv.mae} vs rule ${x.cv.base.mae} (${x.cv.vsBase.diff} ± ${x.cv.vsBase.se}, n ${x.cv.vsBase.n})`;
  console.log(`${raw.length} sets, ${dates.length} days; folds`, JSON.stringify(FOLDS), JSON.stringify(APP_FOLDS));
  console.log('random split:', JSON.stringify(out.randomSplit.mean));
  console.log('replay of the rule:', progressionOut.replay, 'shown targets:', progressionOut.shown);
  console.log('D RIR variants:', g(progressionOut.rirGuard));
  console.log('D no-RIR variants:', g(progressionOut.noRirGuard));
  console.log('D rate all:', g(rateOut.all), 'app:', g(rateOut.app), 'k', rateOut.k, JSON.stringify(rateOut.gains).slice(0, 200));
  console.log('B capacity + trend:', g(stackOut.capTrend));
  console.log('B rule + c·dFat:', stackOut.ruleFat.coefAll, g(stackOut.ruleFat));
  console.log('B rule + c·trend:', stackOut.ruleTrend.coefAll, g(stackOut.ruleTrend));
  console.log('A rule + terms:', stackOut.ruleTerms.coefAll, g(stackOut.ruleTerms));
  const awayOut = out.away;
  console.log('G days away:', JSON.stringify(awayOut.whole), 'shipped', g(awayOut.shipped), '| on first sets', g(awayOut.onFirstSets), JSON.stringify({ first: awayOut.firstSets, proxy: awayOut.proxy }));
  console.log('G variants:', JSON.stringify(awayOut.variants));
  console.log('G app:', g(awayOut.app), JSON.stringify({ differs: awayOut.app.differs, rows: awayOut.app.rows, lastFit: awayOut.app.lastFit, replay: awayOut.replay }));
  console.log('G table:', JSON.stringify(awayOut.all.table.map((t) => [t.name, t.mae, t.vsBase.diff, t.vsBase.se])), JSON.stringify(awayOut.unrounded.table.map((t) => [t.name, t.mae, t.vsBase.diff, t.vsBase.se])));
  console.log('A next set:', JSON.stringify(nextSetOut.all), g(nextSetOut.crossGamma));
  console.log('5 set time:', JSON.stringify(out.setTime).slice(0, 1500));
  console.log('A strength raw:', Object.fromEntries(Object.entries(strengthOut.raw).map(([k, v]) => [k, v.mae])));
  console.log('A tau:', JSON.stringify(tauOut.ext), JSON.stringify(tauOut.knee));
  console.log('F rest:', JSON.stringify(restOut.all.perMinuteCut), JSON.stringify(restOut.iso.perMinuteCut), JSON.stringify(restOut.compound.perMinuteCut));
}
main().catch((e) => { console.error(e); process.exit(1); });
