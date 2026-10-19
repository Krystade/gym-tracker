import { resolveLift } from './lifts';

export const MUSCLES = ['Chest', 'Triceps', 'Biceps', 'Front Delts', 'Side Delts', 'Rear Delts', 'Lats', 'Mid-Back', 'Traps', 'Erectors',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms', 'Adductors', 'Abductors'] as const;
export type Muscle = (typeof MUSCLES)[number];
export type Vector = Partial<Record<Muscle, number>>;
export const MUSCLE_LABEL: Record<Muscle, string> = Object.fromEntries(MUSCLES.map((m) => [m, m])) as Record<Muscle, string>;

/** The muscles a lift works, by weight (see Lift in lifts.ts); null for a name the app can't place, and for cardio. */
export const muscleVector = (name: string): Vector | null => resolveLift(name).m;
