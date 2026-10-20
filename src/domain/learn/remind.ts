import { addDays, weekStart } from '../analytics';
import { perLog } from '../stats';
import type { SetEntry } from '../types';
import { dayOf } from './capacity';
import { betaCdf, normCdf, normPdf } from './num';

// Item 16: the workout reminder fitted to when he trains. The reminder stays what it was, a safety net ("nothing logged
// today by HH:MM"), and learning can only make it quieter (owner: never more intrusive than today's; no new sends). On a day he
// picked, it is skipped when that weekday isn't one of his, and it waits past his chosen time while he is more likely late than
// missing the day. The Worker takes the later of his time and the learned one (worker/src/schedule.ts remindAt), so a learned
// time can never make it earlier, and adds nothing on a day he didn't pick.
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default that takes no
// action (here: leaves the reminder as he set it).
//
// Why a late-nudge and not a pre-cue (a): imposing a fixed window backfired against flexible timing (Beshears, Lee, Milkman,
// Mislavsky & Wisdom 2021, Management Science 67:6), a reminder before every session supports repetition but hinders
// automaticity (Stawarz, Cox & Blandford 2015, CHI), and prompts habituate (Klasnja 2019, Ann Behav Med 53:573). Deliver only
// when the rule says he needs it (a JITAI decision rule: Nahum-Shani 2018, Ann Behav Med 52:446).
//
// The event (b): a date's first entry, as the app heard of it: `enteredAt` for a set entered late (the moment it was typed),
// else `loggedAt`. That is what the Worker sees ("anything logged today", POST /activity within seconds), cardio included.
// Minutes after the date's local midnight in his zone; a date first heard of on another calendar day (back-filled) has no time.
// The date is the set's own (timing.sessionDay folds post-midnight sets into their session), so no circular statistics: the
// reminder must fire on the date itself, and a linear axis from that midnight is the right one.
//
// 1. Which weekdays are his (b). For each weekday d, in weeks he trained at all (a week with no session says nothing about
//    which days are his, and leaving it out keeps a layoff from switching his days off), y = 1 if he trained on d. Counts are
//    faded by 2^(−age/h), a power prior on old weeks (a: Ibrahim & Chen 2000, Stat Sci 15:46), so a layoff leaves less
//    evidence and a wider posterior (owner: long gaps widen uncertainty):
//      p_d ~ Beta(a_d + m/2, n_d − a_d + m/2)
//    The prior is centred on even odds (c): with no evidence a weekday is neither his nor not, so nothing changes. Its strength
//    m, shared by all seven weekdays (partial pooling of how far one week moves a weekday), and h are learned (b) by
//    prequential likelihood over a grid, averaged by posterior weight (Bayesian model averaging, as learn/pain).
//    A rest day only exists within a weekly routine. So this weekday model is weighed against one with a single rate for
//    every day (he trains when he can) by their marginal likelihoods, a Bayes factor at even prior odds (b; c for the odds):
//      P(off) = P(routine | log) · P(p_d < 1/2 | routine)
//    Not one of his days ⇔ P(off) > 1/2. Someone who trains twice a week on whatever days keeps every day he picked; a log
//    of two weeks can't show a routine yet. Even odds (a): a wrongly skipped day costs little, since one missed
//    opportunity did not materially affect habit formation (Lally, van Jaarsveld, Potts & Wardle 2010, EJSP 40:998), and a
//    needless reminder costs little too, but real (Stawarz 2015; Klasnja 2019). Both about as cheap: decide at even odds.
//    p for part 3 is the model-averaged predictive.
// 2. When he starts (b): a kernel density of his first-entry times. Each weekday's own sessions are pooled with all of them,
//      f_d = (Σ_own w·K + m'·Σ_all w·K / Σ_all w) / (Σ_own w + m')
//    with recency weights w = 2^(−age/h') and the pooling strength m' learned (b) by prequential likelihood over a grid (BMA).
//    The kernel is Gaussian, its bandwidth Silverman's rule (a: Silverman 1986, Density Estimation, eq. 3.31,
//    0.9·min(SD, IQR/1.34)·n^(−1/5)), with n the faded count Σw, so a layoff widens the kernel (owner: long gaps widen
//    uncertainty). A kernel keeps two habits apart: Saturday at 09:00 or 18:00 is not 13:30.
// 3. The time (b, with the decision rule a). With nothing logged by T on one of his days, he is still coming with
//      P(late | nothing by T) = p·S(T) / (p·S(T) + 1 − p),     S(T) = P(start > T)
//    The reminder waits until that is no more than 1/2 (even odds, as above: from then on a reminder is more likely needed than
//    not). At p ≤ 1/2 that holds from midnight, so the Worker's max with his own time leaves his time; with no evidence p is 1/2
//    and nothing changes (c). If it never holds before midnight he is usually still to come all day: no reminder that day.
//    The time is the first whole minute where it holds (rounded later, never earlier).

/** (c) Half-lives on the grid, days: doubling, two weeks to over a year; uniform prior (the data weighs them). */
export const HALF_LIVES = [14, 28, 56, 112, 224, 448] as const;
/** (c) Prior strengths on the grid, in weeks (days) or sessions (times): from barely one to a strong pull; uniform prior. */
export const STRENGTHS = [0.5, 1, 2, 4, 8, 16, 32, 64, 128] as const;
const NH = HALF_LIVES.length, NS = STRENGTHS.length, NC = NH * NS;
/** Minutes in a day. */
const DAY_MIN = 1440;
/** Moments are taken about noon (numerics: minutes in a day, no cancellation). */
const NOON = 720;
/** Numerics: a bandwidth under the clock's one-minute grain means nothing. */
const MIN_BW = 1;
/** (a) Silverman's rule of thumb (Silverman 1986, eq. 3.31). */
const silverman = (sd: number, iqr: number, n: number) => {
  const s = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  return Math.max(MIN_BW, 0.9 * s * n ** -0.2);
};

const fmt = new Map<string, Intl.DateTimeFormat>();
/** The local date and minutes after its midnight of an ISO instant in zone `tz` (DST-safe: the zone's own wall clock). */
export function wallClock(iso: string, tz: string): { date: string; min: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  let f = fmt.get(tz);
  if (!f) fmt.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, min: (Number(o.hour) % 24) * 60 + Number(o.minute) + Number(o.second) / 60 };
}
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Each training date before `today` (sorted), and its first entry's minutes after local midnight, or null (see the header). */
export function startsOf(entries: readonly SetEntry[], today: string, tz: string): { date: string; min: number | null }[] {
  const first = new Map<string, { t: number; iso: string } | null>();
  for (const e of entries) {
    if (e.date >= today) continue;
    const iso = e.enteredAt ?? e.loggedAt;
    const prev = first.get(e.date);
    if (!iso) { if (prev === undefined) first.set(e.date, null); continue; }
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) { if (prev === undefined) first.set(e.date, null); continue; }
    if (!prev || t < prev.t) first.set(e.date, { t, iso });
  }
  return [...first.keys()].sort().map((date) => {
    const f = first.get(date);
    const w = f ? wallClock(f.iso, tz) : null;
    return { date, min: w && w.date === date ? w.min : null };
  });
}

const softmax = (ll: Float64Array) => {
  let mx = -Infinity;
  for (const x of ll) mx = Math.max(mx, x);
  const w = new Float64Array(ll.length);
  let z = 0;
  for (let i = 0; i < ll.length; i++) { w[i] = Math.exp(ll[i] - mx); z += w[i]; }
  for (let i = 0; i < ll.length; i++) w[i] /= z;
  return w;
};

/**
 * Silverman bandwidth of the weighted sample x[j], w[j] for j < `upto`, n = Σw (the faded count); `order` sorts x ascending.
 * Quartiles are weighted: the smallest x whose cumulative weight reaches a quarter (three quarters) of the total. Null below two
 * points. No allocation: the prequential fit calls it once per session per half-life.
 */
function bwCore(x: ArrayLike<number>, w: ArrayLike<number>, order: ArrayLike<number>, upto: number, from = 0): number | null {
  if (upto < 2) return null;
  // One pass, moments about the first point (no cancellation: minutes within a day).
  const c = x[from];
  let n = 0, s1 = 0, s2 = 0;
  for (let j = from; j < upto; j++) { const d = x[j] - c; n += w[j]; s1 += w[j] * d; s2 += w[j] * d * d; }
  if (!(n > 0)) return null;
  const sd = Math.sqrt(Math.max(0, s2 / n - (s1 / n) ** 2));
  if (!(sd > 0)) return MIN_BW;
  let acc = 0, q1 = NaN, q3 = NaN;
  for (let k = 0; k < order.length; k++) {
    const j = order[k];
    if (j >= upto || j < from) continue;
    acc += w[j];
    if (Number.isNaN(q1) && acc >= 0.25 * n) q1 = x[j];
    if (acc >= 0.75 * n) { q3 = x[j]; break; }
  }
  if (Number.isNaN(q3)) q3 = x[order[order.length - 1]];
  return silverman(sd, q3 - q1, n);
}
const ascending = (x: ArrayLike<number>) => Int32Array.from({ length: x.length }, (_, i) => i).sort((a, b) => x[a] - x[b]);

/** Silverman bandwidth of a weighted sample, n = Σw (the faded count). Null below two points. */
export const bandwidth = (xs: readonly number[], ws: readonly number[]): number | null => bwCore(xs, ws, ascending(xs), xs.length);

export interface ReminderDay {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** Weeks he trained at all that this weekday was seen in, and trained on it (raw counts, not faded). */
  weeks: number; trained: number;
  /** P(he trains on this weekday in a week he trains), the BMA posterior mean and SD over both models (b). */
  p: number; sd: number;
  /** P(a weekly routine, and this weekday trained in under half its weeks): above 1/2 it isn't one of his days. */
  pOff: number;
  /** The learned time, minutes after midnight (null: nothing learned, his own time stands); 'off': no reminder that day. */
  at: number | 'off' | null;
  /** Why: not one of his days, usually still to come all day, or a time. */
  why: 'not his day' | 'late all day' | 'time' | 'no evidence';
}
export interface ReminderFit {
  days: ReminderDay[];
  /** Training dates seen, and those with a first-entry time. */
  dates: number; timed: number;
  /** The kernel bandwidth now (minutes), the person level; null with under two timed dates. */
  bw: number | null;
  /** Posterior weight of each half-life, for the days (within a routine) and for the times. */
  hDays: [number, number][]; hTimes: [number, number][];
  /** P(he keeps a weekly routine) against one rate for every day: the Bayes factor at even prior odds (b). */
  routine: number;
  /** What the Worker gets: per weekday "HH:MM", 'off' or null. */
  schedule: (string | null)[];
  /** P(he starts after minute T) on weekday d (the BMA mixture), for the card and the tests. */
  survival(d: number, t: number): number;
}

interface DayEvent { wd: number; day: number; y: number }

/** One model's grid fit: faded counts per group (a weekday, or one group for all), the prequential log-likelihood per cell. */
function gridFit(ev: readonly DayEvent[], group: (wd: number) => number, G: number) {
  const ll = new Float64Array(NC);
  const finals: { a: Float64Array; n: Float64Array; last: Int32Array }[] = [];
  const aS = new Float64Array(ev.length), nS = new Float64Array(ev.length);
  for (let hi = 0; hi < NH; hi++) {
    const h = HALF_LIVES[hi];
    const a = new Float64Array(G), n = new Float64Array(G), last = new Int32Array(G);
    for (let s = 0; s < ev.length; s++) {
      const { day, y } = ev[s], g = group(ev[s].wd);
      const f = n[g] > 0 ? 2 ** (-(day - last[g]) / h) : 1;
      a[g] *= f; n[g] *= f;
      aS[s] = a[g]; nS[s] = n[g];
      a[g] += y; n[g] += 1; last[g] = day;
    }
    finals.push({ a, n, last });
    for (let mi = 0; mi < NS; mi++) {
      const m = STRENGTHS[mi];
      let sum = 0;
      for (let s = 0; s < ev.length; s++) sum += Math.log(ev[s].y ? (aS[s] + m / 2) / (nS[s] + m) : (nS[s] - aS[s] + m / 2) / (nS[s] + m));
      ll[hi * NS + mi] = sum;
    }
  }
  let mx = -Infinity;
  for (const x of ll) mx = Math.max(mx, x);
  let z = 0;
  for (const x of ll) z += Math.exp(x - mx);
  /** Log marginal likelihood: the grid's uniform prior averaged out. */
  const logML = ev.length ? mx + Math.log(z / NC) : 0;
  const w = softmax(ll);
  /** Posterior of group g's rate now: mean, second moment, P(rate < 1/2). */
  const at = (g: number, todayNo: number) => {
    let p = 0, p2 = 0, below = 0;
    for (let hi = 0; hi < NH; hi++) {
      const { a, n, last } = finals[hi];
      const f = n[g] > 0 ? 2 ** (-(todayNo - last[g]) / HALF_LIVES[hi]) : 0;
      const A = a[g] * f, N = n[g] * f;
      for (let mi = 0; mi < NS; mi++) {
        const wc = w[hi * NS + mi], m = STRENGTHS[mi];
        const al = A + m / 2, be = N - A + m / 2, mean = al / (al + be);
        p += wc * mean;
        p2 += wc * (mean * mean + (al * be) / ((al + be) ** 2 * (al + be + 1)));
        below += wc * betaCdf(0.5, al, be);
      }
    }
    return { p, p2, below };
  };
  const h = HALF_LIVES.map((x, hi) => { let s = 0; for (let mi = 0; mi < NS; mi++) s += w[hi * NS + mi]; return [x, s] as [number, number]; });
  return { logML, at, h };
}

/**
 * Part 1: weekday events and two models, averaged by their marginal likelihoods (Bayes factor, even prior odds, c): a weekly
 * routine (each weekday its own rate) or none (one rate for every day: he trains when he can). A day is a rest day only
 * within a routine, so P(off) = P(routine)·P(p_d < 1/2 | routine): a trainer with no fixed days keeps every day he picked.
 */
function fitDays(dates: readonly string[], today: string, todayNo: number) {
  const trained = new Set(dates);
  const ev: DayEvent[] = [];
  if (dates.length) {
    const active = new Set(dates.map(weekStart));
    for (let d = dates[0]; d < today; d = addDays(d, 1)) if (active.has(weekStart(d))) ev.push({ wd: weekday(d), day: dayOf(d), y: trained.has(d) ? 1 : 0 });
  }
  const routine = gridFit(ev, (wd) => wd, 7), none = gridFit(ev, () => 0, 1);
  const pR = 1 / (1 + Math.exp(none.logML - routine.logML));
  const flat = none.at(0, todayNo);
  const out = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const weeks = ev.filter((e) => e.wd === wd).length, tr = ev.filter((e) => e.wd === wd && e.y).length;
    // Never seen: exactly the prior within a routine, even odds (the grid's sum can stray from 1/2 in the last bit).
    const r = weeks ? routine.at(wd, todayNo) : { p: 0.5, p2: routine.at(wd, todayNo).p2, below: 0.5 };
    const p = pR * r.p + (1 - pR) * flat.p, p2 = pR * r.p2 + (1 - pR) * flat.p2;
    return { p, sd: Math.sqrt(Math.max(0, p2 - p * p)), pOff: pR * r.below, weeks, trained: tr };
  });
  return { out, hDays: routine.h, routine: pR };
}

/** Part 2: the start-time mixture, by weekday, as of `todayNo`. */
function fitTimes(timed: readonly { wd: number; day: number; x: number }[], todayNo: number) {
  const T = timed.length;
  const ll = new Float64Array(NC);
  const xs = Float64Array.from(timed, (t) => t.x), order = ascending(xs);
  const pos = new Int32Array(T);
  for (let k = 0; k < T; k++) pos[order[k]] = k;
  let top = 1;
  while (top * 2 <= T) top *= 2;
  const fen = new Float64Array(T + 1);
  // The smallest sorted position whose cumulative weight reaches `target` (a Fenwick tree over the sessions sorted by time).
  const find = (target: number) => {
    let k = 0;
    for (let bit = top; bit; bit >>= 1) if (k + bit <= T && fen[k + bit] < target) { k += bit; target -= fen[k]; }
    return Math.min(k, T - 1);
  };
  for (let hi = 0; hi < NH; hi++) {
    const h = HALF_LIVES[hi];
    // 2^(−(day_i − day_j)/h) = E_j / E_i: one power per session, not per pair; sums of E carry the faded moments.
    const E = Float64Array.from(timed, (t) => 2 ** ((t.day - timed[0].day) / h));
    fen.fill(0);
    let S0 = 0, S1 = 0, S2 = 0, from = 0;
    for (let i = 0; i < T; i++) {
      if (i >= 2) {
        // Sessions faded below 1e-12 of a fresh one count for nothing at double precision: numerics, not a window.
        while (from < i - 2 && E[from] / E[i] < 1e-12) {
          for (let k = pos[from] + 1; k <= T; k += k & -k) fen[k] -= E[from];
          const d = xs[from] - NOON;
          S0 -= E[from]; S1 -= E[from] * d; S2 -= E[from] * d * d;
          from++;
        }
        // The bandwidth of the sessions before i (as bwCore): moments about noon, weighted quartiles from the tree.
        const n = S0 / E[i], mean = S1 / S0, sd = Math.sqrt(Math.max(0, S2 / S0 - mean * mean));
        const bw = sd > 0 ? silverman(sd, xs[order[find(0.75 * S0)]] - xs[order[find(0.25 * S0)]], n) : MIN_BW;
        let own = 0, wOwn = 0, all = 0, wAll = 0;
        const xi = xs[i], wd = timed[i].wd, inv = 1 / E[i];
        for (let j = from; j < i; j++) {
          const wj = E[j] * inv, z = (xi - xs[j]) / bw;
          const k = z * z < 80 ? wj * normPdf(z) / bw : 0; // beyond ~9 bandwidths a kernel adds under 1e-17: numerics
          all += k; wAll += wj;
          if (timed[j].wd === wd) { own += k; wOwn += wj; }
        }
        for (let mi = 0; mi < NS; mi++) {
          const m = STRENGTHS[mi];
          ll[hi * NS + mi] += Math.log(Math.max(1e-300, (own + m * all / wAll) / (wOwn + m)));
        }
      }
      for (let k = pos[i] + 1; k <= T; k += k & -k) fen[k] += E[i];
      const d = xs[i] - NOON;
      S0 += E[i]; S1 += E[i] * d; S2 += E[i] * d * d;
    }
  }
  const w = softmax(ll);
  // The final weighted samples, one per half-life.
  const per = HALF_LIVES.map((h) => {
    const ws = Float64Array.from(timed, (t) => 2 ** (-(todayNo - t.day) / h));
    return { ws, bw: bwCore(xs, ws, order, T) };
  });
  const survival = (wd: number, t: number): number => {
    let s = 0;
    for (let hi = 0; hi < NH; hi++) {
      const { ws, bw } = per[hi];
      if (bw == null) return NaN;
      let own = 0, wOwn = 0, all = 0, wAll = 0;
      for (let j = 0; j < T; j++) {
        const k = ws[j] * (1 - normCdf((t - timed[j].x) / bw));
        all += k; wAll += ws[j];
        if (timed[j].wd === wd) { own += k; wOwn += ws[j]; }
      }
      for (let mi = 0; mi < NS; mi++) { const m = STRENGTHS[mi]; s += w[hi * NS + mi] * (own + m * all / wAll) / (wOwn + m); }
    }
    return s;
  };
  // The person-level bandwidth now, under the posterior-weighted half-life (for display and tests).
  let bwNow: number | null = null;
  if (per.every((x) => x.bw != null)) {
    bwNow = 0;
    for (let hi = 0; hi < NH; hi++) { let wh = 0; for (let mi = 0; mi < NS; mi++) wh += w[hi * NS + mi]; bwNow += wh * per[hi].bw!; }
  }
  const hTimes = HALF_LIVES.map((x, hi) => { let s = 0; for (let mi = 0; mi < NS; mi++) s += w[hi * NS + mi]; return [x, s] as [number, number]; });
  return { survival, bw: bwNow, hTimes };
}

/** The first whole minute T in the day where P(late | nothing by T) ≤ 1/2, given p and the survival S(T); null if none. */
export function firstMinute(p: number, S: (t: number) => number): number | null {
  // p·S/(p·S + 1 − p) ≤ 1/2  ⇔  p·S ≤ 1 − p
  const ok = (t: number) => p * S(t) <= 1 - p;
  if (ok(0)) return 0;
  if (!ok(DAY_MIN - 1)) return null;
  let lo = 0, hi = DAY_MIN - 1; // ok(lo) false, ok(hi) true; S is non-increasing
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ok(mid)) hi = mid; else lo = mid; }
  return hi;
}

function fit(starts: readonly { date: string; min: number | null }[], today: string): ReminderFit {
  const todayNo = dayOf(today);
  const { out, hDays, routine } = fitDays(starts.map((s) => s.date), today, todayNo);
  const timed = starts.filter((s) => s.min != null).map((s) => ({ wd: weekday(s.date), day: dayOf(s.date), x: s.min! }));
  const times = fitTimes(timed, todayNo);
  const days: ReminderDay[] = out.map((o, wd) => {
    const base = { day: wd, weeks: o.weeks, trained: o.trained, p: o.p, sd: o.sd, pOff: o.pOff };
    if (o.pOff > 0.5) return { ...base, at: 'off', why: 'not his day' };
    if (!(o.p > 0.5) || times.bw == null) return { ...base, at: null, why: 'no evidence' };
    const t = firstMinute(o.p, (x) => times.survival(wd, x));
    if (t == null) return { ...base, at: 'off', why: 'late all day' };
    return { ...base, at: t, why: 'time' };
  });
  return {
    days, dates: starts.length, timed: timed.length, bw: times.bw, hDays, hTimes: times.hTimes, routine,
    schedule: days.map((d) => (d.at === 'off' ? 'off' : d.at == null ? null : hhmm(d.at))),
    survival: times.survival,
  };
}

// The fit reads only the dates before today and their first times, so a set logged today (a new log array) reuses it: keyed by
// what it reads, not by the array. A new day, an edit to a past day or another zone refits.
const byLog = perLog(() => new Map<string, { date: string; min: number | null }[]>());
const FITS = new Map<string, ReminderFit>();
/** The reminder fit as of `today` (dates before it), in zone `tz`. */
export function fitReminder(entries: readonly SetEntry[], today: string, tz: string): ReminderFit {
  const m = byLog(entries), k = `${today}|${tz}`;
  let starts = m.get(k);
  if (!starts) { if (m.size > 4) m.clear(); m.set(k, (starts = startsOf(entries, today, tz))); }
  const key = `${k}|${starts.map((s) => `${s.date}${s.min == null ? '' : `@${s.min}`}`).join(',')}`;
  let f = FITS.get(key);
  if (!f) { if (FITS.size > 4) FITS.clear(); FITS.set(key, (f = fit(starts, today))); }
  return f;
}
