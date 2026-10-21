import { addDays, SESSION_CAP, weekStart, weeklyMuscleSets } from '../analytics';
import type { BodyDay } from '../body';
import { isCardioEntry } from '../cardio';
import { liftKey } from '../ids';
import { MUSCLES, muscleVector, type Muscle } from '../muscles';
import { persistentPain } from '../painPlan';
import { targetFor, type Profile } from '../profile';
import type { SetEntry } from '../types';
import type { Est } from './capacity';
import { energyOf, isLight, P_STAR, scaleOf, systemic, type Systemic } from './deload';
import { normCdf } from './num';
import { pool } from './pool';
import { coreFor } from './rest';
import { liftSimilarity } from './tags';

// Item 07: sets per muscle per week (00-core §5). Each muscle is steered toward its priority's weekly range (the targets on Stats,
// fitted to his week or set by hand) a step at a time, and only while he is recovering. Nothing here reacts to a stall: no study
// tests a volume change triggered by one (00-core §5), and stalls are rotation's (item 12). This file never reads stall().
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default, which takes no action.
//
// - His volume (b): a muscle's fractional sets a week (a: Pelland 2026, Sports Med 56:481, fractional counting fitted best; an
//   indirect set ½), each session counting at most SESSION_CAP (a: Remmert), over the last BASE_WEEKS whole weeks (a: Barsuhn
//   2025's 3-week log of previous volume). A week with no session is a break, not the volume he trains at (a: Coleman 2024, a week
//   off is a deload), and a week with a light week's sets in it isn't his volume either (item 06): both are left out.
// - Below its range: more sets grow more, with diminishing returns and no clear plateau below ~20 a week (a: Pelland 2026). The
//   step is +20 % of his own volume (a: Scarpelli 2022, JSCR 36:1153, 1.2× each person's own logged weekly sets grew more than a
//   fixed standard), never more (a: Barsuhn 2025, J Appl Physiol 138:259, +30 % and +60 % added nothing over keeping his volume),
//   and never past the range's low end or SESSION_CAP a session (a: Remmert). Rounded down to the half set, the counting's own
//   resolution (a: Pelland, an indirect set ½), so the step never exceeds 20 %; a step under half a set can't show in his count
//   (within half a set of the range, or 20 % of under 2.5 sets): nothing to add.
// - In or above its range: hold. More added nothing in trained lifters already there (a: Barsuhn 2025; Aube 2022, JSCR, PubMed
//   32058362: 12, 18 and 24 sets alike), and no cut is made of 07's own (below).
// - Recovering, or held (a raise is offered only when nothing says he isn't):
//   - a light week is suggested (06's deload: performance down across lifts with low energy or pain: 00-core's "cut only on
//     regression + fatigue or pain") or on: held, and 07 makes no cut of its own; the light week is the cut (no double reaction);
//   - down across lifts without a second signal (06's 'alone'): held (a: Grandou 2020, Sports Med 50:815, a sustained decrease in
//     performance is the marker of overreaching; adding load to it isn't recovering);
//   - his energy below his usual (b, as 06 reads it): held (a: Saw 2016, BJSM 50:281, subjective well-being worsens with load);
//   - the muscle's own lifts down (b): its share-weighted fatigue-adjusted shift (06's per-lift readings: a late or pre-fatigued
//     set isn't read as lost strength, a set stopped at its target or in a light week is a lower bound, a layoff widens the
//     reference; pooled person → family → lift, the muscle's lifts' shared parts counted once) has P(decline) > ½, the even-odds
//     Savage–Dickey posterior as in 06 (a: the same cost ratio: a needless hold costs nothing measurable, Barsuhn 2025);
//   - a lift that trains it directly likelier than not to hurt next time (b: item 08's learned risk ≥ ½, and it hurt lately): held
//     (a: Silbernagel 2007, AJSM 35:897, load progresses only while pain stays acceptable).
//   A week off just now (06's 'break') unloaded him (a: Coleman 2024): the readings before it no longer hold a raise back.
// - Never: a cut of its own, a reaction to a stall, a new input. Every raise is an offer on Stats, never applied by itself.

/** (a) Barsuhn 2025: previous weekly volume from a 3-week training log. */
export const BASE_WEEKS = 3;
/** (a) Scarpelli 2022: +20 % of his own weekly sets; Barsuhn 2025: more than that added nothing. */
export const STEP = 0.2;

const isSession = (e: SetEntry) => !e.flags.includes('warmup') && !isCardioEntry(e);
/** (a) The counting's resolution: an indirect set counts ½ (Pelland 2026). */
const HALF = 0.5;
const floorHalf = (x: number) => Math.floor(x / HALF + 1e-9) * HALF;

export type Why = 'deload' | 'light' | 'down' | 'energy' | 'decline' | 'pain';
export interface MuscleVolume {
  muscle: Muscle;
  /** (b) His fractional sets a week over the counted weeks; null with none counted. */
  base: number | null;
  /** The muscle's weekly range (its priority's, as Stats shows it). */
  band: [number, number];
  /**
   * 'raise': `aim` a week next (base below the range, recovering). 'hold': the same raise held back, `why`. 'met': in its range.
   * 'over': above it (no cut). 'none': nothing to step from (no volume counted), or a step under half a set.
   */
  kind: 'raise' | 'hold' | 'met' | 'over' | 'none';
  /** The step's weekly sets (on a raise or a hold). */
  aim: number | null;
  why?: Why;
  /** Its lifts' pooled shift (ln e1RM) and P(decline), when its lifts have readings in the stretch. */
  decline?: { p: number; shift: Est };
  /** The lift that hurts (why 'pain'). */
  lift?: string;
}
export interface VolumeAdvice {
  /** The whole weeks counted (oldest first), of the last BASE_WEEKS; and his sessions a week over them. */
  weeks: string[]; sessions: number;
  /** Item 06's verdict on today, and his energy against his usual when it can be read. */
  verdict: Systemic['verdict']; energy: Systemic['energy'];
  muscles: MuscleVolume[];
}

/** Of the last BASE_WEEKS whole weeks before `today`'s, those that count: a lifting session in it and no light set. */
export function countedWeeks(entries: readonly SetEntry[], today: string): string[] {
  const now = weekStart(today), first = addDays(now, -7 * BASE_WEEKS);
  const lifted = new Set<string>(), light = new Set<string>();
  for (const e of entries) {
    if (e.date < first || e.date >= now) continue;
    const w = weekStart(e.date);
    if (isLight(e)) light.add(w);
    else if (isSession(e) && e.reps != null && e.reps > 0) lifted.add(w);
  }
  return Array.from({ length: BASE_WEEKS }, (_, i) => addDays(first, 7 * i)).filter((w) => lifted.has(w) && !light.has(w));
}

const npdf = (x: number, v: number) => Math.exp(-0.5 * x * x / v) / Math.sqrt(2 * Math.PI * v);

/**
 * Each muscle's weekly volume and its next step (see the header) on `today`: `profile` with its fitted targets (as Stats shows them),
 * `body` his energy, `tapped` a light week he started on this phone. Null with no training before today.
 */
export function volumeAdvice(entries: readonly SetEntry[], body: readonly BodyDay[], profile: Profile, today: string, tapped?: { from: string; end?: string } | null): VolumeAdvice | null {
  const s = systemic(entries, body, today, tapped);
  if (!s) return null;
  const weeks = countedWeeks(entries, today);
  const n = weeks.length;
  const base = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  // Each lift's fractional sets for each muscle over the counted weeks: its share of the muscle's volume.
  const share = new Map<string, { name: string; v: Partial<Record<Muscle, number>> }>();
  const days = new Set<string>();
  for (const w of weeks) {
    const sets = weeklyMuscleSets(entries as SetEntry[], w).sets;
    for (const m of MUSCLES) base[m] += sets[m] / n;
    const end = addDays(w, 7);
    for (const e of entries) {
      if (e.date < w || e.date >= end || !isSession(e)) continue;
      const v = muscleVector(e.exercise);
      if (!v) continue;
      days.add(e.date);
      const k = liftKey(e.exercise);
      const x = share.get(k) ?? share.set(k, { name: e.exercise, v: {} }).get(k)!;
      for (const [m, f] of Object.entries(v) as [Muscle, number][]) x.v[m] = (x.v[m] ?? 0) + f;
    }
  }
  const sessions = n ? days.size / n : 0;
  // His energy: 06's, or (with too few lifts for 06 to weigh) the same reading over the window his lifts' recent sessions span.
  const window = s.window ?? (s.lifts.length ? s.lifts.reduce((a, x) => (x.from < a ? x.from : a), s.lifts[0].from) : null);
  const energy = s.energy ?? (window ? energyOf(body, window, today) : null);
  // The muscle's lifts' shifts, pooled person → family → lift as 06 pools them (S: his learned scale of a shift).
  const core = s.lifts.length ? coreFor(entries, today) : null;
  const S = core ? (s.verdict === 'few' ? scaleOf(core, entries, s.since) : s.scale) : 0;
  const pl = core ? pool(s.lifts.map((x) => ({ key: x.key, est: x.d, v: x.sd ** 2 })), liftSimilarity, { mean: 0, personSd: S, liftSd: S }) : null;
  const whole: Why | null = s.verdict === 'deload' ? 'deload' : s.verdict === 'light' ? 'light' : s.verdict === 'alone' ? 'down' : energy?.low ? 'energy' : null;

  const muscles = MUSCLES.map((m): MuscleVolume => {
    const band = targetFor(profile, m);
    const b = n ? base[m] : null;
    let decline: MuscleVolume['decline'];
    if (pl) {
      const ws = s.lifts.map((x) => ({ key: x.key, w: share.get(x.key)?.v[m] ?? 0 })).filter((x) => x.w > 0);
      if (ws.length) {
        const c = pl.combo(ws);
        const bf = npdf(0, c.prior) / npdf(c.mean, c.sd ** 2);
        const pShift = Number.isFinite(bf) ? bf / (1 + bf) : 1;
        decline = { p: pShift * normCdf(-c.mean / c.sd), shift: { mean: c.mean, sd: c.sd } };
      }
    }
    const out = { muscle: m, base: b, band, aim: null, ...(decline && { decline }) };
    if (b == null || b <= 0) return { ...out, kind: 'none' };
    if (b > band[1]) return { ...out, kind: 'over' };
    if (b >= band[0]) return { ...out, kind: 'met' };
    const aim = floorHalf(Math.min(band[0], (1 + STEP) * b, SESSION_CAP * sessions));
    if (aim - b < HALF - 1e-9) return { ...out, kind: 'none' };
    if (whole) return { ...out, aim, kind: 'hold', why: whole };
    if (decline && decline.p > P_STAR) return { ...out, aim, kind: 'hold', why: 'decline' };
    // The lifts a raise would add sets of: those that train it directly (program.candidates).
    for (const x of share.values()) {
      if (muscleVector(x.name)?.[m] !== 1) continue;
      if (persistentPain(entries as SetEntry[], x.name, today)) return { ...out, aim, kind: 'hold', why: 'pain', lift: x.name };
    }
    return { ...out, aim, kind: 'raise' };
  });
  return { weeks, sessions, verdict: s.verdict, energy, muscles };
}

/**
 * What a program plans a muscle at (owner, 2026-10-20: plan at 07's aim, not the band's full range): `plan` [lower, upper] weekly
 * sets for the builder (program.buildProgram aims), where it came from, and `gap` the sets still between it and the band's low end.
 * - 'step' (a): a raise's aim, +20 % of his last 3 weeks (the header's evidence), never the band at once.
 * - 'held' (a): a held raise stays at his own volume (the header's reasons), as does a step too small to count (under half a set).
 * - 'band': in its range, or within half a set of it, or no log to step from (c: a new user gets the range).
 * - 'own': above its range: his own volume, no cut (a: as 'over').
 * - 'start' (c): a muscle he hasn't trained in the 3 weeks: one pair of sets (the builder's unit) to step from, never the band.
 * An excluded priority ([0, 0]) plans nothing.
 */
export interface PlanAim { muscle: Muscle; band: [number, number]; base: number | null; plan: [number, number]; from: 'step' | 'held' | 'band' | 'own' | 'start'; gap: number }
/** (c) The first step for a muscle with no recent volume: one pair (program.ts UNIT). */
export const START_SETS = 2;

export function planAims(a: VolumeAdvice | null, profile: Profile): Record<Muscle, PlanAim> {
  const out = {} as Record<Muscle, PlanAim>;
  for (const m of MUSCLES) {
    const band = targetFor(profile, m), x = a?.muscles.find((v) => v.muscle === m);
    const base = x?.base ?? null;
    const at = (plan: [number, number], from: PlanAim['from']): PlanAim => ({ muscle: m, band, base, plan, from, gap: Math.max(0, band[0] - plan[0]) });
    if (band[1] <= 0) out[m] = at([0, 0], 'band');
    else if (!a || !x) out[m] = at(band, 'band');
    else if (x.kind === 'raise') out[m] = at([x.aim!, x.aim!], 'step');
    else if (x.kind === 'hold') out[m] = at([x.base!, x.base!], 'held');
    else if (x.kind === 'over') out[m] = at([band[0], x.base!], 'own');
    else if (x.kind === 'none' && !(base != null && base > 0)) { const s = Math.min(START_SETS, band[0]); out[m] = at([s, s], 'start'); }
    // A step under half a set: within half a set of the range, the range; else his own volume (never the range at once).
    else if (x.kind === 'none' && base! < band[0] - HALF) out[m] = at([base!, base!], 'held');
    else out[m] = at(band, 'band');
  }
  return out;
}
