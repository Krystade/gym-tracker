import { addDays } from './analytics';
import { likelyRegion, loadsRegion } from './care';
import { painRisk, zoneOf, type Zone } from './learn/pain';
import { daySets, liftSets, sameExercise } from './stats';
import type { Morning, Region, SetEntry } from './types';

// Item 08: what pain allows, on top of the pain-monitoring zones (learn/pain zoneOf, a) and the learned risk of pain (learn/pain,
// b). Not medical advice: these rules describe patterns and training options; they never diagnose (care.ts).
//
// Evidence: (a) Silbernagel 2007 (AJSM 35:897) and Silbernagel & Crossley 2015 (JOSPT 45:876): loading may go on while pain stays
// within 5/10 and doesn't rise from week to week; above 5/10 the load must come down. Load progresses at pain of 3/10 or less
// (the common progression criterion across tendinopathy rehabilitation protocols, Bahiana review in 08 §2.1). Smith 2017 (BJSM
// 51:1679): exercise into acceptable pain did no harm. So mild pain changes nothing, moderate pain holds the lift where it is,
// and sharp pain lowers it.
//
// The 24-hour response and the trend (item 08, round 20). Silbernagel 2007 (AJSM 35:897, the protocol): pain after the activity
// "should have subsided by the following morning"; Silbernagel & Crossley 2015 (JOSPT 45:876, fig. 10, rules 3 and 4): pain the
// next morning not above 5/10, and pain and stiffness not increasing from week to week. So how the region felt the next morning,
// where he said (an optional one-tap question), decides whether last time's load was all right; where he didn't, the trend of the
// pain itself across his sessions at the held load does. A hold is no longer for ever: a trend that isn't falling eases a step.

/**
 * (a) Days a tendon can take to recover from heavy loading (Silbernagel & Crossley 2015: "up to 3 days"; Magnusson, Langberg &
 * Kjaer 2010, Nat Rev Rheumatol 6:262: collagen synthesis stays raised for about 72 h after exercise).
 */
export const SETTLE_DAYS = 3;

/**
 * Why a lift is held or eased. `kind`: hold its weight and reps, or one step lighter. `zone`: the pain behind it; `unknown`: its
 * severity wasn't logged (an import, read as moderate: c, it only holds). `from`/`date`: the lift that hurt and when; `spill`: that
 * was another lift loading the same region.
 */
export interface PainGate {
  kind: 'hold' | 'ease'; zone: Zone; region: Region; from: string; date: string; spill: boolean; unknown: boolean;
  /**
   * The rule behind it, for the words (painWhy). Ease: `sharp` (over 5/10 last time, a), `worse` (worse the next morning, a),
   * `sore-twice` (still sore the next morning after both of the last two sessions at this load or above, a), `again` (the pain
   * no lower than the session before at this load or above, a), `rising` (the region's pain up on the week before, a). Hold:
   * `settled` (moderate, gone by the morning: acceptable, a), `sore` (still sore the next morning, once, a), `moderate` (a),
   * `unknown` (no severity logged: c, it only holds), `spill` (another lift loading the region, a).
   */
  why: 'sharp' | 'worse' | 'sore-twice' | 'again' | 'rising' | 'settled' | 'sore' | 'moderate' | 'unknown' | 'spill';
  /** The load of the session behind it (its heaviest working set). */
  top?: number;
}

const regionOf = (e: SetEntry): Region => e.painRegion ?? likelyRegion(e.exercise);
const unknownOf = (sets: readonly SetEntry[], z: Zone) => !sets.some((e) => e.flags.includes('pain') && e.painSeverity === z);

/** The lift's sets on its last day before `date`, in log order; empty with none. */
function lastDay(entries: readonly SetEntry[], exercise: string, date: string): SetEntry[] {
  let d = '';
  for (const e of liftSets(entries, exercise)) if (e.date < date && e.date > d) d = e.date;
  return d ? liftSets(entries, exercise).filter((e) => e.date === d) : [];
}

/**
 * The answer to the next-morning question on a session's pain sets (all carry the same one; two phones that differ: the worse).
 * `skipped` (dismissed) is no answer: unknown, which changes nothing (c).
 */
export function morningOf(sets: readonly SetEntry[]): Exclude<Morning, 'skipped'> | null {
  let best: Exclude<Morning, 'skipped'> | null = null;
  for (const e of sets) {
    const m = e.flags.includes('pain') ? e.morning : undefined;
    if (!m || m === 'skipped') continue;
    if (!best || STEP[m] > STEP[best]) best = m;
  }
  return best;
}
/** (a) How the next morning moves a session's pain level: settled under it, still sore over it, worse further (Silbernagel 2007). */
const STEP: Record<Exclude<Morning, 'skipped'>, number> = { settled: -1, sore: 1, worse: 2 };

/**
 * A session's pain, as one level for the trend: twice its zone, one down if it settled by the morning, one up if still sore, two if
 * worse (an ordering, c: mild 2, moderate 4, sharp 6; moderate that settled 3, still sore 5). `known`: its size was logged, or he
 * answered the morning question; an import's pain of unknown size with no answer is not (c: it only ever holds).
 */
export function painLevel(sets: readonly SetEntry[]): { level: number; zone: Zone; known: boolean; morning: Exclude<Morning, 'skipped'> | null } {
  const zone = zoneOf(sets), morning = morningOf(sets);
  if (!zone) return { level: 0, zone, known: true, morning };
  const known = morning != null || sets.some((e) => e.flags.includes('pain') && e.painSeverity === zone);
  return { level: 2 * zone + (morning ? STEP[morning] : 0), zone, known, morning };
}

/** The heaviest working set's load (warm-ups and empty sets aside): the load a session was done at. */
const topOf = (sets: readonly SetEntry[]) => {
  const w = sets.filter((e) => !e.flags.includes('warmup') && (e.reps ?? 0) > 0).map((e) => e.weight);
  return w.length ? Math.max(...w) : Math.max(...sets.map((e) => e.weight));
};

/**
 * Another lift's pain, moderate or worse, in a region this lift loads, within SETTLE_DAYS before `date` or earlier on it (a): the
 * most recent. Mild pain is acceptable and spills over to nothing; nor does pain that settled by the next morning (a: Silbernagel
 * 2007, the load was tolerated).
 */
export function spillOver(entries: readonly SetEntry[], exercise: string, date: string): PainGate | null {
  let best: SetEntry | null = null;
  for (let k = SETTLE_DAYS; k >= 0; k--) {
    for (const e of daySets(entries, addDays(date, -k))) {
      if (!e.flags.includes('pain') || (e.painSeverity ?? 2) < 2 || e.morning === 'settled' || sameExercise(e.exercise, exercise) || !loadsRegion(exercise, regionOf(e))) continue;
      best = e;
    }
  }
  return best && { kind: 'hold', zone: 2, region: regionOf(best), from: best.exercise, date: best.date, spill: true, unknown: best.painSeverity == null, why: 'spill' };
}

/** (a) Silbernagel & Crossley 2015 rule 4, the window it's read over: this week against the one before. */
const WEEK = 7;

/**
 * Whether a region's pain is building from week to week (a: Silbernagel & Crossley 2015, rule 4, "pain and stiffness must not
 * increase from week to week"): the worst level (painLevel) over any lift's sessions in the 7 days before `date` above the worst in
 * the 7 before those, which had pain too. Pain of unknown size with no morning answer is left out (c). A first week of pain is
 * not a rise: moderate pain holds (a), it doesn't ease.
 */
export function regionRising(entries: readonly SetEntry[], region: Region, date: string): boolean {
  const worst = [0, 0];
  for (let k = 1; k <= 2 * WEEK; k++) {
    const byLift = new Map<string, SetEntry[]>();
    for (const e of daySets(entries, addDays(date, -k))) {
      if (!e.flags.includes('pain') || regionOf(e) !== region) continue;
      const l = byLift.get(e.exercise.toLowerCase());
      if (l) l.push(e); else byLift.set(e.exercise.toLowerCase(), [e]);
    }
    const w = k <= WEEK ? 0 : 1;
    for (const sets of byLift.values()) {
      const p = painLevel(sets);
      if (p.known) worst[w] = Math.max(worst[w], p.level);
    }
  }
  return worst[1] > 0 && worst[0] > worst[1];
}

/**
 * What last time's pain allows today (a), the next morning (where he answered) and the trend across sessions included:
 * - sharp last time → one step lighter, however the morning was (over 5/10 during is past the acceptable zone);
 * - worse the next morning → one step lighter, mild or not (the morning rule broken, and stiffness up);
 * - mild, not still sore → progression as usual (unless another lift's pain spills over: hold);
 * - moderate that settled by the morning → hold: tolerated, but over the 3/10 that progression waits for;
 * - otherwise (moderate with no answer, or still sore): hold, unless the session before it, at this load or above, hurt no less,
 *   also settling no better: then one step lighter (`sore-twice`, `again`). Both must be known (c: an import's pain of unknown
 *   size only holds). A hold whose region's pain is building week to week eases too (`rising`).
 * Null: no gate.
 */
export function painGate(entries: readonly SetEntry[], exercise: string, date: string): PainGate | null {
  const sets = lastDay(entries, exercise, date);
  const now = painLevel(sets);
  const z = now.zone;
  if (z === 0 || (z === 1 && now.morning !== 'sore' && now.morning !== 'worse')) return spillOver(entries, exercise, date);
  const first = sets.find((e) => e.flags.includes('pain') && (e.painSeverity ?? 2) === z)!;
  const top = topOf(sets);
  const base = { zone: z, region: regionOf(first), from: first.exercise, date: first.date, spill: false, unknown: unknownOf(sets, z), top };
  if (z === 3) return { ...base, kind: 'ease', why: 'sharp' };
  if (now.morning === 'worse') return { ...base, kind: 'ease', why: 'worse' };
  if (now.morning === 'settled') return { ...base, kind: 'hold', why: 'settled' };
  // The session before, if it was done at this load or above.
  const before = lastDay(entries, exercise, sets[0].date);
  const prev = before.length && topOf(before) >= top ? painLevel(before) : null;
  if (now.known && prev && prev.known && prev.zone > 0 && prev.morning !== 'settled' && now.level >= prev.level) {
    return { ...base, kind: 'ease', why: now.morning === 'sore' && prev.morning === 'sore' ? 'sore-twice' : 'again' };
  }
  const hold: PainGate = { ...base, kind: 'hold', why: now.morning === 'sore' ? 'sore' : now.known ? 'moderate' : 'unknown' };
  return now.known && regionRising(entries, base.region, date) ? { ...hold, kind: 'ease', why: 'rising' } : hold;
}

const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
/**
 * The words for a gate on the target: the rule's reason, then what it does. `how`: the target holds, or eases by load, by help (an
 * assisted bodyweight lift) or by a rep a set (item 14). `load`: the held load as the target says it ("110 lb").
 */
export function painWhy(g: PainGate, how: 'hold' | 'load' | 'help' | 'reps', load: string): string {
  if (g.spill) return `${cap(g.region)} hurt on ${g.from} lately: hold for now`;
  if (how !== 'hold') return `${lead(g)}: ${how === 'reps' ? 'one rep fewer a set' : how === 'help' ? 'a step more help' : 'one step lighter'}`;
  switch (g.why) {
    case 'settled': return `Pain settled overnight: holding ${load}`;
    case 'sore': return `Still sore next morning: holding ${load}`;
    case 'unknown': return 'Pain last time: hold until it’s mild or gone';
    case 'moderate': return 'Moderate pain last time: hold until it’s mild or gone';
    // An ease with nothing to take off (a hold lift, at bodyweight with no help known): held.
    case 'sharp': return 'Sharp pain last time: hold, or go lighter';
    default: return `${lead(g)}: holding ${load}`;
  }
}
function lead(g: PainGate): string {
  switch (g.why) {
    case 'sharp': return 'Sharp pain last time';
    case 'worse': return 'Worse next morning';
    case 'sore-twice': return 'Still sore next morning, twice';
    case 'again': return `${g.zone === 1 ? 'Pain' : 'Moderate pain'} twice at this weight`;
    case 'rising': return `${cap(g.region)} pain building week to week`;
    default: return 'Pain last time';
  }
}

/** The worst pain on this lift so far on `date`, with its region; null with none. Sharp (zone 3) is past the acceptable zone (a). */
export function painToday(entries: readonly SetEntry[], exercise: string, date: string): { zone: Zone; region: Region } | null {
  const today = liftSets(entries, exercise).filter((e) => e.date === date);
  const z = zoneOf(today);
  if (!z) return null;
  return { zone: z, region: regionOf(today.find((e) => e.flags.includes('pain') && (e.painSeverity ?? 2) === z)!) };
}

/** (c) How many of the lift's latest sessions the prompt counts, for its words only. */
const SHOWN = 5;

/**
 * A lift likelier than not to hurt at its next session (b: learn/pain's risk ≥ ½, the point where hurting is the likelier
 * outcome): with how many of its last few sessions hurt, for the words. Null below ½, or when none of those hurt. Display only.
 */
export function persistentPain(entries: readonly SetEntry[], exercise: string, date: string): { p: number; hurt: number; of: number } | null {
  const risk = painRisk(entries, exercise, date);
  if (!(risk.p >= 0.5)) return null;
  const days = [...new Set(liftSets(entries, exercise).filter((e) => e.date <= date).map((e) => e.date))].sort().slice(-SHOWN);
  const hurt = days.filter((d) => liftSets(entries, exercise).some((e) => e.date === d && e.flags.includes('pain'))).length;
  // Only a lift that hurt lately itself: with no pain of its own the risk is its family's or the prior's (½ on an empty log).
  return hurt ? { p: risk.p, hurt, of: days.length } : null;
}

/** (a) NHS (tennis elbow; the same advice for other joint pain): see a GP if it is still painful after 2 weeks of self-care. */
const NHS_DAYS = 14;

/**
 * Regions that have hurt on and off for NHS_DAYS or more (a): pain logged on days no more than NHS_DAYS apart, spanning at least
 * NHS_DAYS, the latest within NHS_DAYS of today. `since`: the episode's first pain; `weeks`: whole weeks from it to today.
 * Display only, and never a diagnosis.
 */
export function lingering(entries: readonly SetEntry[], today: string): { region: Region; since: string; weeks: number }[] {
  const by = new Map<Region, Set<string>>();
  for (const e of entries) {
    if (!e.flags.includes('pain') || e.date > today) continue;
    const r = regionOf(e);
    let d = by.get(r); if (!d) by.set(r, d = new Set()); d.add(e.date);
  }
  const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const out: { region: Region; since: string; weeks: number }[] = [];
  for (const [region, set] of by) {
    const days = [...set].sort();
    const latest = days.at(-1)!;
    if (span(latest, today) > NHS_DAYS) continue;
    let i = days.length - 1;
    while (i > 0 && span(days[i - 1], days[i]) <= NHS_DAYS) i--;
    if (span(days[i], latest) >= NHS_DAYS) out.push({ region, since: days[i], weeks: Math.floor(span(days[i], today) / 7) });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since) || a.region.localeCompare(b.region));
}

/** Whether a session of a lift was shaped by pain, so it says nothing of a plateau: it hurt, or the gate held or eased it. */
export function painShaped(entries: readonly SetEntry[], exercise: string, date: string): boolean {
  return liftSets(entries, exercise).some((e) => e.date === date && e.flags.includes('pain')) || painGate(entries, exercise, date) != null;
}

