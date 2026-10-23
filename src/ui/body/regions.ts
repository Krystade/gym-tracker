import { MUSCLES, type Muscle, type Vector } from '../../domain/muscles';
import { weekStatus } from '../../domain/analytics';
import { targetFor, type Profile } from '../../domain/profile';

// The body map (owner, 2026-10-22): where each of the 18 muscles is drawn on MuscleMap's male front and back (src/ui/body/paths.ts),
// and the tone each view paints it. Kept apart from the paths, so screens can work out tones without loading the drawing.

export type Side = 'front' | 'back';
/** A shape on the body map: MuscleMap's slugs, the ones paths.ts keeps. */
export type Slug = 'hair' | 'head' | 'neck' | 'trapezius' | 'deltoids' | 'frontDeltoid' | 'chest' | 'biceps' | 'triceps' | 'forearm'
  | 'hands' | 'abs' | 'obliques' | 'adductors' | 'quadriceps' | 'knees' | 'tibialis' | 'calves' | 'ankles' | 'feet' | 'rhomboids'
  | 'lowerTrapezius' | 'upperBack' | 'rotatorCuff' | 'lowerBack' | 'gluteal' | 'hamstring';

export interface Region { side: Side; slug: Slug }

/**
 * Where each muscle is drawn, or 'list' when the map has no shape of its own for it (it's named in the list under the map only).
 * - Side Delts: the front deltoid outside its front head (frontDeltoid is cut from the deltoid and drawn over it), the outer cap.
 *   From behind, MuscleMap's deltoid is the rear head whole, so the side head shows on the front only.
 * - Lats: MuscleMap's upper back, the lat and teres wing. Its rhomboids sit inside the trapezius, not the wing, so nothing is cut.
 * - Mid-Back: the rhomboids and the lower trapezius, drawn over the trapezius, and the infraspinatus (rotatorCuff) on the blade.
 * - Traps: the trapezius left showing above them (and its front edge by the neck).
 * - Abs: the rectus and the obliques; the app counts no obliques of their own.
 * - Abductors: gluteus medius isn't drawn, and tinting the top of the glutes would hide the glutes' own colour there.
 */
export const REGIONS: Record<Muscle, readonly Region[] | 'list'> = {
  Chest: [{ side: 'front', slug: 'chest' }],
  Triceps: [{ side: 'front', slug: 'triceps' }, { side: 'back', slug: 'triceps' }],
  Biceps: [{ side: 'front', slug: 'biceps' }],
  'Front Delts': [{ side: 'front', slug: 'frontDeltoid' }],
  'Side Delts': [{ side: 'front', slug: 'deltoids' }],
  'Rear Delts': [{ side: 'back', slug: 'deltoids' }],
  Lats: [{ side: 'back', slug: 'upperBack' }],
  'Mid-Back': [{ side: 'back', slug: 'rhomboids' }, { side: 'back', slug: 'lowerTrapezius' }, { side: 'back', slug: 'rotatorCuff' }],
  Traps: [{ side: 'front', slug: 'trapezius' }, { side: 'back', slug: 'trapezius' }],
  Erectors: [{ side: 'back', slug: 'lowerBack' }],
  Quads: [{ side: 'front', slug: 'quadriceps' }],
  Hamstrings: [{ side: 'back', slug: 'hamstring' }],
  Glutes: [{ side: 'back', slug: 'gluteal' }],
  Calves: [{ side: 'front', slug: 'calves' }, { side: 'back', slug: 'calves' }],
  Abs: [{ side: 'front', slug: 'abs' }, { side: 'front', slug: 'obliques' }],
  Forearms: [{ side: 'front', slug: 'forearm' }, { side: 'back', slug: 'forearm' }],
  Adductors: [{ side: 'front', slug: 'adductors' }, { side: 'back', slug: 'adductors' }],
  Abductors: 'list',
};

const BY_SHAPE = new Map<string, Muscle>();
for (const m of MUSCLES) {
  const r = REGIONS[m];
  if (r !== 'list') for (const { side, slug } of r) BY_SHAPE.set(`${side}:${slug}`, m);
}
/** The muscle a shape stands for, or null for the body around them (head, hands, knees, shins, feet). */
export const muscleAt = (side: Side, slug: Slug): Muscle | null => BY_SHAPE.get(`${side}:${slug}`) ?? null;

/** The muscles the map can't draw: named beside it instead. */
export const LIST_ONLY: readonly Muscle[] = MUSCLES.filter((m) => REGIONS[m] === 'list');

// ---- Tones: one rule per view, each with its word (a colour never stands alone) -------------------------------------------------

/** Stats' Muscles sheet: the bars' own status (MuscleBars), and 'none' for a muscle with no target (priority 4). */
export type StatusTone = 'under' | 'pace' | 'on' | 'over' | 'none';
/** The Why sheet: recovery today, in three steps of P(recovered). */
export type RecoveryTone = 'ready' | 'recovering' | 'notyet';
/** A lift's page: how much a set counts for the muscle (1, ¾, ½, ¼). */
export type WeightTone = 'w100' | 'w75' | 'w50' | 'w25';
export type Tone = StatusTone | RecoveryTone | WeightTone;

/** The word beside each colour, in the order a legend lists them. The bars' words for the statuses. */
export const TONE_WORD: Record<Tone, string> = {
  under: 'under', pace: 'on pace', on: 'on target', over: 'over', none: 'no target',
  ready: 'ready', recovering: 'recovering', notyet: 'not yet',
  w100: '1 set', w75: '¾', w50: '½', w25: '¼',
};
const ORDER: Tone[] = ['under', 'pace', 'on', 'over', 'none', 'notyet', 'recovering', 'ready', 'w100', 'w75', 'w50', 'w25'];

/** Each muscle's status this week, as MuscleBars shows it; a muscle with no target (its range tops out at 0) is 'none'. */
export function statusTones(sets: Record<Muscle, number>, profile: Profile, left?: number, reach?: Partial<Record<Muscle, number>>): Record<Muscle, StatusTone> {
  return Object.fromEntries(MUSCLES.map((m) => {
    const band = targetFor(profile, m);
    return [m, band[1] <= 0 ? 'none' : weekStatus(sets[m], band, left, reach?.[m])];
  })) as Record<Muscle, StatusTone>;
}

/** Recovery today from the Why table's percent (as he reads it): 80 and up ready, 50 to 79 recovering, under 50 not yet. */
export const recoveryTone = (pct: number): RecoveryTone => (pct >= 80 ? 'ready' : pct >= 50 ? 'recovering' : 'notyet');

/**
 * Recovery today on the body, in the Why sheet's three steps: each muscle trained in the last two weeks by its "Now" there (`rows`,
 * whyView's), every other muscle ready. A muscle the map can't draw gets a tone only when the table has it.
 */
export function recoveryTones(rows: readonly { muscle: Muscle; pct: number }[]): Partial<Record<Muscle, RecoveryTone>> {
  const out: Partial<Record<Muscle, RecoveryTone>> = {};
  for (const m of MUSCLES) if (REGIONS[m] !== 'list') out[m] = 'ready';
  for (const r of rows) out[r.muscle] = recoveryTone(r.pct);
  return out;
}

/** A lift's weight for a muscle, to the nearest of 1, ¾, ½ and ¼; nothing at 0. */
export const weightTone = (w: number): WeightTone | null =>
  !(w > 0) ? null : w >= 0.875 ? 'w100' : w >= 0.625 ? 'w75' : w >= 0.375 ? 'w50' : 'w25';

/** A lift's muscles as tones. */
export const weightTones = (v: Vector | null): Partial<Record<Muscle, WeightTone>> => {
  const out: Partial<Record<Muscle, WeightTone>> = {};
  for (const [m, w] of Object.entries(v ?? {}) as [Muscle, number][]) { const t = weightTone(w); if (t) out[m] = t; }
  return out;
};

/** The legend: each tone painted somewhere on the map (a list-only muscle paints nothing), in a fixed order. */
export function legendOf(tones: Partial<Record<Muscle, Tone>>): Tone[] {
  const seen = new Set<Tone>();
  for (const m of MUSCLES) { const t = tones[m]; if (t && REGIONS[m] !== 'list') seen.add(t); }
  return ORDER.filter((t) => seen.has(t));
}
