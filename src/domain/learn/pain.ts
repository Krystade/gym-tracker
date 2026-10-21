import { addDays } from '../analytics';
import { isCardio, isCardioEntry } from '../cardio';
import { likelyRegion } from '../care';
import { liftKey } from '../ids';
import { byOrderDone, perLog } from '../stats';
import type { SetEntry } from '../types';
import { dayOf } from './capacity';
import { logBefore } from './index';
import { betaCdf } from './num';

// Item 08: how likely a lift is to hurt next time, learned from his own pain flags (00-core §2: "could be learned as a
// recurrence hazard"), and the zones of the pain-monitoring model that say what a level of pain allows.
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default that only shapes a
// prior or holds something back.
//
// The model (b), one profile's log, partial pooling person → family → lift (00-core §1.1), the family being the region a lift
// loads (care.likelyRegion: pain is joint-specific, so a pushdown and an overhead extension share their elbow; c, a grouping):
//   p_L(t) = (a_L + m_F·π_F) / (n_L + m_F)                the lift's own pain sessions a_L of n_L, shrunk to its family's rate
//   π_F(t) = (a_F + m_P·π_P) / (n_F + m_P)                the region's other lifts' a_F of n_F, shrunk to the person's rate
//   π_P    = (A + 1) / (N + 2)                            every lift-session he has logged (c: a uniform prior, washed out)
// a and n count lift-sessions with any pain-flagged set (warm-ups included: pain from the very first set counts), each weighted
// by 2^(−days ago / h): pain is a state that fades, so the lift's and the region's recent sessions speak for now and a layoff
// leaves the lift with little evidence of its own, back toward its family's rate with a wider spread (owner: long layoffs widen
// uncertainty). The person's rate is his long-run one. Lifts are taken in the order done, so a lift done after another that hurt
// the same region today already counts it (owner: position in the session).
// h, m_F and m_P are learned (b) by their prequential likelihood: every lift-session predicted from the sessions before it, over
// a grid, and averaged by posterior weight (Bayesian model averaging, as the capacity fit does over (τ, ρ)). The grid is (c)
// log-uniform, and h stops at 224 days (a: Smidt 2002, Lancet 359:657, a wait-and-see policy resolved 83 % of lateral elbow
// pain within a year: pain does not last for ever; at h = 224 d a third of the effect is left after a year).
// The next morning (round 20): where he answered the morning question on a session's pain, that region was looked at once more,
// the next day, through the lift that hurt: one more lift-session for that lift on that day, with pain if still sore or worse,
// without if it settled (c: the weight of one look). So the fit learns from it like any session (b): pain that settles every time
// fades the risk, pain that lingers keeps it up. An answer counts only from its morning on (never before it could be given).

/**
 * (a) The pain-monitoring model's zones (Silbernagel & Crossley 2015, JOSPT 45:876, fig. 10: 0–2 safe, 2–5 acceptable, above 5
 * high risk; Silbernagel 2007, AJSM 35:897: loading within them did as well as rest), which the severity chips are: 1 mild
 * (≤ 3/10), 2 moderate (4–5/10), 3 sharp (> 5/10); 0 no pain. A pain set without a severity (an import) reads as moderate
 * (c: moderate only holds a lift where it is, so a pain of unknown size never lowers a load or acts in any other way).
 */
export type Zone = 0 | 1 | 2 | 3;
export function zoneOf(sets: readonly SetEntry[]): Zone {
  let z = 0;
  for (const e of sets) if (e.flags.includes('pain')) z = Math.max(z, e.painSeverity ?? 2);
  return z as Zone;
}

/** Half-lives on the grid, days (see the header). */
export const HALF_LIVES = [7, 14, 28, 56, 112, 224] as const;
/** Prior strengths of the family and person levels, in lift-sessions: from barely a session to a strong pull. */
const STRENGTHS = [0.5, 1, 2, 4, 8, 16, 32, 64, 128] as const;
const NH = HALF_LIVES.length, NS = STRENGTHS.length, NC = NH * NS * NS;
/** Days a fade is tabulated for; longer is gone (2^(−4000/224) < 1e-5). */
const MAXD = 4000;
const FADE = HALF_LIVES.map((h) => { const t = new Float64Array(MAXD + 1); for (let d = 0; d <= MAXD; d++) t[d] = 2 ** (-d / h); return t; });
const fade = (hi: number, d: number) => (d > MAXD ? 0 : FADE[hi][Math.max(0, d)]);

/** One lift's sessions on one day: its index, its region's, the day and whether any set hurt. */
interface Event { lift: number; region: number; day: number; y: number }

/** The next morning's answer on a pain set as an outcome: 1 still sore or worse, 0 settled, null none (or skipped). */
const morningY = (e: SetEntry): number | null => (!e.morning || e.morning === 'skipped' ? null : e.morning === 'settled' ? 0 : 1);

/**
 * Each lift-session in the order done (by day, then by its first set), with its lift and region; and each next-morning answer as
 * one more, first thing on the day after (see the header). `upTo`: the last day an answer may count on (a risk asked for a day
 * leaves out the mornings after it); none: all.
 */
function eventsOf(entries: readonly SetEntry[], upTo = Infinity): { ev: Event[]; keys: string[]; regions: string[] } {
  const byDate = new Map<string, SetEntry[]>();
  for (const e of entries) {
    if (isCardioEntry(e) || isCardio(e.exercise)) continue;
    const d = byDate.get(e.date);
    if (d) d.push(e); else byDate.set(e.date, [e]);
  }
  const keys: string[] = [], regions: string[] = [], regionOf: number[] = [];
  const lix = new Map<string, number>(), rix = new Map<string, number>();
  const ev: Event[] = [];
  let mornings: Event[] = [];
  const answers = new Map<number, number>();
  const flush = (before: number) => {
    if (!mornings.length) return;
    const due = mornings.filter((x) => x.day < before && x.day <= upTo);
    if (due.length) { ev.push(...due); mornings = mornings.filter((x) => x.day >= before); }
  };
  for (const date of [...byDate.keys()].sort()) {
    const day = dayOf(date);
    flush(day + 1); // the mornings after earlier days, this one's included: before its sessions
    const at = new Map<number, Event>();
    for (const e of byDate.get(date)!.sort(byOrderDone)) {
      const k = liftKey(e.exercise);
      let l = lix.get(k);
      if (l === undefined) {
        l = keys.length; lix.set(k, l); keys.push(k);
        const r = likelyRegion(e.exercise);
        let ri = rix.get(r);
        if (ri === undefined) { ri = regions.length; rix.set(r, ri); regions.push(r); }
        regionOf.push(ri);
      }
      let x = at.get(l);
      if (!x) { x = { lift: l, region: regionOf[l], day, y: 0 }; at.set(l, x); ev.push(x); }
      if (e.flags.includes('pain')) {
        x.y = 1;
        const y = e.morning ? morningY(e) : null;
        if (y != null) answers.set(l, Math.max(answers.get(l) ?? 0, y));
      }
    }
    if (answers.size) {
      for (const [l, y] of answers) mornings.push({ lift: l, region: regionOf[l], day: day + 1, y });
      answers.clear();
    }
  }
  flush(Infinity);
  return { ev, keys, regions };
}

export interface PainRisk {
  /** P(the lift hurts at its session on the day), averaged over the grid (b). */
  p: number;
  /** Its SD: how sure that is (a lift with little recent evidence of its own is less sure). */
  sd: number;
  /** P(this lift's rate is above its family's): its own sessions say it hurts more than lifts like it. */
  worse: number;
}
export interface PainFit {
  /** Lift-sessions and those with pain. */
  sessions: number; pains: number;
  /** The person's long-run rate π_P. */
  base: number;
  /** Posterior weight of each half-life (days). */
  h: [number, number][];
  /** Log marginal likelihood of the log under the model (nats), and under his overall rate alone (the flat baseline). */
  logScore: number; flatScore: number;
  /** Each lift-session's predicted p (the posterior-weighted grid) and whether it hurt: for calibration checks. */
  trace: { p: number; y: number }[];
  /** The risk for a lift's session on `date` (on or after the log's last day). */
  risk(exercise: string, date: string): PainRisk;
}

/** The fit (see the header). Pure: the same log gives the same result. `upTo`: as eventsOf (a day number, dayOf). */
export function fitPain(entries: readonly SetEntry[], upTo = Infinity): PainFit {
  const { ev, keys, regions } = eventsOf(entries, upTo);
  const S = ev.length, L = keys.length, R = regions.length;
  // The person's rate before each session, and its log score alone (the flat baseline).
  const piP = new Float64Array(S);
  let A = 0, flat = 0;
  for (let s = 0; s < S; s++) {
    piP[s] = (A + 1) / (s + 2);
    flat += Math.log(ev[s].y ? piP[s] : 1 - piP[s]);
    A += ev[s].y;
  }
  const ll = new Float64Array(NC);
  // Per half-life, before each session: the lift's own faded counts and its family's (the region without the lift); and the
  // faded state after the last session, for predictions.
  const aL = new Float64Array(S), nL = new Float64Array(S), aF = new Float64Array(S), nF = new Float64Array(S);
  const finals: { la: Float64Array; ln: Float64Array; ld: Int32Array; ra: Float64Array; rn: Float64Array; rd: Int32Array }[] = [];
  const perCell = (hi: number, mf: number, mp: number) => (hi * NS + mf) * NS + mp;
  for (let hi = 0; hi < NH; hi++) {
    const la = new Float64Array(L), ln = new Float64Array(L), ld = new Int32Array(L);
    const ra = new Float64Array(R), rn = new Float64Array(R), rd = new Int32Array(R);
    for (let s = 0; s < S; s++) {
      const { lift: l, region: r, day, y } = ev[s];
      const fl = fade(hi, day - ld[l]), fr = fade(hi, day - rd[r]);
      const a = la[l] * fl, n = ln[l] * fl, ar = ra[r] * fr, nr = rn[r] * fr;
      aL[s] = a; nL[s] = n; aF[s] = Math.max(0, ar - a); nF[s] = Math.max(0, nr - n);
      la[l] = a + y; ln[l] = n + 1; ld[l] = day;
      ra[r] = ar + y; rn[r] = nr + 1; rd[r] = day;
    }
    finals.push({ la, ln, ld, ra, rn, rd });
    for (let mf = 0; mf < NS; mf++) for (let mp = 0; mp < NS; mp++) {
      const MF = STRENGTHS[mf], MP = STRENGTHS[mp];
      // The product of predictive probabilities, renormalised into the log now and then (one log per many sessions).
      let acc = 1, sum = 0;
      for (let s = 0; s < S; s++) {
        const pF = (aF[s] + MP * piP[s]) / (nF[s] + MP);
        const p = (aL[s] + MF * pF) / (nL[s] + MF);
        acc *= ev[s].y ? p : 1 - p;
        if (acc < 1e-250) { sum += Math.log(acc); acc = 1; }
      }
      ll[perCell(hi, mf, mp)] = sum + Math.log(acc);
    }
  }
  // Posterior weights (uniform prior over the grid).
  let mx = -Infinity;
  for (let c = 0; c < NC; c++) mx = Math.max(mx, ll[c]);
  const w = new Float64Array(NC);
  let z = 0;
  for (let c = 0; c < NC; c++) { w[c] = Math.exp(ll[c] - mx); z += w[c]; }
  for (let c = 0; c < NC; c++) w[c] /= z;
  const logScore = S ? mx + Math.log(z / NC) : 0;
  const base = (A + 1) / (S + 2);
  const h = HALF_LIVES.map((x, hi) => { let s = 0; for (let mf = 0; mf < NS; mf++) for (let mp = 0; mp < NS; mp++) s += w[perCell(hi, mf, mp)]; return [x, s] as [number, number]; });
  const lix = new Map(keys.map((k, i) => [k, i])), rix = new Map(regions.map((r, i) => [r, i]));

  let trace: { p: number; y: number }[] | null = null;
  // A screen asks for the same lift on the same day many times (every render): each once.
  const asked = new Map<string, PainRisk>();
  const fit: PainFit = {
    sessions: S, pains: A, base, h, logScore, flatScore: flat,
    get trace() {
      if (trace) return trace;
      const p = new Float64Array(S);
      for (let hi = 0; hi < NH; hi++) {
        // The faded counts again for this half-life (the fit kept only the last one's).
        const la = new Float64Array(L), ln = new Float64Array(L), ld = new Int32Array(L), ra = new Float64Array(R), rn = new Float64Array(R), rd = new Int32Array(R);
        for (let s = 0; s < S; s++) {
          const { lift: l, region: r, day, y } = ev[s];
          const fl = fade(hi, day - ld[l]), fr = fade(hi, day - rd[r]);
          const a = la[l] * fl, n = ln[l] * fl, ar = ra[r] * fr, nr = rn[r] * fr;
          for (let mf = 0; mf < NS; mf++) for (let mp = 0; mp < NS; mp++) {
            const wc = w[perCell(hi, mf, mp)];
            if (wc < 1e-9) continue;
            const pF = (Math.max(0, ar - a) + STRENGTHS[mp] * piP[s]) / (Math.max(0, nr - n) + STRENGTHS[mp]);
            p[s] += wc * (a + STRENGTHS[mf] * pF) / (n + STRENGTHS[mf]);
          }
          la[l] = a + y; ln[l] = n + 1; ld[l] = day; ra[r] = ar + y; rn[r] = nr + 1; rd[r] = day;
        }
      }
      return (trace = ev.map((x, s) => ({ p: p[s], y: x.y })));
    },
    risk(exercise, date) {
      const memo = `${liftKey(exercise)}|${date}`;
      const hit = asked.get(memo);
      if (hit) return hit;
      const l = lix.get(liftKey(exercise)), r = rix.get(likelyRegion(exercise));
      const day = dayOf(date);
      let p = 0, m2 = 0, worse = 0;
      for (let hi = 0; hi < NH; hi++) {
        const f = finals[hi];
        const fl = l === undefined ? 0 : fade(hi, day - f.ld[l]), fr = r === undefined ? 0 : fade(hi, day - f.rd[r]);
        const a = l === undefined ? 0 : f.la[l] * fl, n = l === undefined ? 0 : f.ln[l] * fl;
        const ar = r === undefined ? 0 : f.ra[r] * fr, nr = r === undefined ? 0 : f.rn[r] * fr;
        for (let mf = 0; mf < NS; mf++) for (let mp = 0; mp < NS; mp++) {
          const wc = w[perCell(hi, mf, mp)];
          if (wc < 1e-9) continue;
          const pF = (Math.max(0, ar - a) + STRENGTHS[mp] * base) / (Math.max(0, nr - n) + STRENGTHS[mp]);
          const al = a + STRENGTHS[mf] * pF, be = n - a + STRENGTHS[mf] * (1 - pF), t = al + be;
          const pc = al / t;
          p += wc * pc; m2 += wc * (pc * pc + al * be / (t * t * (t + 1)));
          worse += wc * (1 - betaCdf(pF, al, be));
        }
      }
      const out = { p, sd: Math.sqrt(Math.max(0, m2 - p * p)), worse };
      if (asked.size > 500) asked.clear();
      asked.set(memo, out);
      return out;
    },
  };
  return fit;
}

/** The fit, once per log array. */
export const painFit: (entries: readonly SetEntry[]) => PainFit = perLog(fitPain);

/**
 * The risk for a lift's session on `date`, from everything logged up to now on that day: earlier lifts today count (an elbow
 * that hurt on the first lift raises the next elbow lift's risk), later days don't.
 */
export function painRisk(entries: readonly SetEntry[], exercise: string, date: string): PainRisk {
  const log = logBefore(entries, addDays(date, 1));
  // A morning answer counts from its morning on: with none in the log, every day's fit is the one fit.
  if (!answered(log)) return painFit(log).risk(exercise, date);
  const fits = fitsAt(log);
  let fit = fits.get(date);
  if (!fit) { if (fits.size > 8) fits.clear(); fits.set(date, fit = fitPain(log, dayOf(date))); }
  return fit.risk(exercise, date);
}
const answered = perLog((entries) => entries.some((e) => e.flags.includes('pain') && e.morning != null && e.morning !== 'skipped'));
const fitsAt = perLog(() => new Map<string, PainFit>());
