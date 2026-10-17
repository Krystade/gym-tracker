// Cycle phase: opt-in, hand-entered on gym days, and private. It never goes in a BodyDay, a month or meta (friends read those);
// it lives in its own store and syncs to users/{uid}/private/cycle, which only its owner can read.
export type CyclePhase = 'period' | 'follicular' | 'ovulation' | 'luteal';
export const PHASES: [CyclePhase, string][] = [['period', 'Period'], ['follicular', 'Follicular'], ['ovulation', 'Ovulation'], ['luteal', 'Luteal']];
/** A day as the phone keeps it. `null`: cleared on this phone, kept until the cloud has the clearing too. */
export interface CycleDay { date: string; phase: CyclePhase | null }

const QUIET_BEFORE_START = 10; // days with no period logged before a period day that starts a cycle
const MIN_LENGTH = 21, MAX_LENGTH = 45; // a gap outside these is a missed log (or two), not a cycle
const LATE = 10; // days past the expected start before no phase is guessed at all

const dayNo = (d: string) => { const [y, m, x] = d.split('-').map(Number); return Date.UTC(y, m - 1, x) / 86_400_000; };

/** Days a cycle starts: a period day with no period day in the 10 days before it. */
export function cycleStarts(days: Record<string, CyclePhase>): string[] {
  const period = Object.keys(days).filter((d) => days[d] === 'period').sort();
  return period.filter((d, i) => i === 0 || dayNo(d) - dayNo(period[i - 1]) > QUIET_BEFORE_START);
}

/** The usual length: the median of the gaps between starts that look like one cycle, once there are at least 2 of them. */
export function cycleLength(days: Record<string, CyclePhase>): number | null {
  const s = cycleStarts(days);
  const gaps = s.slice(1).map((d, i) => dayNo(d) - dayNo(s[i])).filter((g) => g >= MIN_LENGTH && g <= MAX_LENGTH).sort((a, b) => a - b);
  if (gaps.length < 2) return null;
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * The phase a day is likely in, or null without enough logged cycles or when the start is late. Counted from the last start on
 * or before the day, with the textbook luteal phase of about 14 days (it varies less than the follicular phase does).
 */
export function predictPhase(days: Record<string, CyclePhase>, date: string): CyclePhase | null {
  const L = cycleLength(days);
  const start = cycleStarts(days).filter((d) => d <= date).at(-1);
  if (L == null || !start) return null;
  const n = dayNo(date) - dayNo(start) + 1;
  if (n > L + LATE) return null;
  if (n <= 5) return 'period';
  if (n < L - 16) return 'follicular';
  if (n <= L - 12) return 'ovulation';
  return 'luteal';
}

/** The phone's days as a map, cleared days left out. */
export const cycleMap = (rows: CycleDay[]): Record<string, CyclePhase> =>
  Object.fromEntries(rows.filter((r): r is CycleDay & { phase: CyclePhase } => r.phase != null).map((r) => [r.date, r.phase]));

/**
 * Merges the phone's days into the cloud's, per date, with the phone winning (a day cleared here is cleared there too).
 * `pull`: the cloud's days the phone lacks. `changed`: the cloud copy needs writing.
 */
export function mergeCycle(local: CycleDay[], remote: Record<string, CyclePhase>): { days: Record<string, CyclePhase>; pull: CycleDay[]; changed: boolean } {
  const days = { ...remote };
  for (const r of local) { if (r.phase) days[r.date] = r.phase; else delete days[r.date]; }
  const here = new Set(local.map((r) => r.date));
  const pull = Object.entries(remote).filter(([d]) => !here.has(d)).map(([date, phase]) => ({ date, phase }));
  const changed = Object.keys(days).length !== Object.keys(remote).length || Object.entries(days).some(([d, p]) => remote[d] !== p);
  return { days, pull, changed };
}
