import type { Equipment } from './equipment';
import { liftKey } from './ids';
import type { Vector } from './muscles';

// Every lift the app knows, one record each: its muscles, movement pattern, gear and rep range (round 15). The picker's
// catalog, muscles.ts's table, equipment.ts's NEEDS and the rotation's patterns are all read from here, and resolveLift says
// what any name — listed or not — counts as. Generic names only; no user data.

/**
 * The six movement patterns the main compound lifts fall into, for rotating a plateaued lift to another variation of the same
 * movement (src/domain/rotation). Arms, calves, core, isolation, bodyweight presses, glute and erector work and cardio have none.
 */
export const PATTERNS = ['Horizontal press', 'Horizontal pull', 'Vertical press', 'Vertical pull', 'Squat', 'Hinge'] as const;
export type Pattern = (typeof PATTERNS)[number];

/** Alternative gear sets; any one set, fully present, is enough. [[]] = nothing needed. */
export type Needs = Equipment[][];

/**
 * `m`: muscle weights — 1 trains it directly (the only weight the program builder counts), ¾ nearly, ½ indirectly, ¼ a little;
 * null for cardio, which counts minutes. `needs`: null when the gear is unknown. `p`: its movement pattern, if one of the six.
 * `iso`: isolation, so a 10–15 rep default. `hidden`: known by name but not offered in the picker.
 */
export interface Lift { name: string; m: Vector | null; needs: Needs | null; p?: Pattern; iso?: true; hidden?: true }

const PRESS: Vector = { Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 };
const OHP: Vector = { 'Front Delts': 1, Triceps: 0.5, 'Side Delts': 0.5 };
const ROW_MID: Vector = { 'Mid-Back': 1, Lats: 0.5, 'Rear Delts': 0.5, Biceps: 0.5, Forearms: 0.5 };
const ROW_LAT: Vector = { Lats: 1, 'Mid-Back': 0.5, 'Rear Delts': 0.5, Biceps: 0.5, Forearms: 0.5 };
// Vertical pulls: the lats lead them all; an underhand or close grip brings the biceps in more. Surface EMG: a chin-up works the
// biceps more than a pull-up, the lats about the same, and a pull-up the lower traps more (Youdas et al. 2010, JSCR 24(12));
// on the pulldown a pronated grip gives the lats more than a supinated one, and grip width changes little (Signorile et al.
// 2002, JSCR 16(4); Lusk et al. 2010, JSCR 24(7); Andersen et al. 2014, JSCR 28(4)). The differences are modest, so the
// change is too: the biceps go from ½ to ¾ on the chin-up and the close-grip pulldown (done underhand or with a V-bar), short
// of direct work, so neither ever stands in for curls; everything else stays. Rows already split by main muscle (mid-back or lats).
const PULLDOWN: Vector = { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5, Forearms: 0.5 };
const CHIN: Vector = { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.75, Forearms: 0.5 };
const SQUAT: Vector = { Quads: 1, Glutes: 0.5, Hamstrings: 0.5 };
const HINGE: Vector = { Hamstrings: 1, Glutes: 0.5, Erectors: 0.5 };
const LEGCURL: Vector = { Hamstrings: 1 };
const B: Vector = { Biceps: 1 }, T: Vector = { Triceps: 1 }, A: Vector = { Abs: 1 }, SD: Vector = { 'Side Delts': 1 }, RD: Vector = { 'Rear Delts': 1 };

const NOTHING: Needs = [[]];
const one = (...alts: Equipment[]): Needs => alts.map((e) => [e]);
const L = (name: string, m: Vector | null, needs: Needs | null, more: Omit<Lift, 'name' | 'm' | 'needs'> = {}): Lift => ({ name, m, needs, ...more });

/** In the picker's order. */
export const LIFTS: Lift[] = [
  // Chest
  L('Bench Press', PRESS, [['barbell', 'flat bench']], { p: 'Horizontal press' }),
  L('Incline Bench Press', PRESS, [['barbell', 'incline bench']], { p: 'Horizontal press' }),
  L('Smith Incline Press', PRESS, [['smith machine', 'incline bench']], { p: 'Horizontal press' }),
  L('Smith Flat Press', PRESS, [['smith machine', 'flat bench']], { p: 'Horizontal press' }),
  L('Incline DB Press', PRESS, [['dumbbells', 'incline bench']], { p: 'Horizontal press' }),
  L('Flat DB Press', PRESS, [['dumbbells', 'flat bench']], { p: 'Horizontal press' }),
  L('Machine Chest Press', PRESS, one('chest press machine'), { p: 'Horizontal press' }),
  L('Machine Chest Fly', { Chest: 1 }, one('pec deck'), { iso: true }),
  L('Cable Chest Fly', { Chest: 1 }, one('dual cable'), { iso: true }),
  L('Low-to-High Cable Fly', { Chest: 1, 'Front Delts': 0.5 }, one('dual cable'), { iso: true }),
  L('Forward-Lean Dips', PRESS, one('dip station')),
  L('Push-up', PRESS, NOTHING),
  L('Weighted Push-up', PRESS, one('plates', 'dumbbells')),
  // Triceps
  L('Cable Pushdown', T, one('cable stack'), { iso: true }),
  L('Rope Pushdown', T, one('cable stack'), { iso: true }),
  L('Overhead Cable Extension', T, one('cable stack'), { iso: true }),
  L('Overhead DB Triceps Extension', T, one('dumbbells'), { iso: true }),
  L('Skullcrusher', T, [['barbell', 'flat bench'], ['dumbbells', 'flat bench']]),
  L('Close-Grip Bench Press', { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 }, [['barbell', 'flat bench'], ['smith machine', 'flat bench']], { p: 'Horizontal press' }),
  L('DB Kickback', T, one('dumbbells'), { iso: true }),
  L('Cable Kickback', { Glutes: 1, Hamstrings: 0.5 }, one('cable stack'), { iso: true }),
  L('Triceps Press Machine', T, one('triceps machine')),
  L('Upright Dips', { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 }, one('dip station')),
  // Biceps / forearms
  L('DB Curl', B, one('dumbbells'), { iso: true }),
  L('Incline DB Curl', B, [['dumbbells', 'incline bench']], { iso: true }),
  L('Hammer Curl', { Biceps: 1, Forearms: 0.5 }, one('dumbbells'), { iso: true }),
  L('Cable Curl', B, one('cable stack'), { iso: true }),
  L('Bayesian Cable Curl', B, one('cable stack'), { iso: true }),
  L('Preacher Curl', B, [['preacher bench', 'dumbbells'], ['preacher bench', 'barbell']], { iso: true }),
  L('Cross-Body DB Curl', { Biceps: 1, Forearms: 0.5 }, one('dumbbells'), { iso: true }),
  L('Machine Biceps Curl', B, one('biceps curl machine'), { iso: true }),
  L('Reverse Curl', { Forearms: 1, Biceps: 0.5 }, one('barbell', 'cable stack', 'dumbbells'), { iso: true }),
  L('Wrist Curl', { Forearms: 1 }, one('dumbbells', 'barbell'), { iso: true }),
  L('Farmer’s Carry', { Forearms: 1, Traps: 0.5 }, one('dumbbells')),
  L('Plate Pinch Hold', { Forearms: 1 }, one('plates')),
  // Shoulders
  L('Overhead Press', OHP, [['barbell', 'squat rack']], { p: 'Vertical press' }),
  L('Machine Shoulder Press', OHP, one('shoulder press machine'), { p: 'Vertical press' }),
  L('DB Shoulder Press', OHP, one('dumbbells'), { p: 'Vertical press' }),
  L('Arnold Press', OHP, one('dumbbells'), { p: 'Vertical press' }),
  L('DB Lateral Raise', SD, one('dumbbells'), { iso: true }),
  L('Cable Lateral Raise', SD, one('cable stack'), { iso: true }),
  L('Machine Lateral Raise', SD, one('lateral raise machine'), { iso: true }),
  L('Front Raise', { 'Front Delts': 1 }, one('dumbbells', 'plates', 'cable stack'), { iso: true }),
  L('Face Pull', { 'Rear Delts': 1, 'Mid-Back': 0.5, Traps: 0.5 }, one('cable stack'), { iso: true }),
  L('Cable Rear Delt Fly', RD, one('dual cable', 'cable stack'), { iso: true }),
  L('Reverse Pec Deck', RD, one('pec deck'), { iso: true }),
  // Back
  L('Lat Pulldown', PULLDOWN, one('lat pulldown'), { p: 'Vertical pull' }),
  L('Close-Grip Lat Pulldown', CHIN, one('lat pulldown'), { p: 'Vertical pull' }),
  L('Lat Pull-In', PULLDOWN, one('cable stack'), { iso: true }),
  L('Pull-up', PULLDOWN, one('pull-up bar'), { p: 'Vertical pull' }),
  L('Chin-up', CHIN, one('pull-up bar'), { p: 'Vertical pull' }),
  L('Seated Cable Row', ROW_MID, one('cable stack'), { p: 'Horizontal pull' }),
  L('Machine Row', ROW_LAT, one('row machine'), { p: 'Horizontal pull' }),
  L('Chest-Supported Row', ROW_MID, [['row machine'], ['dumbbells', 'incline bench']], { p: 'Horizontal pull' }),
  L('Kneeling DB Row', ROW_MID, [['dumbbells', 'flat bench']], { p: 'Horizontal pull' }),
  L('Archer Pull', { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5 }, one('cable stack')),
  L('Straight-Arm Pulldown', { Lats: 1 }, one('cable stack', 'lat pulldown')),
  // Abs / core / back health
  L('Cable Crunch', A, one('cable stack'), { iso: true }),
  L('Ab Crunch Machine', A, one('ab crunch machine'), { iso: true }),
  L('Decline Sit-up', A, one('decline bench'), { iso: true }),
  L('Hanging Leg Raise', A, one('pull-up bar'), { iso: true }),
  L('Supported Leg Raise', A, one('captain’s chair', 'dip station'), { iso: true }),
  L('Torso Rotation Machine', A, one('torso rotation machine'), { iso: true }),
  L('Plank', A, NOTHING),
  L('Side Plank', { Abs: 1, Erectors: 0.5 }, NOTHING),
  L('Bird Dog', { Erectors: 1, Glutes: 0.5, Abs: 0.5 }, NOTHING),
  L('McGill Curl-Up', A, NOTHING, { iso: true }),
  L('Dead Bug', A, NOTHING),
  L('Back Extension', { Erectors: 1, Glutes: 0.5, Hamstrings: 0.5 }, one('back extension bench'), { iso: true }),
  L('Pallof Press', A, one('cable stack')),
  // Legs
  L('Leg Press', SQUAT, one('leg press'), { p: 'Squat' }),
  L('Leg Extension', { Quads: 1 }, one('leg extension'), { iso: true }),
  L('Seated Leg Curl', LEGCURL, one('seated leg curl'), { iso: true }),
  L('Lying Leg Curl', LEGCURL, one('lying leg curl'), { iso: true }),
  L('Deadlift', HINGE, one('barbell'), { p: 'Hinge' }),
  L('Romanian Deadlift', HINGE, one('barbell'), { p: 'Hinge' }),
  L('DB Romanian Deadlift', HINGE, one('dumbbells'), { p: 'Hinge' }),
  L('Barbell Squat', SQUAT, [['barbell', 'squat rack']], { p: 'Squat' }),
  L('Smith Squat', SQUAT, one('smith machine'), { p: 'Squat' }),
  L('Front Squat', SQUAT, [['barbell', 'squat rack']], { p: 'Squat' }),
  L('Pendulum Squat', SQUAT, one('pendulum squat'), { p: 'Squat' }),
  L('Bulgarian Split Squat', SQUAT, one('flat bench'), { p: 'Squat' }),
  L('Hip Thrust', { Glutes: 1, Hamstrings: 0.5 }, [['barbell', 'hip thrust bench'], ['barbell', 'flat bench'], ['smith machine', 'flat bench']]),
  L('Glute Press', { Glutes: 1, Hamstrings: 0.5 }, one('glute press')),
  L('Hip Adduction Machine', { Adductors: 1 }, one('hip adduction machine'), { iso: true }),
  L('Hip Abduction Machine', { Abductors: 1 }, one('hip abduction machine'), { iso: true }),
  L('Standing Calf Raise', { Calves: 1 }, one('standing calf machine', 'smith machine', 'dumbbells'), { iso: true }),
  L('Seated Calf Raise', { Calves: 1 }, one('seated calf machine'), { iso: true }),
  // Landmine (a bar anchored at one end)
  L('Landmine Press', { 'Front Delts': 1, Chest: 0.5, Triceps: 0.5 }, [['landmine', 'barbell']], { p: 'Vertical press' }),
  L('Landmine Row', ROW_LAT, [['landmine', 'barbell']], { p: 'Horizontal pull' }),
  L('T-Bar Row', ROW_MID, [['landmine', 'barbell']], { p: 'Horizontal pull' }),
  L('Landmine Squat', SQUAT, [['landmine', 'barbell']], { p: 'Squat' }),
  L('Landmine Rotation', { Abs: 1, 'Front Delts': 0.25 }, [['landmine', 'barbell']], { iso: true }),
  // Cardio: minutes, not muscles
  L('Treadmill', null, one('treadmill')),
  L('StairMaster', null, one('stair climber')),
  L('Exercise Bike', null, one('exercise bike')),
  L('Elliptical', null, one('elliptical')),
  // Known by name, not listed: generic names logged before the catalog had them. Gear unknown.
  L('close-grip push-up', { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 }, null, { hidden: true }),
  L('close-grip smith press', { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 }, null, { hidden: true }),
  L('dips', PRESS, null, { hidden: true }),
  L('incline bench pushdown', T, null, { iso: true, hidden: true }),
  L('db reverse curl', { Forearms: 1, Biceps: 0.5 }, null, { iso: true, hidden: true }),
  L('zottman curl', { Biceps: 1, Forearms: 0.5 }, null, { iso: true, hidden: true }),
  L('db wrist curl', { Forearms: 1 }, null, { iso: true, hidden: true }),
  L('db reverse wrist curl', { Forearms: 1 }, null, { iso: true, hidden: true }),
  L('overhead db press', OHP, null, { hidden: true }),
  L('decline crunch (weighted)', A, null, { iso: true, hidden: true }),
  L('leg raise', A, null, { iso: true, hidden: true }),
  L('db calf raise', { Calves: 1 }, null, { iso: true, hidden: true }),
];

// A name the table doesn't know, read from its words. Order matters (leg curl before curl; row before bench, so a
// bench-supported row is back work), and words need boundaries: "machine" contains "chin" and "narrow" contains "row".
const KEYWORDS: [RegExp, Vector][] = [
  [/\bleg curl|\bham(string)? curl|\bnordic/i, LEGCURL], [/\bwrist curl/i, { Forearms: 1 }], [/\bcurl/i, B],
  [/pushdown|push down|kickback|skull|\btriceps? ext|french press/i, T],
  [/lateral raise|side raise|upright row/i, SD], [/rear delt|reverse fly|reverse pec|face pull/i, RD],
  [/\bsquat|leg press|\blunge|step-?up|\bhack\b/i, SQUAT], [/deadlift|good morning|\bhinge|\brdl\b/i, HINGE], [/leg ext/i, { Quads: 1 }],
  [/\bcalf|\bcalves/i, { Calves: 1 }], [/hip thrust|\bglute/i, { Glutes: 1, Hamstrings: 0.5 }],
  [/\bfly\b|\bflyes?\b|pec deck/i, { Chest: 1 }], [/overhead press|shoulder press|military|\bohp\b/i, OHP],
  [/\brows?\b/i, ROW_MID],
  [/bench|chest press|incline.*\bpress|push-?up|\bdips?\b/i, PRESS],
  [/\bchin(-?ups?)?\b|(supinated|underhand|reverse[- ]?grip|close[- ]?grip|narrow[- ]?grip|\bv-?bar\b).*(pull-?down|pull-?up)/i, CHIN],
  [/pulldown|pull-?up/i, PULLDOWN],
  [/crunch|sit-?up|plank|leg raise|\babs?\b/i, A],
];
const ISOLATION = /(curl|raise|fly|flye|extension|pushdown|push down|kickback|crunch|calf|face pull|rear delt|shrug|pec deck|pull-in|pullover|wrist|leg raise|sit-up|rotation|abduction|adduction)/i;
/** Words that make a lift not one of the six, though it has a pattern word in it ("Straight-Arm Pulldown", "Upright Row"). */
const NOT_A_PATTERN = /straight[- ]?arm|pull-?over|upright row|face pull|\bshrug/i;
/** First match wins: "Bench-Supported Row" is a row. */
const WORDS: [RegExp, Pattern][] = [
  [/deadlift|\brdl\b|good morning/i, 'Hinge'],
  [/\bsquat|leg press|\bhack\b/i, 'Squat'],
  [/\brows?\b/i, 'Horizontal pull'],
  [/pull-?downs?\b|pull-?ups?\b|chin-?ups?\b/i, 'Vertical pull'],
  [/overhead press|shoulder press|military|\bohp\b|push press|viking/i, 'Vertical press'],
  [/bench|chest press|floor press|incline.*\bpress/i, 'Horizontal press'],
];

/** How a name's facts were found: its record in the table, its words, or not at all. */
export type How = 'catalog' | 'built' | 'none';
/** What a lift name counts as. `lift`: its record, when the table has one. */
export interface Resolved { m: Vector | null; p: Pattern | null; needs: Needs | null; iso: boolean; how: How; lift?: Lift }

const BY_KEY = new Map(LIFTS.map((l) => [liftKey(l.name), l]));

function resolve(name: string): Resolved {
  const k = liftKey(name);
  const lift = BY_KEY.get(k);
  if (lift) return { m: lift.m, p: lift.p ?? null, needs: lift.needs, iso: !!lift.iso, how: 'catalog', lift };
  const iso = ISOLATION.test(name);
  const m = KEYWORDS.find(([re]) => re.test(k))?.[1] ?? null;
  const p = iso || NOT_A_PATTERN.test(k) ? null : WORDS.find(([re]) => re.test(k))?.[1] ?? null;
  return { m, p, needs: null, iso, how: m || p ? 'built' : 'none' };
}

// A pure function of the name, read for every set in whole-log passes: worked out once per distinct name. Bounded like liftKey.
const RESOLVED = new Map<string, Resolved>();
/** What a lift name counts as: its muscles, pattern, gear and rep range, and how that was found. */
export function resolveLift(name: string): Resolved {
  let r = RESOLVED.get(name);
  if (r === undefined) {
    r = resolve(name);
    if (RESOLVED.size >= 2000) RESOLVED.clear();
    RESOLVED.set(name, r);
  }
  return r;
}
