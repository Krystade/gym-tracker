import { resolveLift } from './lifts';
import { gearOf } from './equipment';

export const MUSCLES = ['Chest', 'Triceps', 'Biceps', 'Front Delts', 'Side Delts', 'Rear Delts', 'Lats', 'Mid-Back', 'Traps', 'Erectors',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms', 'Adductors', 'Abductors'] as const;
export type Muscle = (typeof MUSCLES)[number];
export type Vector = Partial<Record<Muscle, number>>;
export const MUSCLE_LABEL: Record<Muscle, string> = Object.fromEntries(MUSCLES.map((m) => [m, m])) as Record<Muscle, string>;

/** The muscles a lift works, by weight (see Lift in lifts.ts); null for a name the app can't place, and for cardio. */
export const muscleVector = (name: string): Vector | null => resolveLift(name).m;

const FRACTION: Record<number, string> = { 1: '', 0.75: ' ¾', 0.5: ' ½', 0.25: ' ¼' };
/** A vector in words, most-worked first: "chest · triceps ½ · front delts ½". */
export function musclesText(v: Vector | null): string {
  if (!v) return 'muscles unknown';
  const es = (Object.entries(v) as [Muscle, number][]).sort((a, b) => b[1] - a[1]);
  if (!es.length) return 'no muscle the app tracks';
  return es.map(([m, w]) => MUSCLE_LABEL[m].toLowerCase() + (FRACTION[w] ?? '')).join(' · ');
}

/** What the picker's "Add" row says a new name will count for, before it's added. */
export function countsFor(name: string): string {
  const m = resolveLift(name).m;
  return m ? `counts for ${musclesText(m)}` : 'muscles unknown';
}

/** The lift page's line: muscles, pattern and gear, and whether that was guessed from the name. */
export function worksLine(name: string): string {
  const r = resolveLift(name);
  if (!r.m) return 'Muscles unknown';
  const gear = gearOf(name);
  const parts = [musclesText(r.m), r.p?.toLowerCase(), gear].filter(Boolean);
  return `Works ${parts.join(' · ')}${r.how === 'built' ? ' · guessed from the name' : ''}`;
}
