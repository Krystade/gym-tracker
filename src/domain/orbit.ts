import { addDays } from './analytics';
import { isCardioEntry } from './cardio';
import { muscleVector, type Muscle } from './muscles';
import type { SetEntry } from './types';

/** What a day was for, on Orbit: five kinds, each with its own colour. */
export const KINDS = ['legs', 'push', 'pull', 'core', 'cardio'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = { legs: 'Legs', push: 'Push', pull: 'Pull', core: 'Arms and core', cardio: 'Cardio' };

const KIND_OF: Record<Muscle, Exclude<Kind, 'cardio'>> = {
  Quads: 'legs', Hamstrings: 'legs', Glutes: 'legs', Calves: 'legs', Adductors: 'legs', Abductors: 'legs',
  Chest: 'push', Triceps: 'push', 'Front Delts': 'push', 'Side Delts': 'push',
  Lats: 'pull', 'Mid-Back': 'pull', 'Rear Delts': 'pull', Biceps: 'pull', Traps: 'pull',
  Abs: 'core', Forearms: 'core', Erectors: 'core',
};
/** A set and its rest take about three minutes, so three minutes of cardio weigh what one set does. */
const CARDIO_MIN_PER_SET = 3;
/** A runner-up within 20% of the top kind shares the day. */
const CLOSE = 0.8;

/**
 * A day on Orbit. `kinds` empty with `training` true: a training day of lifts nothing maps (shown neutral).
 * Training false: a rest day (nothing logged, or warm-ups only).
 */
export interface Day { date: string; training: boolean; kinds: Kind[] }

/** A working set: not a warm-up, not cardio. */
export const isWorking = (e: SetEntry) => !e.flags.includes('warmup') && !isCardioEntry(e);

/** One day's kind from its sets (all on that day). Each working set counts once, shared across its muscles' kinds. */
export function dayKinds(sets: SetEntry[]): Omit<Day, 'date'> {
  const score: Record<Kind, number> = { legs: 0, push: 0, pull: 0, core: 0, cardio: 0 };
  let training = false;
  for (const e of sets) {
    if (isCardioEntry(e)) { training = true; score.cardio += (e.cardio?.seconds ?? 0) / 60 / CARDIO_MIN_PER_SET; continue; }
    if (e.flags.includes('warmup')) continue;
    training = true;
    const v = muscleVector(e.exercise);
    if (!v) continue;
    const total = Object.values(v).reduce((a, b) => a + (b ?? 0), 0);
    for (const [m, f] of Object.entries(v) as [Muscle, number][]) score[KIND_OF[m]] += f / total;
  }
  const ranked = KINDS.filter((k) => score[k] > 0).sort((a, b) => score[b] - score[a]);
  if (!ranked.length) return { training, kinds: [] };
  const [top, next] = ranked;
  return { training, kinds: next && score[next] >= score[top] * CLOSE ? [top, next] : [top] };
}

/** Every day from `from` to `to` (inclusive), oldest first. */
export function orbitDays(entries: SetEntry[], from: string, to: string): Day[] {
  const byDate = new Map<string, SetEntry[]>();
  for (const e of entries) if (e.date >= from && e.date <= to) (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
  const out: Day[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, ...dayKinds(byDate.get(d) ?? []) });
  return out;
}

/** This week's numbers under a line: sessions (days with a working set or cardio) and working sets, Monday to Sunday from `week`. */
export function weekNumbers(entries: SetEntry[], week: string): { sessions: number; sets: number } {
  const end = addDays(week, 7), days = new Set<string>();
  let sets = 0;
  for (const e of entries) {
    if (e.date < week || e.date >= end) continue;
    if (isCardioEntry(e)) days.add(e.date);
    else if (!e.flags.includes('warmup')) { days.add(e.date); sets++; }
  }
  return { sessions: days.size, sets };
}
export const fmtWeek = ({ sessions, sets }: { sessions: number; sets: number }) =>
  `${sessions} session${sessions === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}`;

/** The most recent training day up to `to`, with its top kind (for sorting rows and tinting the status bubble). */
export function lastTraining(days: Day[]): Day | null {
  for (let i = days.length - 1; i >= 0; i--) if (days[i].training) return days[i];
  return null;
}

/** A status phrase as saved: trimmed, spaces collapsed, at most 24 characters (an emoji counts as one). */
export const STATUS_MAX = 24;
const graphemes = (s: string): string[] => {
  const Seg = (Intl as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : Array.from(s);
};
export const statusLength = (s: string) => graphemes(s.trim().replace(/\s+/g, ' ')).length;
export function cleanStatus(s: unknown): string {
  if (typeof s !== 'string') return '';
  return graphemes(s.trim().replace(/\s+/g, ' ')).slice(0, STATUS_MAX).join('').trim();
}
