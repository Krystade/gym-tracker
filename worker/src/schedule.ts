// Wall-clock times in the account's own time zone. Cron triggers only know UTC, so each account's alarm is computed here.
// The reminder's rule per day (remindTime) is shared with the app's card, in src/push/payload.ts.

import { remindTime } from '../../src/push/payload';

export { remindTime };

const fmt = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string, ms: number) {
  let f = fmt.get(tz);
  if (!f) fmt.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, hh: o.hour % 24, mm: o.minute, ss: o.second };
}

/** Whether `tz` is an IANA zone this runtime knows. */
export function validZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** The zone's offset from UTC at instant `ms`, in ms (New York in summer: −4 h). */
function offset(tz: string, ms: number): number {
  const p = parts(tz, ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall-clock time happens in `tz`. A time skipped by a DST jump lands just after the jump. */
export function zonedTime(tz: string, y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offset(tz, guess);
  const second = guess - offset(tz, first);
  return offset(tz, second) === offset(tz, first) ? second : Math.max(first, second);
}

/** The local date at instant `ms`, as YYYY-MM-DD. */
export function localDate(tz: string, ms: number): string {
  const p = parts(tz, ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** The Monday of a date's week (the app's weeks start on Monday). */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/**
 * The first instant after `after` that is `at` ("HH:MM") local time on one of `days` (0 = Sunday … 6 = Saturday),
 * or null with no days.
 */
export function nextAt(tz: string, days: readonly number[], at: string, after: number): number | null {
  if (!days.length) return null;
  const [hh, mm] = at.split(':').map(Number);
  const p = parts(tz, after);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i));
    if (!days.includes(day.getUTCDay())) continue;
    const t = zonedTime(tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm);
    if (t > after) return t;
  }
  return null;
}

/**
 * The first instant after `after` that is a reminder time (remindTime) on its local day; null with none in the next two weeks.
 * `rest`: local dates the phone's week plan rests (readiness S5, owner Q6): none on them. Only with learning on (`learn` not
 * false): like the rest of what the app learns, the plan can only take a reminder away. An app before them sends none: as before.
 */
export function nextRemind(tz: string, reminder: { days: readonly number[]; at: string; learn?: boolean }, learned: readonly (string | null)[] | undefined, after: number, rest?: readonly string[]): number | null {
  const p = parts(tz, after);
  // Two weeks: at most 7 rest dates can't hide every one of his days (with none, a weekday missing from the first 8 days is
  // missing from every week, so the answer is the same as one week's).
  for (let i = 0; i <= 15; i++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i));
    const at = remindTime(reminder, learned, day.getUTCDay());
    if (at == null || restsOn(reminder, rest, day.toISOString().slice(0, 10))) continue;
    const [hh, mm] = at.split(':').map(Number);
    const t = zonedTime(tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm);
    if (t > after) return t;
  }
  return null;
}

/** Whether `date` (local) is one of the plan's rest dates the reminder keeps quiet on: learning on, and the phone sent it. */
export const restsOn = (reminder: { learn?: boolean }, rest: readonly string[] | undefined, date: string): boolean =>
  reminder.learn !== false && !!rest?.includes(date);

/**
 * Whether the reminder due now goes out on local day `today`: the kind on; nothing logged today (the whole point); one a day,
 * however the plan moved; with learning on, none once this week's sessions reach his goal (a JITAI rule, Nahum-Shani 2018: only
 * when needed) and none on a rest date of his week plan (readiness S5).
 */
export function remindToday(prefs: { kinds: { remind: boolean }; reminder: { learn?: boolean } }, act: { date: string; week: { start: string; sessions: number }; goal?: number; rest?: readonly string[] } | undefined, remindedOn: string | undefined, today: string): boolean {
  const met = prefs.reminder.learn !== false && act?.goal != null && act.week.start === weekStart(today) && act.week.sessions >= act.goal;
  return prefs.kinds.remind && act?.date !== today && !met && remindedOn !== today && !restsOn(prefs.reminder, act?.rest, today);
}
