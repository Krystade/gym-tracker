import { normalizeName } from './ids';

// What a gym has, and what each catalog lift needs. Generic gym gear only.

export const EQUIPMENT = [
  'barbell', 'squat rack', 'plates', 'dumbbells', 'flat bench', 'incline bench', 'decline bench', 'preacher bench',
  'cable stack', 'dual cable', 'lat pulldown', 'pull-up bar', 'dip station', 'captain’s chair', 'back extension bench', 'hip thrust bench',
  'smith machine', 'leg press', 'leg extension', 'seated leg curl', 'lying leg curl', 'chest press machine', 'pec deck',
  'shoulder press machine', 'lateral raise machine', 'row machine', 'seated calf machine', 'standing calf machine', 'glute press',
  'hip abduction machine', 'hip adduction machine', 'ab crunch machine', 'biceps curl machine', 'triceps machine', 'torso rotation machine',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const EQUIPMENT_GROUPS: [string, Equipment[]][] = [
  ['Free weights', ['barbell', 'squat rack', 'plates', 'dumbbells']],
  ['Benches & stations', ['flat bench', 'incline bench', 'decline bench', 'preacher bench', 'pull-up bar', 'dip station', 'captain’s chair', 'back extension bench', 'hip thrust bench']],
  ['Cables', ['cable stack', 'dual cable', 'lat pulldown']],
  ['Machines', ['smith machine', 'leg press', 'leg extension', 'seated leg curl', 'lying leg curl', 'chest press machine', 'pec deck',
    'shoulder press machine', 'lateral raise machine', 'row machine', 'seated calf machine', 'standing calf machine', 'glute press',
    'hip abduction machine', 'hip adduction machine', 'ab crunch machine', 'biceps curl machine', 'triceps machine', 'torso rotation machine']],
];

export interface Gym { id: string; name: string; equipment: Equipment[]; exclude: string[]; include: string[] }

type Needs = Equipment[][];
const NOTHING: Needs = [[]];
const one = (...alts: Equipment[]): Needs => alts.map((e) => [e]);

/** Every catalog lift → alternative gear sets; any one set, fully present, is enough. [[]] = nothing needed. */
export const NEEDS: Record<string, Needs> = {
  'Bench Press': [['barbell', 'flat bench']], 'Incline Bench Press': [['barbell', 'incline bench']], 'Smith Incline Press': [['smith machine', 'incline bench']],
  'Smith Flat Press': [['smith machine', 'flat bench']], 'Incline DB Press': [['dumbbells', 'incline bench']], 'Flat DB Press': [['dumbbells', 'flat bench']],
  'Machine Chest Press': one('chest press machine'), 'Machine Chest Fly': one('pec deck'), 'Cable Chest Fly': one('dual cable'),
  'Low-to-High Cable Fly': one('dual cable'), 'Forward-Lean Dips': one('dip station'), 'Push-up': NOTHING, 'Weighted Push-up': one('plates', 'dumbbells'),
  'Cable Pushdown': one('cable stack'), 'Rope Pushdown': one('cable stack'), 'Overhead Cable Extension': one('cable stack'),
  'Overhead DB Triceps Extension': one('dumbbells'), 'Skullcrusher': [['barbell', 'flat bench'], ['dumbbells', 'flat bench']],
  'Close-Grip Bench Press': [['barbell', 'flat bench'], ['smith machine', 'flat bench']], 'DB Kickback': one('dumbbells'), 'Cable Kickback': one('cable stack'),
  'Triceps Press Machine': one('triceps machine'), 'Upright Dips': one('dip station'),
  'DB Curl': one('dumbbells'), 'Incline DB Curl': [['dumbbells', 'incline bench']], 'Hammer Curl': one('dumbbells'), 'Cable Curl': one('cable stack'),
  'Bayesian Cable Curl': one('cable stack'), 'Preacher Curl': [['preacher bench', 'dumbbells'], ['preacher bench', 'barbell']], 'Cross-Body DB Curl': one('dumbbells'),
  'Machine Biceps Curl': one('biceps curl machine'), 'Reverse Curl': one('barbell', 'cable stack', 'dumbbells'), 'Wrist Curl': one('dumbbells', 'barbell'),
  'Farmer’s Carry': one('dumbbells'), 'Plate Pinch Hold': one('plates'),
  'Overhead Press': [['barbell', 'squat rack']], 'Machine Shoulder Press': one('shoulder press machine'), 'Arnold Press': one('dumbbells'),
  'DB Lateral Raise': one('dumbbells'), 'Cable Lateral Raise': one('cable stack'), 'Machine Lateral Raise': one('lateral raise machine'),
  'Front Raise': one('dumbbells', 'plates', 'cable stack'), 'Face Pull': one('cable stack'), 'Cable Rear Delt Fly': one('dual cable', 'cable stack'), 'Reverse Pec Deck': one('pec deck'),
  'Lat Pulldown': one('lat pulldown'), 'Close-Grip Lat Pulldown': one('lat pulldown'), 'Lat Pull-In': one('cable stack'), 'Pull-up': one('pull-up bar'),
  'Chin-up': one('pull-up bar'), 'Seated Cable Row': one('cable stack'), 'Machine Row': one('row machine'),
  'Chest-Supported Row': [['row machine'], ['dumbbells', 'incline bench']], 'Kneeling DB Row': [['dumbbells', 'flat bench']], 'Archer Pull': one('cable stack'),
  'Straight-Arm Pulldown': one('cable stack', 'lat pulldown'),
  'Cable Crunch': one('cable stack'), 'Ab Crunch Machine': one('ab crunch machine'), 'Decline Sit-up': one('decline bench'), 'Hanging Leg Raise': one('pull-up bar'),
  'Supported Leg Raise': one('captain’s chair', 'dip station'), 'Torso Rotation Machine': one('torso rotation machine'), 'Plank': NOTHING, 'Side Plank': NOTHING,
  'Bird Dog': NOTHING, 'McGill Curl-Up': NOTHING, 'Dead Bug': NOTHING, 'Back Extension': one('back extension bench'), 'Pallof Press': one('cable stack'),
  'Leg Press': one('leg press'), 'Leg Extension': one('leg extension'), 'Seated Leg Curl': one('seated leg curl'), 'Lying Leg Curl': one('lying leg curl'),
  'Romanian Deadlift': one('barbell'), 'DB Romanian Deadlift': one('dumbbells'), 'Barbell Squat': [['barbell', 'squat rack']], 'Smith Squat': one('smith machine'),
  'Bulgarian Split Squat': one('flat bench'), 'Hip Thrust': [['barbell', 'hip thrust bench'], ['barbell', 'flat bench'], ['smith machine', 'flat bench']],
  'Glute Press': one('glute press'), 'Hip Adduction Machine': one('hip adduction machine'), 'Hip Abduction Machine': one('hip abduction machine'),
  'Standing Calf Raise': one('standing calf machine', 'smith machine', 'dumbbells'), 'Seated Calf Raise': one('seated calf machine'),
};

const key = (s: string) => normalizeName(s).toLowerCase();
const NEEDS_BY_KEY = new Map(Object.entries(NEEDS).map(([k, v]) => [key(k), v]));

/** Whether this gym can do the lift: an exclusion or inclusion decides first, then the gear. Null = gear unknown (not a catalog lift). */
export function canDo(gym: Gym | null, exercise: string): boolean | null {
  if (!gym) return true;
  const k = key(exercise);
  if (gym.exclude.some((x) => key(x) === k)) return false;
  if (gym.include.some((x) => key(x) === k)) return true;
  const needs = NEEDS_BY_KEY.get(k);
  if (!needs) return null;
  // A dual cable station is two cable stacks.
  const has = (e: Equipment) => gym.equipment.includes(e) || (e === 'cable stack' && gym.equipment.includes('dual cable'));
  return needs.some((alt) => alt.every(has));
}

export const availableSet = (gym: Gym | null, names: string[]): Set<string> => new Set(names.filter((n) => canDo(gym, n) === true));
