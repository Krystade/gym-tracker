import { addDays } from './analytics';
import { muscleVector } from './muscles';
import { isWorking, settingsKey } from './progression';
import { doneAt } from './stats';
import { supersets, type GapModel } from './superset';
import { overlap } from './learn/tags';
import type { SetEntry } from './types';

// Suggested supersets (owner, 2026-11-22, the mockup's option A): pairs of today's planned lifts with little muscle overlap that
// he has actually done as a superset at this gym (never another gym's: the machines and the walk between them are that gym's),
// grouped in the plan under one bracket. Which goes first alternates from session to session, so the order's own effect can be
// learned (shrunk to 0 until the sessions show one). The time it saves is shown only once his own timed supersets back it.
//
// Evidence labels: (b) learned from his log, by the method named; (c) a neutral default.

/** (c) How far back a pair's history is read: a year. */
export const PAIR_DAYS = 365;
/** (c) Two lifts overlap too much to pair when either loads over this share of the other's muscles (learn/tags overlap). */
export const MAX_OVERLAP = 0.25;
/** (c) Timed superset sessions of the pair before "saves ~N min" is shown. */
export const TIMED_MIN = 3;
/** (c) The order effect's shrinkage: worth this many sessions of no effect (a pair done 4 times each way is halfway to its own). */
export const ORDER_K = 4;
/** (c) An order effect (reps a set, shrunk) at least this big picks the order; under it, the order alternates. */
export const ORDER_PICK = 0.5;

/** A pair's id: its two lift keys, sorted. */
export const pairId = (a: string, b: string): string => [settingsKey(a), settingsKey(b)].sort().join('\u0000');

/** One session he did the pair as a superset: its date, the lift key that went first, and how its sets went. */
export interface PairSession {
  date: string; first: string;
  /** Mean over the pair's working sets with a target of reps less the target: how the session went (null without targets). */
  vsTarget: number | null;
  /** Median time (s) from a set of one of the lifts to its next set, inside the superset: a round, switch and rest included. */
  round: number | null;
}
export interface PairHistory { id: string; keys: [string, string]; names: [string, string]; sessions: PairSession[] }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Lifts that load much the same muscles (either way round): never paired. */
export const lowOverlap = (a: string, b: string): boolean => {
  const va = muscleVector(a), vb = muscleVector(b);
  if (!va || !vb) return false;
  return Math.max(overlap(va, vb), overlap(vb, va)) <= MAX_OVERLAP;
};

/**
 * Every pair he has done as a superset (learn/switch's reading of each day, `model`) at `gym` in the year before `date`: a day
 * counts for the gym only when every set of both lifts that day was logged there. Three-lift groups don't make pairs.
 */
export function pairHistory(entries: readonly SetEntry[], date: string, model: GapModel, gym: string | undefined): Map<string, PairHistory> {
  const from = addDays(date, -PAIR_DAYS);
  const days = new Map<string, SetEntry[]>();
  for (const e of entries) if (e.date >= from && e.date < date) { const d = days.get(e.date); if (d) d.push(e); else days.set(e.date, [e]); }
  const out = new Map<string, PairHistory>();
  for (const [d, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    for (const g of supersets(day, d, model)) {
      if (g.keys.length !== 2) continue;
      const sets = day.filter((e) => isWorking(e) && g.keys.includes(settingsKey(e.exercise)));
      if (!sets.length || sets.some((e) => e.gym !== gym)) continue;
      const timed = sets.filter((e) => e.loggedAt).sort((a, b) => doneAt(a) - doneAt(b));
      if (!timed.length) continue;
      const first = settingsKey(timed[0].exercise);
      const scored = sets.filter((e) => e.target && e.reps != null);
      // A round: each lift's set to its own next set, with the partner's set and the switch between (the superset's whole cycle).
      const rounds: number[] = [];
      for (const k of g.keys) {
        const own = timed.filter((e) => settingsKey(e.exercise) === k);
        for (let i = 1; i < own.length; i++) if (!own[i].enteredAt && !own[i - 1].enteredAt) rounds.push((doneAt(own[i]) - doneAt(own[i - 1])) / 1000);
      }
      const id = pairId(g.keys[0], g.keys[1]);
      const h = out.get(id) ?? { id, keys: [g.keys[0], g.keys[1]] as [string, string], names: [g.lifts[0], g.lifts[1]] as [string, string], sessions: [] };
      h.sessions.push({ date: d, first, vsTarget: scored.length ? mean(scored.map((e) => e.reps! - e.target!.reps)) : null, round: rounds.length ? median(rounds) : null });
      out.set(id, h);
    }
  }
  return out;
}

/**
 * The order effect (b): how much better (reps a set against the targets) the sessions with `keys[0]` first went than those with
 * `keys[1]` first, shrunk to 0 by ORDER_K sessions of no effect (`n`: the sessions with a score each way). 0 until both orders
 * have a scored session.
 */
export function orderEffect(h: PairHistory): { effect: number; n: number } {
  const a = h.sessions.filter((s) => s.first === h.keys[0] && s.vsTarget != null).map((s) => s.vsTarget!);
  const b = h.sessions.filter((s) => s.first === h.keys[1] && s.vsTarget != null).map((s) => s.vsTarget!);
  if (!a.length || !b.length) return { effect: 0, n: 0 };
  // The effective count of a difference of two means: the harmonic mean's half (a·b / (a + b)).
  const n = (a.length * b.length) / (a.length + b.length);
  return { effect: (mean(a) - mean(b)) * (n / (n + ORDER_K)), n: a.length + b.length };
}

/** A pair suggested for today: its lifts in today's order, what went first last time, and the minutes it saves (null: unproven). */
export interface PairPlan {
  id: string; keys: [string, string];
  /** Today's order, by the names in the plan. */
  lifts: [string, string];
  /** The lift that went first last time, by its name in the plan. */
  lastFirst: string;
  /** Why this order: alternating from last time, his own order effect, or his swap. */
  why: 'alternate' | 'effect' | 'swapped';
  /** The order effect, reps a set, when it picked the order. */
  effect?: number;
  /** Minutes saved against doing them straight, from his own timed supersets (TIMED_MIN or more), else null. */
  saves: number | null;
}

/**
 * Today's suggested pairs among `lifts` (today's planned lifts left to do, in plan order; `sets(name)`: each one's planned
 * sets), from `history` (pairHistory at today's gym): low overlap, done together before; each lift in one pair at most, the
 * pairs done most often first. `straight(name)`: his usual set-to-set time on the lift alone (timing paces), for the time
 * saved. `swapped`: today's order where he swapped it (pair id → the lift key to go first). `skip`: pair ids not wanted today.
 */
export function pairsFor(lifts: readonly string[], history: ReadonlyMap<string, PairHistory>, o: {
  sets: (name: string) => number; straight?: (name: string) => number | null | undefined;
  swapped?: Readonly<Record<string, string>>; skip?: ReadonlySet<string>;
}): PairPlan[] {
  const cands: { h: PairHistory; a: string; b: string }[] = [];
  for (let i = 0; i < lifts.length; i++) for (let j = i + 1; j < lifts.length; j++) {
    const h = history.get(pairId(lifts[i], lifts[j]));
    if (h && !o.skip?.has(h.id) && lowOverlap(lifts[i], lifts[j])) cands.push({ h, a: lifts[i], b: lifts[j] });
  }
  cands.sort((x, y) => y.h.sessions.length - x.h.sessions.length || lifts.indexOf(x.a) - lifts.indexOf(y.a));
  const used = new Set<string>(), out: PairPlan[] = [];
  for (const { h, a, b } of cands) {
    if (used.has(settingsKey(a)) || used.has(settingsKey(b))) continue;
    used.add(settingsKey(a)); used.add(settingsKey(b));
    const name = (k: string) => (settingsKey(a) === k ? a : b);
    const last = h.sessions.at(-1)!;
    const other = (k: string) => (k === h.keys[0] ? h.keys[1] : h.keys[0]);
    const eff = orderEffect(h);
    let first: string, why: PairPlan['why'];
    const mine = o.swapped?.[h.id];
    if (mine && (mine === h.keys[0] || mine === h.keys[1])) { first = mine; why = 'swapped'; }
    else if (Math.abs(eff.effect) >= ORDER_PICK) { first = eff.effect > 0 ? h.keys[0] : h.keys[1]; why = 'effect'; }
    else { first = other(last.first); why = 'alternate'; }
    out.push({ id: h.id, keys: h.keys, lifts: [name(first), name(other(first))], lastFirst: name(last.first), why,
      ...(why === 'effect' && { effect: Math.abs(eff.effect) }), saves: savesOf(h, a, b, o) });
  }
  return out;
}

/**
 * Minutes a superset of a and b saves (b): done straight, each set is followed by its own usual set-to-set time; as a superset,
 * a round of both takes his median round. Saved: (straight a + straight b − round) a round, over the rounds planned (the fewer
 * sets of the two). Null until TIMED_MIN timed sessions of the pair, without both straight times, or under a minute.
 */
function savesOf(h: PairHistory, a: string, b: string, o: { sets: (name: string) => number; straight?: (name: string) => number | null | undefined }): number | null {
  const rounds = h.sessions.map((s) => s.round).filter((x): x is number => x != null);
  if (rounds.length < TIMED_MIN) return null;
  const sa = o.straight?.(a), sb = o.straight?.(b);
  if (sa == null || sb == null) return null;
  const n = Math.min(o.sets(a), o.sets(b));
  const mins = Math.round((n * (sa + sb - median(rounds))) / 60);
  return mins >= 1 ? mins : null;
}
