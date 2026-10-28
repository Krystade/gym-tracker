import type { Equipment } from '../equipment';
import { LIFTS, liftFactsVersion, movementPhrase, resolveLift, words, type Pattern } from '../lifts';
import { MUSCLES, type Vector } from '../muscles';

// Item 18: tags on every lift, catalog or custom, read from its record and its words. They say which lifts are alike, for the
// learning core's family layer (lifts that share data: learn/pool) and later for rotation. Generic names only; no user data.

/**
 * A lift's movement: the six rotation patterns, and the isolation and accessory movements (00-core §7: curl, extension, raise,
 * fly, calf, core, carry; plus shrug, glute, dip, pullover, adduction and abduction so that every lift has one). `other`: neck,
 * shins and rotator cuff, which train no muscle the app counts.
 */
export const MOVES = ['Horizontal press', 'Horizontal pull', 'Vertical press', 'Vertical pull', 'Squat', 'Hinge',
  'curl', 'extension', 'raise', 'fly', 'calf', 'core', 'carry', 'shrug', 'glute', 'dip', 'pullover', 'adduction', 'abduction', 'other'] as const;
export type Move = Pattern | (typeof MOVES)[number];

/** What is lifted. Bars (straight, EZ, trap, landmine) are `barbell`; a lift on a pull-up bar, dip station or the floor is `bodyweight`. */
export const IMPLEMENTS = ['barbell', 'dumbbell', 'kettlebell', 'plate', 'smith', 'cable', 'machine', 'bodyweight', 'band'] as const;
export type Implement = (typeof IMPLEMENTS)[number];
export type Angle = 'decline' | 'flat' | 'incline';
export type Grip = 'close' | 'wide' | 'underhand' | 'neutral';

/** `uni`: one arm or leg at a time. null implement: the gear isn't known (a custom name with no gear word). */
export interface Tags { move: Move | null; imp: Implement | null; ang: Angle; grip: Grip | null; uni: boolean }

// The movement a phrase from lifts.ts BASES names, where the record has no rotation pattern of its own.
const MOVE_OF: Record<string, Move> = {};
const set = (move: Move, phrases: string) => { for (const p of phrases.split(',')) MOVE_OF[p.trim()] = move; };
set('calf', 'seated calf raise, calf raise, calf press, calf extension, calf');
set('other', 'neck curl, neck extension, neck flexion, tibialis raise, tib raise, tibialis, neck, external rotation, internal rotation, cuban press');
set('Squat', 'leg press, pendulum squat, hack squat, belt squat, bulgarian split squat, isometric split squat, split squat, spanish squat, squat, lunge, stepup, sissy squat, wall sit');
set('extension', 'leg extension, knee extension, jm press, tate press, french press, triceps press, triceps extension, overhead extension, skullcrusher, pushdown, kickback, extension');
set('curl', 'seated leg curl, lying leg curl, leg curl, hamstring curl, ham curl, nordic curl, nordic, glute ham raise, curl, wrist rotation, pronation, supination, finger curl, wrist curl, wrist extension, wrist roller');
set('Hinge', 'stiff leg deadlift, romanian deadlift, deadlift, good morning, rack pull, back extension, hyperextension');
set('glute', 'hip thrust, glute bridge, hip bridge, hip raise, glute press, glute kickback, donkey kick, hip extension, pull through, swing, reverse hyper, glute, bridge');
set('abduction', 'hip abduction, abduction, abductor');
set('adduction', 'hip adduction, adduction, adductor, copenhagen plank, copenhagen');
set('Horizontal press', 'bench press, chest press, floor press, squeeze press, pushup, press, bench');
set('Vertical press', 'pike pushup, handstand pushup, overhead press, shoulder press, military press, military, push press, z press, bradford press, arnold press, arnold, landmine press');
set('dip', 'upright dip, bench dip, dip');
set('fly', 'svend press, reverse pec deck, rear delt fly, rear delt row, rear delt, reverse fly, pull apart, face pull, pec deck, butterfly, crossover, fly');
set('pullover', 'pullover, straight arm pulldown, straight arm pullover, straight arm, lat prayer, pull in');
set('raise', 'upright row, lateral raise, side raise, y raise, lu raise, deltoid raise, scaption, front delt raise, front raise, lateral');
set('shrug', 'kelso shrug, middle back shrug, shoulder shrug, shrug');
set('carry', 'farmer carry, farmer walk, farmer hold, farmer, suitcase carry, carry, dead hang, active hang, towel hang, flexed arm hang, barbell hold, pinch, grip');
set('Vertical press', 'handstand');
set('Vertical pull', 'lat pulldown, pulldown, pullup, chinup, chin, archer pull');
set('Horizontal pull', 'bench pull, landmine row, meadow row, seal row, inverted row, row');
set('core', 'curl up, leg pull in, landmine rotation, side plank, reverse plank, plank, bear, l sit, v sit, superman, front lever, bird dog, dead bug, hollow, v up, supported leg raise, leg raise, knee raise, leg lift, flutter kick, jackknife, heel touch, heel toucher, elbow to knee, pike, cable lift, tuck, toetobar, ab wheel, rollout, side bend, russian twist, twist, woodchop, chop, pallof press, pallof, decline crunch, decline situp, crunch, situp, rotation, oblique, ab, abs, core');

const BARS = new Set<Equipment>(['barbell', 'ez bar', 'trap bar', 'landmine']);
const CABLES = new Set<Equipment>(['cable stack', 'dual cable', 'lat pulldown']);
const BODY = new Set<Equipment>(['pull-up bar', 'dip station', 'captain’s chair']);
const BENCHES = new Set<Equipment>(['flat bench', 'incline bench', 'decline bench', 'preacher bench', 'back extension bench', 'hip thrust bench', 'squat rack']);
/** Gear words in a name, read before the record's gear: "Cable Curl" is a cable lift whatever a curl usually needs. */
const WORD_IMP: [string, Implement][] = [
  ['smith', 'smith'], ['landmine', 'barbell'], ['tbar', 'barbell'], ['trap bar', 'barbell'], ['ez', 'barbell'], ['kb', 'kettlebell'],
  ['band', 'band'], ['cable', 'cable'], ['rope', 'cable'], ['pulley', 'cable'], ['db', 'dumbbell'], ['barbell', 'barbell'], ['plate', 'plate'],
  ['machine', 'machine'], ['leg press', 'machine'], ['pec deck', 'machine'], ['bodyweight', 'bodyweight'], ['weighted', 'bodyweight'],
];
const hasPhrase = (ws: string[], phrase: string): boolean => {
  const t = phrase.split(' ');
  return ws.some((_, i) => t.every((x, j) => ws[i + j] === x));
};

function implementOf(ws: string[], needs: Equipment[][] | null): Implement | null {
  const named = WORD_IMP.find(([w]) => hasPhrase(ws, w));
  if (named) return named[1];
  if (!needs) return null;
  const alt = needs[0];
  if (!alt.length) return 'bodyweight';
  const main = alt.find((e) => !BENCHES.has(e));
  if (!main) return 'bodyweight'; // a bench or a rack alone: bodyweight (a split squat on a bench)
  if (BARS.has(main)) return 'barbell';
  if (main === 'dumbbells') return 'dumbbell';
  if (main === 'kettlebells') return 'kettlebell';
  if (main === 'plates') return 'plate';
  if (main === 'smith machine') return 'smith';
  if (CABLES.has(main)) return 'cable';
  if (BODY.has(main)) return 'bodyweight';
  return 'machine';
}

function gripOf(ws: string[]): Grip | null {
  if (['close grip', 'narrow grip', 'diamond', 'close'].some((p) => hasPhrase(ws, p))) return 'close';
  if (['wide grip', 'wide'].some((p) => hasPhrase(ws, p))) return 'wide';
  if (['reverse grip', 'underhand', 'supinated', 'chinup', 'chin'].some((p) => hasPhrase(ws, p))) return 'underhand';
  if (['neutral grip', 'neutral', 'hammer', 'vbar'].some((p) => hasPhrase(ws, p))) return 'neutral';
  return null;
}

const UNI = ['single arm', 'one arm', 'single leg', 'one leg', 'unilateral', 'alternate', 'alternating', 'split squat', 'lunge', 'stepup', 'kneeling db row', 'db row', 'meadow row', 'concentration', 'suitcase', 'copenhagen'];

const mainOf = (v: Vector | null): string | null => {
  let best: string | null = null, w = 0;
  for (const m of MUSCLES) if ((v?.[m] ?? 0) > w) { w = v![m]!; best = m; }
  return best;
};

const TAGS = new Map<string, Tags>();
let tagsVersion = -1;
/** A lift's tags, from its record (a catalog lift, one of its other names, or the lift it works like) and its words. */
export function tagsOf(name: string): Tags {
  const r = resolveLift(name);
  // "Works like…" changes the record a name reads, so a cached answer is only good for the facts it was read from.
  const fv = liftFactsVersion();
  if (fv !== tagsVersion) { TAGS.clear(); tagsVersion = fv; }
  const hit = TAGS.get(name);
  if (hit) return hit;
  const own = words(name);
  const ws = r.lift ? [...own, ...words(r.lift.name)] : own;
  const phrase = movementPhrase(r.lift?.name ?? name) ?? movementPhrase(name);
  let move: Move | null = r.p ?? (phrase ? MOVE_OF[phrase] ?? null : null);
  // A kickback or extension led by the glutes is a hip movement ("Cable Kickback" is the glute one).
  if (move === 'extension' && mainOf(r.m) === 'Glutes') move = 'glute';
  const t: Tags = {
    move: r.m ? move : null,
    imp: implementOf(own, null) ?? implementOf(ws, r.needs),
    ang: hasPhrase(ws, 'incline') ? 'incline' : hasPhrase(ws, 'decline') ? 'decline' : 'flat',
    grip: gripOf(ws),
    uni: UNI.some((p) => hasPhrase(ws, p)),
  };
  if (TAGS.size >= 2000) TAGS.clear();
  TAGS.set(name, t);
  return t;
}

// Similarity (00-core §1.1): s = 1[same movement] · cos(muscle vectors) · e_equip · e_angle · e_grip. Every factor is a valid
// correlation (a Gram matrix), so their product is too (Schur product theorem): s can serve as the family layer's kernel.
// The multipliers are (c) priors, shaping only how much lifts share data; nothing acts on them directly.
const CLUSTER: Record<Implement, number> = { barbell: 0, dumbbell: 0, kettlebell: 0, plate: 0, smith: 1, cable: 1, machine: 1, bodyweight: 2, band: 2 };
/** Same implement 1; DB↔BB (same cluster) 0.8; free↔machine/cable 0.6 (00-core §1.1, prior). */
export function equipSimilarity(a: Implement | null, b: Implement | null): number {
  if (a === b) return 1;
  if (a == null || b == null) return 0.6;
  return CLUSTER[a] === CLUSTER[b] ? 0.8 : 0.6;
}
const ANGLE_POS: Record<Angle, number> = { decline: 0, flat: 1, incline: 2 };
/** Same bench angle 1, adjacent 0.85, two apart 0.85² (a Laplace kernel on decline–flat–incline). */
export const angleSimilarity = (a: Angle, b: Angle): number => 0.85 ** Math.abs(ANGLE_POS[a] - ANGLE_POS[b]);
/** Same grip 1, different 0.85. */
export const gripSimilarity = (a: Grip | null, b: Grip | null): number => (a === b ? 1 : 0.85);

/** Cosine of two muscle vectors; 0 when either is unknown or empty. */
export function muscleCos(a: Vector | null, b: Vector | null): number {
  if (!a || !b) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const m of MUSCLES) { const x = a[m] ?? 0, y = b[m] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** How alike two lifts are, 0–1 (1: the same lift, or tagged identically). */
export function liftSimilarity(a: string, b: string): number {
  const ta = tagsOf(a), tb = tagsOf(b);
  if (!ta.move || ta.move !== tb.move) return 0;
  return muscleCos(resolveLift(a).m, resolveLift(b).m) * equipSimilarity(ta.imp, tb.imp) * angleSimilarity(ta.ang, tb.ang) * gripSimilarity(ta.grip, tb.grip);
}

/**
 * Muscle overlap of a prior set of `prior` onto a set of `lift` (00-core §1.2): Σ_m v_prior,m·v_lift,m / Σ_m v_lift,m². 1 for the
 * same vector; 0 when either is unknown.
 */
export function overlap(prior: Vector | null, lift: Vector | null): number {
  if (!prior || !lift) return 0;
  let dot = 0, nn = 0;
  for (const m of MUSCLES) { const y = lift[m] ?? 0; if (!y) continue; dot += (prior[m] ?? 0) * y; nn += y * y; }
  return nn ? dot / nn : 0;
}

/** Every catalog lift's tags, in catalog order (the reviewed table: learn/tags.golden). */
export const catalogTags = (): { name: string; tags: Tags }[] => LIFTS.filter((l) => l.m).map((l) => ({ name: l.name, tags: tagsOf(l.name) }));
