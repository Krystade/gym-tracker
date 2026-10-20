import { addDays } from './analytics';
import { likelyRegion, loadsRegion } from './care';
import { painRisk, zoneOf, type Zone } from './learn/pain';
import { daySets, liftSets, sameExercise } from './stats';
import type { Region, SetEntry } from './types';

// Item 08: what pain allows, on top of the pain-monitoring zones (learn/pain zoneOf, a) and the learned risk of pain (learn/pain,
// b). Not medical advice: these rules describe patterns and training options; they never diagnose (care.ts).
//
// Evidence: (a) Silbernagel 2007 (AJSM 35:897) and Silbernagel & Crossley 2015 (JOSPT 45:876): loading may go on while pain stays
// within 5/10 and doesn't rise from week to week; above 5/10 the load must come down. Load progresses at pain of 3/10 or less
// (the common progression criterion across tendinopathy rehabilitation protocols, Bahiana review in 08 §2.1). Smith 2017 (BJSM
// 51:1679): exercise into acceptable pain did no harm. So mild pain changes nothing, moderate pain holds the lift where it is,
// and sharp pain lowers it.

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
export interface PainGate { kind: 'hold' | 'ease'; zone: Zone; region: Region; from: string; date: string; spill: boolean; unknown: boolean }

const regionOf = (e: SetEntry): Region => e.painRegion ?? likelyRegion(e.exercise);
const unknownOf = (sets: readonly SetEntry[], z: Zone) => !sets.some((e) => e.flags.includes('pain') && e.painSeverity === z);

/** The lift's sets on its last day before `date`, in log order; empty with none. */
function lastDay(entries: readonly SetEntry[], exercise: string, date: string): SetEntry[] {
  let d = '';
  for (const e of liftSets(entries, exercise)) if (e.date < date && e.date > d) d = e.date;
  return d ? liftSets(entries, exercise).filter((e) => e.date === d) : [];
}

/**
 * Another lift's pain, moderate or worse, in a region this lift loads, within SETTLE_DAYS before `date` or earlier on it (a): the
 * most recent. Mild pain is acceptable and spills over to nothing.
 */
export function spillOver(entries: readonly SetEntry[], exercise: string, date: string): PainGate | null {
  let best: SetEntry | null = null;
  for (let k = SETTLE_DAYS; k >= 0; k--) {
    for (const e of daySets(entries, addDays(date, -k))) {
      if (!e.flags.includes('pain') || (e.painSeverity ?? 2) < 2 || sameExercise(e.exercise, exercise) || !loadsRegion(exercise, regionOf(e))) continue;
      best = e;
    }
  }
  return best && { kind: 'hold', zone: 2, region: regionOf(best), from: best.exercise, date: best.date, spill: true, unknown: best.painSeverity == null };
}

/**
 * What last time's pain allows today (a): the lift's last session sharp → one step lighter; moderate (or of unknown severity) →
 * the same weight and reps; mild or none → progression as usual, unless another lift's pain spills over (hold). Null: no gate.
 */
export function painGate(entries: readonly SetEntry[], exercise: string, date: string): PainGate | null {
  const sets = lastDay(entries, exercise, date);
  const z = zoneOf(sets);
  if (z >= 2) {
    const first = sets.find((e) => e.flags.includes('pain') && (e.painSeverity ?? 2) === z)!;
    return { kind: z === 3 ? 'ease' : 'hold', zone: z, region: regionOf(first), from: first.exercise, date: first.date, spill: false, unknown: unknownOf(sets, z) };
  }
  return spillOver(entries, exercise, date);
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
 * outcome): with how many of its last few sessions hurt, for the words. Null below ½. Display only: the swap is his to take.
 */
export function persistentPain(entries: readonly SetEntry[], exercise: string, date: string): { p: number; hurt: number; of: number } | null {
  const risk = painRisk(entries, exercise, date);
  if (!(risk.p >= 0.5)) return null;
  const days = [...new Set(liftSets(entries, exercise).filter((e) => e.date <= date).map((e) => e.date))].sort().slice(-SHOWN);
  const hurt = days.filter((d) => liftSets(entries, exercise).some((e) => e.date === d && e.flags.includes('pain'))).length;
  return { p: risk.p, hurt, of: days.length };
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

