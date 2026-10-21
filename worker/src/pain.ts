import type { Hurt, PainRegion } from '../../src/push/payload';
import { localDate, zonedTime } from './schedule';

// The next-morning pain question (item 08, round 20; owner, 2026-10-20: "push notification the question for the next day at like
// 11am"). The phone says which days had pain it hasn't asked about yet (src/push/activity.ts `pain`); the Worker asks once, at
// 11:00 local the day after, never on a day with no pain the day before, and never more than one a day. Pure, so it's tested alone.

/** `hurts`: every region and lift that hurt that day (an app before them sends only the worst, as `region` and `lift`). */
export interface PainDay { date: string; region: PainRegion; lift: string; hurts?: Hurt[] }
/** What the day's one push names: all of it, or the worst alone from an older app. */
export const hurtsOf = (p: PainDay): Hurt[] => (p.hurts?.length ? p.hurts : [{ region: p.region, lift: p.lift }]);

/** The local time of the question. */
export const PAIN_AT = '11:00';
/** How late an alarm may still ask (a Durable Object alarm can run a little after its time); later, Today's card asks. */
export const PAIN_LATE_MS = 3600_000;

/** `date` plus `n` days, as YYYY-MM-DD (calendar arithmetic, no time zone). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 11:00 in `tz` on the day after `date`. */
export function askTime(tz: string, date: string): number {
  const [y, m, d] = addDays(date, 1).split('-').map(Number);
  const [hh, mm] = PAIN_AT.split(':').map(Number);
  return zonedTime(tz, y, m, d, hh, mm);
}

/**
 * The next time a question is due: the earliest 11:00 still to come for a pain day not asked yet; null with none. One already past
 * is never planned (a phone that tells of pain after its 11:00 is open on Today, where the card asks).
 */
export function nextPainAt(tz: string, pain: readonly PainDay[] | undefined, sent: readonly string[], now: number): number | null {
  let best: number | null = null;
  for (const p of pain ?? []) {
    if (sent.includes(p.date)) continue;
    const t = askTime(tz, p.date);
    if (t <= now) continue;
    if (best == null || t < best) best = t;
  }
  return best;
}

/**
 * The question to send now, or null: pain on the day before today (local), not asked already, its 11:00 come and not long gone,
 * and nothing asked today.
 */
export function painDue(tz: string, pain: readonly PainDay[] | undefined, sent: readonly string[], askedOn: string | undefined, now: number): PainDay | null {
  const today = localDate(tz, now);
  if (askedOn === today) return null;
  const yesterday = addDays(today, -1);
  for (const p of pain ?? []) {
    if (p.date !== yesterday || sent.includes(p.date)) continue;
    const t = askTime(tz, p.date);
    if (now >= t && now <= t + PAIN_LATE_MS) return p;
  }
  return null;
}
