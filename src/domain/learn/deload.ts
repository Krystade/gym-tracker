import { addDays } from '../analytics';
import type { BodyDay } from '../body';
import { likelyRegion } from '../care';
import { MUSCLES, muscleVector, type Muscle } from '../muscles';
import type { Region, SetEntry } from '../types';
import { aheadVar, dayOf, READY, type Core, type Est, type LiftCore } from './capacity';
import { coreFor } from './rest';
import { backward, cholesky, forward, normCdf } from './num';
import { pool } from './pool';
import { liftSimilarity } from './tags';
import { REACCLIMATION, runIndex } from './trend';

// Item 06: is he tired all over, or is one lift stuck? A deload is suggested only when his performance has fallen across lifts
// (the one established marker of overreaching: a sustained decrease in performance, a: Grandou 2020, Sports Med 50:815) and a
// second, independent signal agrees: his energy is below his usual (subjective well-being tracks load more sensitively than
// objective markers, a: Saw 2016, BJSM 50:281) or aches across sites (feeling "beat up" is the commonest deload trigger, a:
// Rogerson 2024, Sports Med Open 10:22). One lift down is that lift's (item 12: rotation); one sore spot is local (item 08).
//
// Model. Each lift's per-session readings of its fatigue-adjusted level (learn/capacity LiftCore.obs: a late or pre-fatigued set
// isn't read as lost strength; a set stopped at its target, in pain or in a light week is a lower bound, so a deliberately easy
// session can't read as a decline) are filtered forward (the level's own random walk, its drift learned, b) up to the lift's
// last RECENT sessions; those are compared with it: d_L = GLS mean of z − m_ref, its variance from the reference's, the drift and
// any layoff since (aheadVar: layoffs widen it, a: Bosquet 2013), and each reading's own. The shifts are pooled person → family →
// lift (learn/pool: d_L = δ + f + l); δ, the person's shift, is the systemic part. Two hypotheses, even odds:
//   none      δ = 0
//   shift     δ ~ N(0, S²)    (S learned, b: how far his whole-body level has moved over his past stretches, by moments)
// P(decline) = P(shift | data)·P(δ < 0 | shift, data), the Bayes factor by Savage–Dickey (the pool is Gaussian, so exact).
// A deload is suggested when P(decline) > ½ (see P_STAR) and a second signal agrees. Nothing here acts on a (c) value.

/**
 * (a) A week off unloads: a 1-week stop cost no muscle and reset nothing that needed resetting (Coleman 2024, PeerJ 12:e16777),
 * and deloads last 6.4 ± 1.7 days in practice (Rogerson 2024) and 5–7 days by recommendation (Bell 2025, SCJ). A gap this long
 * between sessions ends a stretch: fatigue is judged within the stretch since; it is also how long a light week lasts.
 */
export const BREAK_DAYS = 7;
export const LIGHT_DAYS = 7;
/**
 * (a) Sustained: more than one session (Grandou 2020: a sustained decrease, not a bad day; one session's reading carries the
 * day's readiness, Grgic 2020). The fewest that can be sustained, and with each lift about weekly, about two weeks of it.
 */
export const RECENT = 2;
/**
 * (a) Prior scale of a systemic shift, ln e1RM: a day's readiness, 3 % (Grgic 2020's 4.2 % test–retest CV of a 1RM), worth two
 * stretches; Fry 2001's 2 weeks of overreaching cost about 9 kg on a squat 1RM, within two of it. (b) Re-estimated by moments
 * from his past stretches (`scaleOf`).
 */
const SHIFT_PRIOR = { sd: READY, k: 2 } as const;
/**
 * (a) Cost ratio: a needless light week costs little (Spiering 2021, strength held for months on far less volume at the same
 * load; Vann 2021; Coleman 2024, even a week off cost no muscle) and a missed one little too (no study shows a deload helps,
 * Bell 2023 Delphi; his breaks unload him anyway). Both about as cheap: suggest at even odds.
 */
const P_STAR = 0.5;
/** (a) Bell 2025 (SCJ), moderate recovery need: volume down 40–60 % (half the sets), load down about 10 % of RM, or 1–3 RIR further. */
export const LIGHT = { volume: 0.5, load: 0.1, rir: 3 } as const;

const DAY = 864e5;
const isWork = (e: SetEntry) => !e.flags.includes('warmup') && !e.flags.includes('partial') && !e.flags.includes('cardio') && e.reps != null && e.reps > 0;
export const isLight = (e: SetEntry): boolean => e.flags.includes('light');
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** The light week on `today`: from his tap (`tapped`), else from the log's latest run of light sets; null when none is on. */
export function lightWeek(entries: readonly SetEntry[], today: string, tapped?: { from: string; end?: string } | null): { from: string; to: string } | null {
  let last = '';
  for (const e of entries) if (isLight(e) && e.date <= today && e.date > last) last = e.date;
  let first = last;
  if (last) for (const e of entries) if (isLight(e) && e.date < first && days(e.date, last) < LIGHT_DAYS) first = e.date;
  const on = (from: string) => from <= today && days(from, today) < LIGHT_DAYS && !(tapped?.end && tapped.end <= today && tapped.end >= from);
  const from = tapped && on(tapped.from) ? tapped.from : first && on(first) ? first : null;
  return from ? { from, to: addDays(from, LIGHT_DAYS - 1) } : null;
}

/** The main muscle a lift trains (its largest share): two lifts with different ones are different places to be tired. */
function mainOf(name: string): Muscle | null {
  const v = muscleVector(name);
  let best: Muscle | null = null;
  if (v) for (const m of MUSCLES) if ((v[m] ?? 0) > (best ? v[best] ?? 0 : 0)) best = m;
  return best;
}

export interface Shift { key: string; name: string; d: number; sd: number; from: string; to: string }

/**
 * One lift's shift over its last RECENT readings with day < `end` and on or after `start` (needing one reading of the stretch
 * before them): their GLS mean against the forward-filtered level from every reading before them, ln e1RM. Null without enough.
 */
export function shiftOf(core: Core, l: LiftCore, start: number, end: number): Shift | null {
  const all = l.obs.filter((o) => o.day < end);
  const idx = runIndex(all.map((o) => o.day));
  const obs = all.filter((_, i) => idx[i] >= REACCLIMATION);
  const inStretch = obs.filter((o) => o.day >= start).length;
  if (inStretch < RECENT + 1) return null;
  const ref = obs.slice(0, obs.length - RECENT), rec = obs.slice(obs.length - RECENT);
  let m = ref[0].z, P = ref[0].v;
  for (let i = 1; i < ref.length; i++) {
    const Pp = P + aheadVar(core, ref[i].day - ref[i - 1].day), K = Pp / (Pp + ref[i].v);
    m += K * (ref[i].z - m); P = (1 - K) * Pp;
  }
  const t0 = ref[ref.length - 1].day, n = rec.length;
  // Cov(r_i, r_j) = P + drift to the earlier of the two (they share it) + the reading's own on the diagonal.
  const C = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) C[i * n + j] = P + aheadVar(core, Math.min(rec[i].day, rec[j].day) - t0) + (i === j ? rec[i].v : 0);
  if (!cholesky(C, n)) return null;
  const a = backward(C, n, forward(C, n, rec.map((o) => o.z - m))), b = backward(C, n, forward(C, n, rec.map(() => 1)));
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  return { key: l.key, name: l.name, d: sa / sb, sd: Math.sqrt(1 / sb), from: rec[0].date, to: rec[n - 1].date };
}

/** Training days (a working set), ascending, before `end`. */
function trainingDays(entries: readonly SetEntry[], end: string): string[] {
  const s = new Set<string>();
  for (const e of entries) if (e.date < end && isWork(e)) s.add(e.date);
  return [...s].sort();
}

/** Each stretch's first day: a training day after a gap of BREAK_DAYS or more, or after a light week's last light set. */
function stretchStarts(entries: readonly SetEntry[], dates: string[]): string[] {
  const light = new Set(entries.filter(isLight).map((e) => e.date));
  const out: string[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (light.has(dates[i])) continue;
    if (!i || days(dates[i - 1], dates[i]) >= BREAK_DAYS || light.has(dates[i - 1])) out.push(dates[i]);
  }
  return out;
}

const SCALES = new WeakMap<Core, Map<string, number>>();
/**
 * S, the scale of a systemic shift (b): over each past stretch (each ended before `before`), every lift's shift at its end,
 * pooled completely (precision-weighted mean m_k, variance s_k²); S² = mean of m_k² − s_k² beyond noise, shrunk toward the
 * prior with the weight of SHIFT_PRIOR.k stretches.
 */
export function scaleOf(core: Core, entries: readonly SetEntry[], before: string): number {
  let byDate = SCALES.get(core);
  if (!byDate) SCALES.set(core, byDate = new Map());
  const hit = byDate.get(before);
  if (hit != null) return hit;
  const dates = trainingDays(entries, before);
  const starts = stretchStarts(entries, dates);
  let n = 0, ss = 0;
  for (let k = 0; k + 1 < starts.length; k++) {
    const s = dayOf(starts[k]), e = dayOf(starts[k + 1]);
    let w = 0, wm = 0;
    for (const l of core.lifts.values()) {
      const x = shiftOf(core, l, s, e);
      if (x) { w += 1 / x.sd ** 2; wm += x.d / x.sd ** 2; }
    }
    if (w > 0) { const m = wm / w; ss += Math.max(0, m * m - 1 / w); n++; }
  }
  const v = Math.sqrt((SHIFT_PRIOR.k * SHIFT_PRIOR.sd ** 2 + ss) / (SHIFT_PRIOR.k + n));
  if (byDate.size > 8) byDate.clear();
  byDate.set(before, v);
  return v;
}

export interface Systemic {
  /** P(a systemic decline), and the person's shift (ln e1RM: −0.03 is 3 % down) it rests on, pooled person → family → lift. */
  p: number; shift: Est;
  /** The prior scale of a shift S (learned) and P(any shift) before its direction. */
  scale: number; pShift: number;
  /** The lifts that spoke, each with its own shift (before pooling) and its pooled one. */
  lifts: (Shift & { pooled: Est })[];
  /** The stretch's first day (since the last break or light week) and the window the recent sessions span. */
  since: string; window: string | null;
  /** Energy: the median logged in the window and his usual before it (null with none of either); low when below. */
  energy: { recent: number; usual: number; low: boolean } | null;
  /** Pain regions flagged in the window. */
  pain: Region[];
  /**
   * 'deload': suggest a light week. Else why not: 'break' (a week off just unloaded him), 'light' (a light week is on), 'few'
   * (not enough lifts with sessions in the stretch to tell), 'steady' (no decline), 'alone' (a decline, no second signal).
   */
  verdict: 'deload' | 'break' | 'light' | 'few' | 'steady' | 'alone';
}

const npdf = (x: number, v: number) => Math.exp(-0.5 * x * x / v) / Math.sqrt(2 * Math.PI * v);

/**
 * Whether his performance is down across lifts on `today` (see the header), from the core fitted to the days before it and his
 * energy (`body`); `tapped`: a light week he started on this phone. Null with no training before today.
 */
const LAST = new WeakMap<readonly SetEntry[], { body: readonly BodyDay[]; key: string; out: Systemic | null }>();
export function systemic(entries: readonly SetEntry[], body: readonly BodyDay[], today: string, tapped?: { from: string; end?: string } | null): Systemic | null {
  // Asked once per lift card on a render: the same log, energy, day and tap give the same answer.
  const key = `${today}|${tapped?.from ?? ''}|${tapped?.end ?? ''}`;
  const hit = LAST.get(entries);
  if (hit && hit.body === body && hit.key === key) return hit.out;
  // The core as of the days before today, kept while they're the same sets (learn/rest coreFor): a set logged today reads only today.
  const out = systemicOf(entries, body, today, tapped, coreFor(entries, today));
  LAST.set(entries, { body, key, out });
  return out;
}

function systemicOf(entries: readonly SetEntry[], body: readonly BodyDay[], today: string, tapped: { from: string; end?: string } | null | undefined, core: Core | null): Systemic | null {
  const dates = trainingDays(entries, today);
  if (!dates.length || !core) return null;
  const starts = stretchStarts(entries, dates);
  const since = starts.at(-1) ?? dates[0];
  const base = { p: 0, shift: { mean: 0, sd: SHIFT_PRIOR.sd }, scale: SHIFT_PRIOR.sd, pShift: 0, lifts: [], since, window: null, energy: null, pain: [] as Region[] };
  if (lightWeek(entries, today, tapped)) return { ...base, verdict: 'light' };
  if (days(dates.at(-1)!, today) >= BREAK_DAYS) return { ...base, verdict: 'break' };
  const s0 = dayOf(since), end = dayOf(today);
  const shifts = [...core.lifts.values()].map((l) => shiftOf(core, l, s0, end)).filter((x): x is Shift => !!x);
  // Systemic means more than one place: two lifts led by different muscles at least (a: one muscle down is local, items 08/12).
  if (new Set(shifts.map((x) => mainOf(x.name) ?? x.key)).size < 2) return { ...base, lifts: shifts.map((x) => ({ ...x, pooled: { mean: x.d, sd: x.sd } })), verdict: 'few' };
  const S = scaleOf(core, entries, since);
  // (c) The between-lift spread's prior is S too: it shapes the pooling prior only; the pool learns the spread.
  const pl = pool(shifts.map((x) => ({ key: x.key, est: x.d, v: x.sd ** 2 })), liftSimilarity, { mean: 0, personSd: S, liftSd: S });
  const m = pl.person.mean, sd = pl.person.sd;
  const bf = npdf(0, S * S) / npdf(m, sd * sd);
  const pShift = Number.isFinite(bf) ? bf / (1 + bf) : 1;
  const p = pShift * normCdf(-m / sd);
  const window = shifts.reduce((a, x) => (x.from < a ? x.from : a), shifts[0].from);
  const recent: number[] = [], usual: number[] = [];
  for (const d of body) if (d.energy != null && d.date <= today) (d.date >= window ? recent : usual).push(d.energy);
  const energy = recent.length && usual.length ? { recent: median(recent), usual: median(usual), low: median(recent) < median(usual) } : null;
  const pain = [...new Set(entries.filter((e) => e.flags.includes('pain') && e.date >= window && e.date < today).map((e) => e.painRegion ?? likelyRegion(e.exercise)))].sort();
  const second = !!energy?.low || pain.length >= 2;
  const verdict = p <= P_STAR ? 'steady' : second ? 'deload' : 'alone';
  return { p, shift: { mean: m, sd }, scale: S, pShift, lifts: shifts.map((x) => ({ ...x, pooled: pl.lift(x.key) })), since, window, energy, pain, verdict };
}
