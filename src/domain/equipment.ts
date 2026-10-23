import { liftKey } from './ids';
import { LIFTS, resolveLift, type Needs } from './lifts';

// What a gym has, and what each catalog lift needs. Generic gym gear only.

export const EQUIPMENT = [
  'barbell', 'squat rack', 'plates', 'dumbbells', 'flat bench', 'incline bench', 'decline bench', 'preacher bench',
  'cable stack', 'dual cable', 'lat pulldown', 'pull-up bar', 'dip station', 'captain’s chair', 'back extension bench', 'hip thrust bench',
  'smith machine', 'leg press', 'pendulum squat', 'leg extension', 'seated leg curl', 'lying leg curl', 'chest press machine', 'pec deck',
  'shoulder press machine', 'lateral raise machine', 'row machine', 'seated calf machine', 'standing calf machine', 'glute press',
  'hip abduction machine', 'hip adduction machine', 'ab crunch machine', 'biceps curl machine', 'triceps machine', 'torso rotation machine',
  'treadmill', 'stair climber', 'exercise bike', 'elliptical', 'landmine',
  // Round 15: gear the larger catalog needs. A gym set up before it counts it as not yet asked (see unasked).
  'ez bar', 'trap bar', 'kettlebells', 'glute-ham developer', 'hack squat', 'belt squat', 'hip thrust machine', 'reverse hyper machine',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const EQUIPMENT_GROUPS: [string, Equipment[]][] = [
  ['Free weights', ['barbell', 'squat rack', 'plates', 'dumbbells', 'landmine', 'ez bar', 'trap bar', 'kettlebells']],
  ['Benches & stations', ['flat bench', 'incline bench', 'decline bench', 'preacher bench', 'pull-up bar', 'dip station', 'captain’s chair', 'back extension bench', 'hip thrust bench', 'glute-ham developer']],
  ['Cables', ['cable stack', 'dual cable', 'lat pulldown']],
  ['Machines', ['smith machine', 'leg press', 'pendulum squat', 'hack squat', 'belt squat', 'hip thrust machine', 'reverse hyper machine', 'leg extension', 'seated leg curl', 'lying leg curl', 'chest press machine', 'pec deck',
    'shoulder press machine', 'lateral raise machine', 'row machine', 'seated calf machine', 'standing calf machine', 'glute press',
    'hip abduction machine', 'hip adduction machine', 'ab crunch machine', 'biceps curl machine', 'triceps machine', 'torso rotation machine']],
  ['Cardio', ['treadmill', 'stair climber', 'exercise bike', 'elliptical']],
];

/**
 * `gearVersion`: the gear list the gym was last checked against (see GEAR_VERSION). Older gyms haven't been asked about the gear
 * added since, so it counts as maybe there.
 */
export interface Gym { id: string; name: string; equipment: Equipment[]; exclude: string[]; include: string[]; gearVersion?: number;
  /** The plate sizes here (lb), for the per-side line; unset = plates.PLATE_SIZES, 35s included. */
  plates?: number[] }

/** The gear list's version: 2 added NEW_GEAR (round 15). A gym without one predates it. */
export const GEAR_VERSION = 2;
export const NEW_GEAR: Equipment[] = ['ez bar', 'trap bar', 'kettlebells', 'glute-ham developer', 'hack squat', 'belt squat', 'hip thrust machine', 'reverse hyper machine'];
/** Gear added since this gym was set up that it doesn't have ticked: not yet asked, so neither there nor missing. */
export const unasked = (gym: Gym): Equipment[] => ((gym.gearVersion ?? 1) >= GEAR_VERSION ? [] : NEW_GEAR.filter((e) => !gym.equipment.includes(e)));

/** Every catalog lift → alternative gear sets; any one set, fully present, is enough. [[]] = nothing needed. */
export const NEEDS: Record<string, Needs> = Object.fromEntries(LIFTS.flatMap((l) => (l.needs ? [[l.name, l.needs]] : [])));

const key = liftKey;

const MACHINES = new Set<Equipment>(EQUIPMENT_GROUPS.find(([g]) => g === 'Machines')![1]);
const CARDIO_GEAR = new Set<Equipment>(EQUIPMENT_GROUPS.find(([g]) => g === 'Cardio')![1]);
const CABLES = new Set<Equipment>(EQUIPMENT_GROUPS.find(([g]) => g === 'Cables')![1]);
/** The main gear a catalog lift is done with, in a word ("dumbbells", "cable", "machine"); null when it isn't a catalog lift. */
export function gearOf(exercise: string): string | null {
  const needs = resolveLift(exercise).needs;
  if (!needs) return null;
  // Several kinds of gear work: no single one to name.
  if (needs.length > 1) return null;
  const alt = needs[0];
  if (!alt.length) return 'no equipment';
  // A bench is where you do it, not what you lift; a lift that needs only a bench names nothing.
  const main = alt.find((e) => !e.endsWith('bench'));
  if (!main) return null;
  return main === 'smith machine' ? 'Smith machine' : CARDIO_GEAR.has(main) ? 'cardio machine' : MACHINES.has(main) ? 'machine' : CABLES.has(main) ? 'cable' : main;
}

/**
 * Whether this gym can do the lift: an exclusion or inclusion decides first, then the gear. Null = not known: the lift's gear is
 * unknown, or only gear the gym hasn't been asked about yet would make it possible.
 */
export function canDo(gym: Gym | null, exercise: string): boolean | null {
  if (!gym) return true;
  const k = key(exercise);
  if (gym.exclude.some((x) => key(x) === k)) return false;
  if (gym.include.some((x) => key(x) === k)) return true;
  const needs = resolveLift(exercise).needs;
  if (!needs) return null;
  // A dual cable station is two cable stacks.
  const has = (e: Equipment) => gym.equipment.includes(e) || (e === 'cable stack' && gym.equipment.includes('dual cable'));
  if (needs.some((alt) => alt.every(has))) return true;
  const maybe = unasked(gym);
  return maybe.length > 0 && needs.some((alt) => alt.every((e) => has(e) || maybe.includes(e))) ? null : false;
}

export const availableSet = (gym: Gym | null, names: string[]): Set<string> => new Set(names.filter((n) => canDo(gym, n) === true));
