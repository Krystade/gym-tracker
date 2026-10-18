// Generic exercise names offered by the picker (no user data).
export const CATALOG: string[] = [
  // Chest
  'Bench Press', 'Incline Bench Press', 'Smith Incline Press', 'Smith Flat Press', 'Incline DB Press', 'Flat DB Press',
  'Machine Chest Press', 'Machine Chest Fly', 'Cable Chest Fly', 'Low-to-High Cable Fly', 'Forward-Lean Dips', 'Push-up', 'Weighted Push-up',
  // Triceps
  'Cable Pushdown', 'Rope Pushdown', 'Overhead Cable Extension', 'Overhead DB Triceps Extension', 'Skullcrusher', 'Close-Grip Bench Press',
  'DB Kickback', 'Cable Kickback', 'Triceps Press Machine', 'Upright Dips',
  // Biceps / forearms
  'DB Curl', 'Incline DB Curl', 'Hammer Curl', 'Cable Curl', 'Bayesian Cable Curl', 'Preacher Curl', 'Cross-Body DB Curl',
  'Machine Biceps Curl', 'Reverse Curl', 'Wrist Curl', 'Farmer’s Carry', 'Plate Pinch Hold',
  // Shoulders
  'Overhead Press', 'Machine Shoulder Press', 'DB Shoulder Press', 'Arnold Press', 'DB Lateral Raise', 'Cable Lateral Raise', 'Machine Lateral Raise',
  'Front Raise', 'Face Pull', 'Cable Rear Delt Fly', 'Reverse Pec Deck',
  // Back
  'Lat Pulldown', 'Close-Grip Lat Pulldown', 'Lat Pull-In', 'Pull-up', 'Chin-up', 'Seated Cable Row', 'Machine Row',
  'Chest-Supported Row', 'Kneeling DB Row', 'Archer Pull', 'Straight-Arm Pulldown',
  // Abs / core / back health
  'Cable Crunch', 'Ab Crunch Machine', 'Decline Sit-up', 'Hanging Leg Raise', 'Supported Leg Raise', 'Torso Rotation Machine',
  'Plank', 'Side Plank', 'Bird Dog', 'McGill Curl-Up', 'Dead Bug', 'Back Extension', 'Pallof Press',
  // Legs
  'Leg Press', 'Leg Extension', 'Seated Leg Curl', 'Lying Leg Curl', 'Deadlift', 'Romanian Deadlift', 'DB Romanian Deadlift', 'Barbell Squat',
  'Smith Squat', 'Front Squat', 'Pendulum Squat', 'Bulgarian Split Squat', 'Hip Thrust', 'Glute Press', 'Hip Adduction Machine', 'Hip Abduction Machine',
  'Standing Calf Raise', 'Seated Calf Raise',
  // Landmine (a bar anchored at one end)
  'Landmine Press', 'Landmine Row', 'T-Bar Row', 'Landmine Squat', 'Landmine Rotation',
  // Cardio
  'Treadmill', 'StairMaster', 'Exercise Bike', 'Elliptical',
];

/**
 * The six movement patterns the catalog's main compound lifts fall into, for rotating a plateaued lift to another variation of
 * the same movement (src/domain/rotation). Each pattern's lifts are in the order a new variation is offered; everything left out
 * (arms, calves, core, isolation, bodyweight presses, glute and erector work, cardio) never rotates.
 */
export const PATTERNS = ['Horizontal press', 'Horizontal pull', 'Vertical press', 'Vertical pull', 'Squat', 'Hinge'] as const;
export type Pattern = (typeof PATTERNS)[number];
export const VARIATIONS: Record<Pattern, string[]> = {
  'Horizontal press': ['Bench Press', 'Machine Chest Press', 'Incline Bench Press', 'Flat DB Press', 'Incline DB Press', 'Smith Flat Press', 'Smith Incline Press', 'Close-Grip Bench Press'],
  'Horizontal pull': ['Chest-Supported Row', 'Seated Cable Row', 'T-Bar Row', 'Kneeling DB Row', 'Machine Row', 'Landmine Row'],
  'Vertical press': ['Overhead Press', 'Machine Shoulder Press', 'DB Shoulder Press', 'Arnold Press', 'Landmine Press'],
  'Vertical pull': ['Lat Pulldown', 'Pull-up', 'Close-Grip Lat Pulldown', 'Chin-up'],
  Squat: ['Barbell Squat', 'Leg Press', 'Smith Squat', 'Pendulum Squat', 'Front Squat', 'Bulgarian Split Squat', 'Landmine Squat'],
  Hinge: ['Deadlift', 'Romanian Deadlift', 'DB Romanian Deadlift'],
};
