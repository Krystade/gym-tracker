import { addDays } from './analytics';
import { likelyRegion } from './care';
import { zoneOf, type Zone } from './learn/pain';
import { byOrderDone, daySets } from './stats';
import type { Morning, Region, SetEntry } from './types';

// Item 08, round 20: the next-morning question (optional, never required). The day after a session with any pain set, one tap:
// settled, still sore, or worse (a: Silbernagel 2007, pain should have subsided by the next morning; Silbernagel & Crossley 2015,
// rule 3). A push at about 11:00 asks it where he has notifications on (worker/src/userbox.ts); Today asks it either way, once,
// until answered or dismissed. A dismissal is stored as `skipped`: unknown, which changes nothing (painPlan).

/** One question: a region that hurt on `date`, the lifts it hurt on (in the order done), and the worst pain there. */
export interface MorningAsk { date: string; region: Region; lifts: string[]; zone: Zone }

const regionOf = (e: SetEntry): Region => e.painRegion ?? likelyRegion(e.exercise);

/** A day's pain sets by region, each region's in the order done. */
function painByRegion(entries: readonly SetEntry[], date: string): Map<Region, SetEntry[]> {
  const out = new Map<Region, SetEntry[]>();
  for (const e of [...daySets(entries, date)].sort(byOrderDone)) {
    if (!e.flags.includes('pain')) continue;
    const r = regionOf(e), l = out.get(r);
    if (l) l.push(e); else out.set(r, [e]);
  }
  return out;
}

/** The questions for the pain of `date` not yet answered or dismissed: the worst first (then the earliest in the day). */
export function asksFor(entries: readonly SetEntry[], date: string): MorningAsk[] {
  const out: MorningAsk[] = [];
  for (const [region, sets] of painByRegion(entries, date)) {
    if (sets.some((e) => e.morning)) continue;
    out.push({ date, region, lifts: [...new Set(sets.map((e) => e.exercise))], zone: zoneOf(sets) });
  }
  return out.sort((a, b) => b.zone - a.zone);
}

/** What Today asks on `today`: about yesterday's pain only (the 24-hour rule: a morning later isn't the next morning). */
export const morningAsks = (entries: readonly SetEntry[], today: string): MorningAsk[] => asksFor(entries, addDays(today, -1));

/**
 * What the Worker needs to ask by push (push/activity.ts): for yesterday and today, the worst unanswered region and the lift it
 * hurt worst on (the last such set), so the 11:00 push the day after can name them. No severity, notes or weights.
 */
export function pushAsks(entries: readonly SetEntry[], today: string): { date: string; region: Region; lift: string }[] {
  const out: { date: string; region: Region; lift: string }[] = [];
  for (const date of [addDays(today, -1), today]) {
    const [ask] = asksFor(entries, date);
    if (!ask) continue;
    const sets = painByRegion(entries, date).get(ask.region)!;
    const worst = sets.filter((e) => (e.painSeverity ?? 2) === ask.zone).at(-1)!;
    out.push({ date, region: ask.region, lift: worst.exercise });
  }
  return out;
}

/**
 * The answer, as the sets that carry it: every pain set of that region on that day, the answer (and his note, if any) on each.
 * Only those whose answer changes. The caller saves them (stamped as an edit, so the newer answer wins in sync).
 */
export function answered(entries: readonly SetEntry[], date: string, region: Region, morning: Morning, note?: string): SetEntry[] {
  const text = note?.trim() || undefined;
  return (painByRegion(entries, date).get(region) ?? [])
    .filter((e) => e.morning !== morning || (text !== undefined && e.morningNote !== text))
    .map((e) => ({ ...e, morning, ...(text !== undefined && { morningNote: text }) }));
}
