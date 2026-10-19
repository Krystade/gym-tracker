import { LIFTS, PATTERNS, type Pattern } from './lifts';

export { PATTERNS, type Pattern };

/** Generic exercise names offered by the picker (no user data), in its order. */
export const CATALOG: string[] = LIFTS.filter((l) => !l.hidden).map((l) => l.name);

/**
 * Each pattern's lifts, in the order a new variation is offered when a lift has plateaued (src/domain/rotation). Every lift here
 * has that pattern in lifts.ts.
 */
export const VARIATIONS: Record<Pattern, string[]> = {
  'Horizontal press': ['Bench Press', 'Machine Chest Press', 'Incline Bench Press', 'Flat DB Press', 'Incline DB Press', 'Smith Flat Press', 'Smith Incline Press', 'Close-Grip Bench Press'],
  'Horizontal pull': ['Chest-Supported Row', 'Seated Cable Row', 'T-Bar Row', 'Kneeling DB Row', 'Machine Row', 'Landmine Row'],
  'Vertical press': ['Overhead Press', 'Machine Shoulder Press', 'DB Shoulder Press', 'Arnold Press', 'Landmine Press'],
  'Vertical pull': ['Lat Pulldown', 'Pull-up', 'Close-Grip Lat Pulldown', 'Chin-up'],
  Squat: ['Barbell Squat', 'Leg Press', 'Smith Squat', 'Pendulum Squat', 'Front Squat', 'Bulgarian Split Squat', 'Landmine Squat'],
  Hinge: ['Deadlift', 'Romanian Deadlift', 'DB Romanian Deadlift'],
};
