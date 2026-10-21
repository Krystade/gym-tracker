import { addDays } from './analytics';
import { normalizeName } from './ids';
import { isWorking, settingsKey } from './progression';
import { daySets, doneAt } from './stats';
import type { SetEntry } from './types';

// Item 15: supersets noticed from the log alone (no tap makes one). The structure is what it was: lifts going round
// A→B(→C…)→A, the round given up or a lift out of it once its sets are done, a lift swapped in taking over, last session's
// groups carried, "Not a superset" for the day. What changed is how the times are read (learn/switch has the model):
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default, which takes no
// action (here: one that can only withhold a superset, so the app stays with plain rests).
//
// - Every gap at a switch position is weighed, not one gap deciding: λ = ln f_switch(gap) − ln f_rest(gap), his learned switch
//   from that lift to the next against the lift's own rest (learn/switch, b; both log-normal-like: Halfaker et al. 2015, WWW,
//   inter-activity times are a mixture of log-normals). The λs add up over the day's rounds (a sequential test: Wald 1945).
// - Which lift the round rests after isn't known: every place is equally likely (c), so the evidence is their average likelihood
//   ratio (the place marginalised out, not picked to fit). The round's place is then the likeliest.
// - Before the gaps, a group of lifts is a superset with P = (s + π)/(n + 1) (b): s of the n sessions he did all of them in were
//   one (soft, as judged), pooled with his own rate π among every group the structure has offered (Jeffreys' prior, even with
//   none), worth one session (unit information, a: Kass & Wasserman 1995). Last session's group is no different: its history
//   carries it.
// - A group is one when the posterior is over 1/2 (c: each mistake costs one tap or one ignored timer, so neither side is
//   costlier: even odds).
// - A gap says nothing (c) when a set's time is a guess (`enteredAt`: entered late or edited, minute resolution), when it is
//   shorter than the next set itself could take (entered back to back, not done that way: under 2 s a rep, the fast end of a
//   set's 2–4 s a rep, a: Schoenfeld, Ogborn & Krieger 2015, timing.SET_WORK's basis), and when it is over MAX_REST (a break).
//   The set stays in the order, so the structure holds.

/**
 * Lifts done as a superset (three or more: a giant set or circuit), noticed from the log alone: no tap makes one.
 * `lifts`: in round order. A short switch follows each but the last; the full rest follows the last.
 * `live`: still the group for its lifts (false once a lift swapped in has taken over). `after`: each working set done in it,
 * by id, and what followed it: the lift to switch to, or null where the round was done and a full rest was due.
 * `p`: how likely it is a superset, by the day's gaps so far (over 1/2, or it isn't one).
 */
export interface Superset { lifts: string[]; keys: string[]; live: boolean; after: Map<string, string | null>; p: number }

/** A group from last session, in its round order, to start today with. */
export interface Carried { lifts: string[]; keys: string[] }

/** One gap's evidence on a day: ln f_switch − ln f_rest for `seconds` from a set of `from` to one of `to` (learn/switch). */
export interface DayPace { llr(from: string, to: string, seconds: number): number }
/** The gap model a day is read with (learn/switch fits his; `coldGaps` is research alone). */
export interface GapModel {
  /** The day's reading, given its own rests so far (same lift, set to set; informative only): a slow day reads slow. */
  day(rests: readonly Gap[]): DayPace;
  /** P(these lifts, by key, are a superset) before the day's gaps: their history pooled with his rate. */
  prior(keys: readonly string[]): number;
}
/** A gap between two timed working sets, s. */
export interface Gap { from: string; to: string; seconds: number }

/** (c) A gap over this is a break, not a rest (as for a lift's own sets in timing.ts): it ends a round's run and says nothing. */
export const MAX_REST = 10 * 60;
/** (c) How far back last session's groups carry: a lift set not done together in this long starts over (a gate: only withholds). */
export const CARRY_DAYS = 56;
/** (a) The fast end of a set's 2–4 s a rep (Schoenfeld, Ogborn & Krieger 2015; timing.SET_WORK), and SET_WORK's ~10 reps. */
const REP_FAST = 2, SET_REPS = 10;

const secs = (e: SetEntry) => doneAt(e) / 1000;
const key = (e: SetEntry) => settingsKey(e.exercise);

/** A gap that says something: both times real, at least the next set's own time (a hold's, its seconds), and not a break. */
export function informative(a: SetEntry, b: SetEntry): boolean {
  if (a.enteredAt || b.enteredAt) return false;
  const g = secs(b) - secs(a), reps = b.reps ?? SET_REPS;
  return g >= (b.flags.includes('hold') ? reps : REP_FAST * reps) && g <= MAX_REST;
}

/** A day's timed working sets, in the order done: what a superset is read from. Warm-ups neither make one nor break one. */
export const timedWorking = (entries: readonly SetEntry[], date: string): SetEntry[] =>
  daySets(entries, date).filter((e) => e.loggedAt && isWorking(e)).sort((a, b) => secs(a) - secs(b));

/** The day's rests: each informative gap from a set to the next set of the same lift. */
export function restsOf(day: readonly SetEntry[]): Gap[] {
  const out: Gap[] = [];
  for (let i = 1; i < day.length; i++) {
    if (key(day[i]) === key(day[i - 1]) && informative(day[i - 1], day[i])) out.push({ from: day[i - 1].exercise, to: day[i].exercise, seconds: secs(day[i]) - secs(day[i - 1]) });
  }
  return out;
}

const logit = (p: number) => Math.log(p / (1 - p));
const logMeanExp = (xs: readonly number[]) => { const m = Math.max(...xs); return m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0) / xs.length); };

interface Cycle { keys: string[]; names: string[]; start: number; end?: number }

/**
 * The lifts from `day[i]` until its lift comes back: all different, at least two, no break between them. Only the order: what
 * the times say is weighed after (`judge`).
 */
function cycleAt(day: readonly SetEntry[], i: number): { keys: string[]; names: string[] } | null {
  const keys = [key(day[i])];
  let j = i + 1;
  for (; j < day.length && key(day[j]) !== keys[0]; j++) {
    if (keys.includes(key(day[j]))) return null;
    keys.push(key(day[j]));
  }
  if (j >= day.length || keys.length < 2) return null;
  for (let g = i; g < j; g++) if (secs(day[g + 1]) - secs(day[g]) > MAX_REST) return null;
  return { keys, names: day.slice(i, j).map((e) => normalizeName(e.exercise)) };
}

/**
 * What follows each working set of a group, round by round. A round is done once every lift still in it has a set; a lift
 * is out of it once its planned sets are done, or when a round is given up (a lift comes again before the others had a turn).
 */
function rounds(day: readonly SetEntry[], c: Cycle, planned: (exercise: string) => number | null | undefined): Map<string, string | null> {
  const after = new Map<string, string | null>(), count = new Map<string, number>(), dropped = new Set<string>();
  const needed = () => c.keys.filter((k, i) => {
    const p = planned(c.names[i]);
    return !dropped.has(k) && !(p != null && (count.get(k) ?? 0) >= p);
  });
  let cur: string[] = [];
  for (const s of day.slice(c.start, c.end)) {
    const k = key(s);
    if (!c.keys.includes(k)) continue;
    if (cur.includes(k)) { for (const y of needed()) if (!cur.includes(y)) dropped.add(y); cur = []; }
    count.set(k, (count.get(k) ?? 0) + 1);
    dropped.delete(k);
    cur.push(k);
    const missing = needed().filter((y) => !cur.includes(y));
    if (!missing.length) { after.set(s.id, null); cur = []; continue; }
    const at = c.keys.indexOf(k);
    const next = c.keys.map((_, d) => (at + 1 + d) % c.keys.length).find((x) => missing.includes(c.keys[x]))!;
    after.set(s.id, c.names[next]);
  }
  return after;
}

/** The group's switches: where a switch was due and the next set was another of its lifts, by an informative gap. */
export function switchesOf(day: readonly SetEntry[], keys: readonly string[], after: ReadonlyMap<string, string | null>): Gap[] {
  const out: Gap[] = [];
  for (let i = 0; i + 1 < day.length; i++) {
    if (after.get(day[i].id) == null) continue;
    const b = day[i + 1], kb = key(b);
    if (kb === key(day[i]) || !keys.includes(kb) || !informative(day[i], b)) continue;
    out.push({ from: day[i].exercise, to: b.exercise, seconds: secs(b) - secs(day[i]) });
  }
  return out;
}

/** Σλ over a group's switches: the day's evidence that they were switches and not rests. */
const evidence = (pace: DayPace, sw: readonly Gap[]) => sw.reduce((a, g) => a + pace.llr(g.from, g.to, g.seconds), 0);

/**
 * The day's own sets go against a group not seen today: where a switch was due, the next set was the same lift again or one
 * outside the group (done separately). That is the order alone; how long the switches took is weighed as evidence.
 */
function broken(day: readonly SetEntry[], c: Cycle, after: Map<string, string | null>): boolean {
  for (let i = 0; i + 1 < day.length; i++) {
    if (after.get(day[i].id) == null) continue;
    const next = key(day[i + 1]);
    if (next === key(day[i]) || !c.keys.includes(next)) return true;
  }
  return false;
}

/** Each place a group's round could rest: the gaps where it then switches (by index k: set k to k + 1), and their λ (`l`). */
export interface Turn { sw: number[]; l: number }
/**
 * A group of lifts judged on a day: its keys, P(superset) by the day's gaps, the likeliest round and its switches, and every
 * place the round could rest (for the fit's E-step, learn/switch).
 */
export interface Judged { keys: string[]; p: number; c: Cycle; after: Map<string, string | null>; switches: Gap[]; dismissed: boolean; turns: Turn[] }

interface Place { c: Cycle; after: Map<string, string | null>; switches: Gap[]; sw: number[] }
/** A group the day's order offers from set `i`, and (once asked) each place its round's rest could take. */
interface Offer { i: number; keys: string[]; names: string[]; id: string; turns?: Place[] }
/** What a day's order offers, worked out once: a fit reads the same day again each round (learn/switch). */
export interface DayOffers { day: readonly SetEntry[]; planned: (exercise: string) => number | null | undefined; offers: Offer[] }
export function offersOf(day: readonly SetEntry[], planned: (exercise: string) => number | null | undefined = () => null): DayOffers {
  const offers: Offer[] = [];
  for (let i = 0; i < day.length; i++) {
    const s = cycleAt(day, i);
    if (s) offers.push({ i, ...s, id: [...s.keys].sort().join('\u0000') });
  }
  return { day, planned, offers };
}
// Each place the round's rest could take: the round starting after it.
function turnsOf(o: DayOffers, f: Offer) {
  return (f.turns ??= f.keys.map((_, r) => {
    const turn = <T,>(xs: T[]) => [...xs.slice(r), ...xs.slice(0, r)];
    const c: Cycle = { keys: turn(f.keys), names: turn(f.names), start: f.i + r };
    const after = rounds(o.day, c, o.planned), sw: number[] = [];
    // Where a switch was due and the next set was another of its lifts, by an informative gap (as switchesOf).
    for (let k = 0; k + 1 < o.day.length; k++) {
      const a = o.day[k], b = o.day[k + 1], kb = key(b);
      if (after.get(a.id) != null && kb !== key(a) && c.keys.includes(kb) && informative(a, b)) sw.push(k);
    }
    const switches = sw.map((k) => ({ from: o.day[k].exercise, to: o.day[k + 1].exercise, seconds: secs(o.day[k + 1]) - secs(o.day[k]) }));
    return { c, after, switches, sw };
  }));
}

/**
 * Every group the day's order offers, each judged once (from where it first comes round, by all its rounds that day: a later
 * start can't pick the rounds that fit), and those over even odds as the day's groups. A group inside one found is the same
 * group; a lift swapped in partway takes over from the old.
 */
export function judgeDay(day: readonly SetEntry[] | DayOffers, model: GapModel, pace: DayPace,
  { dismissed = [], planned = () => null }: { dismissed?: string[][]; planned?: (exercise: string) => number | null | undefined } = {}): { judged: Judged[]; found: (Cycle & { p: number })[] } {
  const o = 'offers' in day ? day : offersOf(day, planned);
  const found: (Cycle & { p: number })[] = [], judged: Judged[] = [], seen = new Set<string>();
  for (const f of o.offers) {
    if (seen.has(f.id)) continue;
    const within = (keys: string[]) => f.keys.every((k) => keys.includes(k));
    const live = found.filter((x) => x.end == null);
    if (live.some((x) => within(x.keys))) continue; // the same group again, or part of it
    seen.add(f.id);
    let best: Judged | null = null, top = -Infinity;
    const ls: number[] = [], turns: Turn[] = [];
    for (const t of turnsOf(o, f)) {
      const l = evidence(pace, t.switches);
      ls.push(l);
      turns.push({ sw: t.sw, l });
      if (l > top) { top = l; best = { keys: t.c.keys, p: 0, c: t.c, after: t.after, switches: t.switches, dismissed: false, turns }; }
    }
    const dis = dismissed.some(within);
    const odds = logit(model.prior(f.keys)) + logMeanExp(ls);
    best!.p = dis ? 0 : 1 / (1 + Math.exp(-odds));
    best!.dismissed = dis;
    judged.push(best!);
    if (dis || !(odds > 0)) continue;
    // A lift swapped in partway: the new group takes over from the old.
    for (const x of live) if (x.keys.some((k) => best!.c.keys.includes(k))) x.end = best!.c.start;
    found.push({ ...best!.c, p: best!.p });
  }
  return { judged, found };
}

/**
 * The day's supersets: working sets with a time, in the order done, where the lifts go round A→B(→C…)→A and the gaps read as
 * switches more than as rests (`model`: learn/switch's fit as of the days before; with no log, research alone). Warm-ups don't count; moving
 * on to the next lift never comes back round, so it isn't one. A group is judged by all its rounds that day, so it can come and
 * go as the day goes on; by the day's end Today and History agree. `dismissed`: groups (by lift key) marked "Not a superset"
 * that day; a group inside one stays out too. `planned(exercise)`: its sets planned today. `carried`: last session's groups
 * (`lastSupersets`), newest first, in force from the day's first set while their history and the day's switches hold them over
 * even odds and until the day's own order goes against one or finds a group with any of its lifts; one at a time per lift.
 */
export function supersets(entries: readonly SetEntry[], date: string, model: GapModel,
  { dismissed = [], planned = () => null, carried = [] }: { dismissed?: string[][]; planned?: (exercise: string) => number | null | undefined; carried?: Carried[] } = {}): Superset[] {
  const day = timedWorking(entries, date);
  const pace = model.day(restsOf(day));
  const { found } = judgeDay(day, model, pace, { dismissed, planned });
  const own = found.map((c) => ({ lifts: c.names, keys: c.keys, live: c.end == null, after: rounds(day, c, planned), p: c.p }));
  const held: Superset[] = [];
  for (const g of carried) {
    const c: Cycle = { keys: g.keys, names: g.lifts, start: 0 };
    const meets = (keys: string[]) => keys.some((k) => c.keys.includes(k));
    if (dismissed.some((d) => c.keys.every((k) => d.includes(k))) || found.some((f) => meets(f.keys)) || held.some((h) => meets(h.keys))) continue;
    const after = rounds(day, c, planned);
    if (broken(day, c, after)) continue;
    const odds = logit(model.prior(c.keys)) + evidence(pace, switchesOf(day, c.keys, after));
    if (odds > 0) held.push({ lifts: c.names, keys: c.keys, live: true, after, p: 1 / (1 + Math.exp(-odds)) });
  }
  return [...own, ...held];
}

/**
 * Last session's supersets, to start today's with: going back from `date` (8 weeks at most), each day's groups still in
 * force at its end, where that day was the last with a working set of every lift in the group. A session since with them
 * all and no such group (done separately, or without times) carries nothing. Only groups whose lifts are all in `lifts`
 * (today's session: its cards and planned lifts). `dismissedOn(date)`: that day's "Not a superset" groups. Newest first.
 * Whether one is in force today is its history's (`model.prior`) and today's switches' (supersets).
 */
export function lastSupersets(entries: readonly SetEntry[], date: string, model: GapModel,
  { lifts, dismissedOn = () => [] }: { lifts: string[]; dismissedOn?: (date: string) => string[][] }): Carried[] {
  const from = addDays(date, -CARRY_DAYS), today = new Set(lifts.map(settingsKey));
  const days = new Map<string, SetEntry[]>();
  for (const e of entries) if (e.date >= from && e.date < date) { const d = days.get(e.date); if (d) d.push(e); else days.set(e.date, [e]); }
  const out: Carried[] = [], since: Set<string>[] = [];
  for (const d of [...days.keys()].sort().reverse()) {
    const day = days.get(d)!;
    for (const g of supersets(day, d, model, { dismissed: dismissedOn(d) })) {
      if (g.live && g.keys.every((k) => today.has(k)) && !since.some((s) => g.keys.every((k) => s.has(k)))) out.push({ lifts: g.lifts, keys: g.keys });
    }
    since.push(new Set(day.filter(isWorking).map(key)));
  }
  return out;
}

/** What follows the set `id`: the lift to switch to, null for the full rest after a round, undefined when it's in no superset. */
export const nextAfter = (groups: Superset[], id: string): string | null | undefined => groups.find((g) => g.after.has(id))?.after.get(id);

/** "A", "A and B", "A, B and C". */
export const andList = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
