import type { Equipment } from './equipment';
import { nameKey } from './ids';
import type { Muscle, Vector } from './muscles';

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
 * `iso`: isolation, so a 10–15 rep default. `aka`: other names it goes by (search, paste import, a typed name). `common`: listed
 * before searching. `program`: one the program builder, swaps and rotation may offer unasked; any other lift enters a program
 * only once it's logged or added to the gym (round 15, owner).
 */
export interface Lift { name: string; m: Vector | null; needs: Needs | null; p?: Pattern; iso?: true; aka?: string[]; common?: true; program?: true }

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
const CLOSE: Vector = { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 };
const B: Vector = { Biceps: 1 }, T: Vector = { Triceps: 1 }, A: Vector = { Abs: 1 }, SD: Vector = { 'Side Delts': 1 }, RD: Vector = { 'Rear Delts': 1 };
const UPRIGHT: Vector = { 'Side Delts': 1, Traps: 0.5 }, FACE: Vector = { 'Rear Delts': 1, 'Mid-Back': 0.5, Traps: 0.5 };
const GLUTE: Vector = { Glutes: 1, Hamstrings: 0.5 }, BACK_EXT: Vector = { Erectors: 1, Glutes: 0.5, Hamstrings: 0.5 };
const CHEST: Vector = { Chest: 1 }, QUADS: Vector = { Quads: 1 }, CALVES: Vector = { Calves: 1 }, F: Vector = { Forearms: 1 }, LATS: Vector = { Lats: 1 };
const CARRY: Vector = { Forearms: 1, Traps: 0.5 }, OTHER: Vector = {};

const NOTHING: Needs = [[]];
const one = (...alts: Equipment[]): Needs => alts.map((e) => [e]);
const L = (name: string, m: Vector | null, needs: Needs | null, more: Omit<Lift, 'name' | 'm' | 'needs'> = {}): Lift => ({ name, m, needs, ...more });

/** The lifts the app listed before round 15, in their order: all common, and the program builder's pool. */
const ORIGINAL: Lift[] = [
  // Chest
  L('Bench Press', PRESS, [['barbell', 'flat bench']], { p: 'Horizontal press', aka: ['Flat Bench Press', 'Barbell Bench Press', 'Barbell Bench Press - Medium Grip', 'Bench Press - Powerlifting'] }),
  L('Incline Bench Press', PRESS, [['barbell', 'incline bench']], { p: 'Horizontal press', aka: ['Incline Barbell Press'] }),
  L('Smith Incline Press', PRESS, [['smith machine', 'incline bench']], { p: 'Horizontal press' }),
  L('Smith Flat Press', PRESS, [['smith machine', 'flat bench']], { p: 'Horizontal press', aka: ['Smith Bench Press', 'Smith Machine Bench Press'] }),
  L('Incline DB Press', PRESS, [['dumbbells', 'incline bench']], { p: 'Horizontal press', aka: ['Incline Dumbbell Bench With Palms Facing In'] }),
  L('Flat DB Press', PRESS, [['dumbbells', 'flat bench']], { p: 'Horizontal press', aka: ['DB Bench Press'] }),
  L('Machine Chest Press', PRESS, one('chest press machine'), { p: 'Horizontal press', aka: ['Seated Chest Press', 'Leverage Chest Press', 'Machine Bench Press'] }),
  L('Machine Chest Fly', { Chest: 1 }, one('pec deck'), { iso: true, aka: ['Pec Deck', 'Pec Fly', 'Butterfly'] }),
  L('Cable Chest Fly', { Chest: 1 }, one('dual cable'), { iso: true }),
  L('Low-to-High Cable Fly', { Chest: 1, 'Front Delts': 0.5 }, one('dual cable'), { iso: true }),
  L('Forward-Lean Dips', PRESS, one('dip station'), { aka: ['Dips', 'Chest Dip'] }),
  L('Push-up', PRESS, NOTHING),
  L('Weighted Push-up', PRESS, one('plates', 'dumbbells')),
  // Triceps
  L('Cable Pushdown', T, one('cable stack'), { iso: true, aka: ['Triceps Pushdown', 'Triceps Pushdown - V-Bar Attachment'] }),
  L('Rope Pushdown', T, one('cable stack'), { iso: true, aka: ['Triceps Pushdown - Rope Attachment'] }),
  L('Overhead Cable Extension', T, one('cable stack'), { iso: true, aka: ['Triceps Overhead Extension with Rope'] }),
  L('Overhead DB Triceps Extension', T, one('dumbbells'), { iso: true, aka: ['Standing Dumbbell Triceps Extension', 'Seated Triceps Press'] }),
  L('Skullcrusher', T, [['barbell', 'flat bench'], ['dumbbells', 'flat bench']], { aka: ['Lying Triceps Extension'] }),
  L('Close-Grip Bench Press', CLOSE, [['barbell', 'flat bench'], ['smith machine', 'flat bench']], { p: 'Horizontal press', aka: ['Close-Grip Barbell Bench Press'] }),
  L('DB Kickback', T, one('dumbbells'), { iso: true, aka: ['Triceps Kickback', 'Tricep Dumbbell Kickback'] }),
  L('Cable Kickback', { Glutes: 1, Hamstrings: 0.5 }, one('cable stack'), { iso: true, aka: ['Cable Glute Kickback', 'One-Legged Cable Kickback'] }),
  L('Triceps Press Machine', T, one('triceps machine')),
  L('Upright Dips', CLOSE, one('dip station'), { aka: ['Triceps Dips', 'Dips - Triceps Version'] }),
  // Biceps / forearms
  L('DB Curl', B, one('dumbbells'), { iso: true, aka: ['Dumbbell Biceps Curl', 'Dumbbell Alternate Bicep Curl', 'Seated Dumbbell Curl'] }),
  L('Incline DB Curl', B, [['dumbbells', 'incline bench']], { iso: true, aka: ['Alternate Incline Dumbbell Curl'] }),
  L('Hammer Curl', { Biceps: 1, Forearms: 0.5 }, one('dumbbells'), { iso: true, aka: ['DB Hammer Curl', 'Alternate Hammer Curl'] }),
  L('Cable Curl', B, one('cable stack'), { iso: true, aka: ['Standing Biceps Cable Curl', 'Standing One-Arm Cable Curl'] }),
  L('Bayesian Cable Curl', B, one('cable stack'), { iso: true }),
  L('Preacher Curl', B, [['preacher bench', 'dumbbells'], ['preacher bench', 'barbell']], { iso: true, aka: ['Two-Arm Dumbbell Preacher Curl'] }),
  L('Cross-Body DB Curl', { Biceps: 1, Forearms: 0.5 }, one('dumbbells'), { iso: true, aka: ['Cross Body Hammer Curl'] }),
  L('Machine Biceps Curl', B, one('biceps curl machine'), { iso: true, aka: ['Machine Preacher Curls'] }),
  L('Reverse Curl', { Forearms: 1, Biceps: 0.5 }, one('barbell', 'cable stack', 'dumbbells'), { iso: true, aka: ['Reverse Barbell Curl', 'Reverse Cable Curl'] }),
  L('Wrist Curl', { Forearms: 1 }, one('dumbbells', 'barbell'), { iso: true, aka: ['Palms-Up Barbell Wrist Curl Over A Bench', 'Seated Palm-Up Barbell Wrist Curl'] }),
  L('Farmer’s Carry', { Forearms: 1, Traps: 0.5 }, one('dumbbells')),
  L('Plate Pinch Hold', { Forearms: 1 }, one('plates')),
  // Shoulders
  L('Overhead Press', OHP, [['barbell', 'squat rack']], { p: 'Vertical press', aka: ['Military Press', 'Standing Barbell Press', 'Standing Military Press', 'Barbell Shoulder Press'] }),
  L('Machine Shoulder Press', OHP, one('shoulder press machine'), { p: 'Vertical press', aka: ['Leverage Shoulder Press', 'Machine Shoulder (Military) Press'] }),
  L('DB Shoulder Press', OHP, one('dumbbells'), { p: 'Vertical press', aka: ['Overhead DB Press', 'Seated DB Shoulder Press', 'Seated Dumbbell Press', 'Standing Dumbbell Press', 'Dumbbell One-Arm Shoulder Press'] }),
  L('Arnold Press', OHP, one('dumbbells'), { p: 'Vertical press', aka: ['Arnold Dumbbell Press'] }),
  L('DB Lateral Raise', SD, one('dumbbells'), { iso: true, aka: ['Lateral Raise', 'Side Lateral Raise', 'Seated Side Lateral Raise', 'One-Arm Side Laterals'] }),
  L('Cable Lateral Raise', SD, one('cable stack'), { iso: true, aka: ['Cable Seated Lateral Raise'] }),
  L('Machine Lateral Raise', SD, one('lateral raise machine'), { iso: true }),
  L('Front Raise', { 'Front Delts': 1 }, one('dumbbells', 'plates', 'cable stack'), { iso: true, aka: ['Front Dumbbell Raise', 'Front Two-Dumbbell Raise'] }),
  L('Face Pull', { 'Rear Delts': 1, 'Mid-Back': 0.5, Traps: 0.5 }, one('cable stack'), { iso: true }),
  L('Cable Rear Delt Fly', RD, one('dual cable', 'cable stack'), { iso: true }),
  L('Reverse Pec Deck', RD, one('pec deck'), { iso: true, aka: ['Rear Delt Machine', 'Reverse Machine Flyes'] }),
  // Back
  L('Lat Pulldown', PULLDOWN, one('lat pulldown'), { p: 'Vertical pull', aka: ['Wide-Grip Lat Pulldown', 'Full Range-Of-Motion Lat Pulldown'] }),
  L('Close-Grip Lat Pulldown', CHIN, one('lat pulldown'), { p: 'Vertical pull' }),
  L('Lat Pull-In', PULLDOWN, one('cable stack'), { iso: true }),
  L('Pull-up', PULLDOWN, one('pull-up bar'), { p: 'Vertical pull' }),
  L('Chin-up', CHIN, one('pull-up bar'), { p: 'Vertical pull' }),
  L('Seated Cable Row', ROW_MID, one('cable stack'), { p: 'Horizontal pull', aka: ['Cable Row'] }),
  L('Machine Row', ROW_LAT, one('row machine'), { p: 'Horizontal pull', aka: ['Leverage Iso Row'] }),
  L('Chest-Supported Row', ROW_MID, [['row machine'], ['dumbbells', 'incline bench']], { p: 'Horizontal pull', aka: ['Incline DB Row'] }),
  L('Kneeling DB Row', ROW_MID, [['dumbbells', 'flat bench']], { p: 'Horizontal pull' }),
  L('Archer Pull', { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5 }, one('cable stack')),
  L('Straight-Arm Pulldown', { Lats: 1 }, one('cable stack', 'lat pulldown'), { aka: ['Rope Straight-Arm Pulldown'] }),
  // Abs / core / back health
  L('Cable Crunch', A, one('cable stack'), { iso: true, aka: ['Kneeling Cable Crunch', 'Rope Crunch', 'Standing Rope Crunch'] }),
  L('Ab Crunch Machine', A, one('ab crunch machine'), { iso: true, aka: ['Machine Crunch'] }),
  L('Decline Sit-up', A, one('decline bench'), { iso: true }),
  L('Hanging Leg Raise', A, one('pull-up bar'), { iso: true }),
  L('Supported Leg Raise', A, one('captain’s chair', 'dip station'), { iso: true, aka: ['Captain’s Chair Leg Raise', 'Roman Chair Leg Raise'] }),
  L('Torso Rotation Machine', A, one('torso rotation machine'), { iso: true }),
  L('Plank', A, NOTHING),
  L('Side Plank', { Abs: 1, Erectors: 0.5 }, NOTHING),
  L('Bird Dog', { Erectors: 1, Glutes: 0.5, Abs: 0.5 }, NOTHING),
  L('McGill Curl-Up', A, NOTHING, { iso: true }),
  L('Dead Bug', A, NOTHING),
  L('Back Extension', { Erectors: 1, Glutes: 0.5, Hamstrings: 0.5 }, one('back extension bench'), { iso: true, aka: ['Hyperextension', '45-Degree Back Extension'] }),
  L('Pallof Press', A, one('cable stack')),
  // Legs
  L('Leg Press', SQUAT, one('leg press'), { p: 'Squat' }),
  L('Leg Extension', { Quads: 1 }, one('leg extension'), { iso: true, aka: ['Single-Leg Leg Extension'] }),
  L('Seated Leg Curl', LEGCURL, one('seated leg curl'), { iso: true }),
  L('Lying Leg Curl', LEGCURL, one('lying leg curl'), { iso: true }),
  L('Deadlift', HINGE, one('barbell'), { p: 'Hinge', aka: ['Conventional Deadlift', 'Barbell Deadlift'] }),
  L('Romanian Deadlift', HINGE, one('barbell'), { p: 'Hinge', aka: ['Barbell RDL'] }),
  L('DB Romanian Deadlift', HINGE, one('dumbbells'), { p: 'Hinge' }),
  L('Barbell Squat', SQUAT, [['barbell', 'squat rack']], { p: 'Squat', aka: ['Back Squat'] }),
  L('Smith Squat', SQUAT, one('smith machine'), { p: 'Squat', aka: ['Smith Machine Squat'] }),
  L('Front Squat', SQUAT, [['barbell', 'squat rack']], { p: 'Squat', aka: ['Front Barbell Squat', 'Front Squat (Clean Grip)'] }),
  L('Pendulum Squat', SQUAT, one('pendulum squat'), { p: 'Squat' }),
  L('Bulgarian Split Squat', SQUAT, one('flat bench'), { p: 'Squat' }),
  L('Hip Thrust', { Glutes: 1, Hamstrings: 0.5 }, [['barbell', 'hip thrust bench'], ['barbell', 'flat bench'], ['smith machine', 'flat bench']], { aka: ['Barbell Hip Thrust'] }),
  L('Glute Press', { Glutes: 1, Hamstrings: 0.5 }, one('glute press')),
  L('Hip Adduction Machine', { Adductors: 1 }, one('hip adduction machine'), { iso: true, aka: ['Adductor Machine', 'Thigh Adductor'] }),
  L('Hip Abduction Machine', { Abductors: 1 }, one('hip abduction machine'), { iso: true, aka: ['Abductor Machine', 'Thigh Abductor'] }),
  L('Standing Calf Raise', { Calves: 1 }, one('standing calf machine', 'smith machine', 'dumbbells'), { iso: true }),
  L('Seated Calf Raise', { Calves: 1 }, one('seated calf machine'), { iso: true }),
  // Landmine (a bar anchored at one end)
  L('Landmine Press', { 'Front Delts': 1, Chest: 0.5, Triceps: 0.5 }, [['landmine', 'barbell']], { p: 'Vertical press' }),
  L('Landmine Row', ROW_LAT, [['landmine', 'barbell']], { p: 'Horizontal pull' }),
  L('T-Bar Row', ROW_MID, [['landmine', 'barbell']], { p: 'Horizontal pull', aka: ['T-Bar Row with Handle'] }),
  L('Landmine Squat', SQUAT, [['landmine', 'barbell']], { p: 'Squat' }),
  L('Landmine Rotation', { Abs: 1, 'Front Delts': 0.25 }, [['landmine', 'barbell']], { iso: true, aka: ['Landmine 180'] }),
  // Cardio: minutes, not muscles
  L('Treadmill', null, one('treadmill')),
  L('StairMaster', null, one('stair climber')),
  L('Exercise Bike', null, one('exercise bike')),
  L('Elliptical', null, one('elliptical')),
];

/** Added in round 15: names and tags only from free-exercise-db (Unlicense), plus modern lifts it lacks. */
const ADDED: Lift[] = [
  // Chest
  L('Decline Bench Press', PRESS, [['barbell', 'decline bench']], { p: 'Horizontal press', common: true, aka: ['Decline Barbell Bench Press'] }),
  L('Wide-Grip Bench Press', PRESS, [['barbell', 'flat bench']], { p: 'Horizontal press', aka: ['Wide-Grip Barbell Bench Press'] }),
  L('Floor Press', PRESS, one('barbell'), { p: 'Horizontal press', aka: ['Barbell Floor Press'] }),
  L('DB Floor Press', PRESS, one('dumbbells'), { p: 'Horizontal press' }),
  L('Decline DB Press', PRESS, [['dumbbells', 'decline bench']], { p: 'Horizontal press', aka: ['Decline Dumbbell Bench Press'] }),
  L('Smith Decline Press', PRESS, [['smith machine', 'decline bench']], { p: 'Horizontal press', aka: ['Smith Machine Decline Press'] }),
  L('Machine Incline Chest Press', PRESS, one('chest press machine'), { p: 'Horizontal press' }),
  L('Machine Decline Chest Press', PRESS, one('chest press machine'), { p: 'Horizontal press', aka: ['Leverage Decline Chest Press'] }),
  L('Cable Chest Press', PRESS, one('cable stack'), { p: 'Horizontal press', aka: ['Standing Cable Chest Press'] }),
  L('DB Fly', CHEST, [['dumbbells', 'flat bench']], { iso: true, common: true, aka: ['Flat DB Fly'] }),
  L('Incline DB Fly', CHEST, [['dumbbells', 'incline bench']], { iso: true }),
  L('Decline DB Fly', CHEST, [['dumbbells', 'decline bench']], { iso: true }),
  L('Incline Cable Fly', CHEST, one('dual cable'), { iso: true }),
  L('High-to-Low Cable Fly', CHEST, one('dual cable'), { iso: true }),
  L('DB Squeeze Press', PRESS, one('dumbbells'), { p: 'Horizontal press', aka: ['Squeeze Press'] }),
  L('Svend Press', CHEST, one('plates'), { iso: true, aka: ['Plate Squeeze'] }),
  L('DB Pullover', { Chest: 1, Lats: 0.5 }, [['dumbbells', 'flat bench']], { iso: true, common: true, aka: ['Bent-Arm Dumbbell Pullover', 'Straight-Arm Dumbbell Pullover'] }),
  L('Barbell Pullover', { Chest: 1, Lats: 0.5 }, [['barbell', 'flat bench']], { iso: true, aka: ['Bent-Arm Barbell Pullover'] }),
  L('Incline Push-up', PRESS, NOTHING, { aka: ['Incline Push-Up Medium'] }),
  L('Decline Push-up', PRESS, NOTHING, { aka: ['Feet-Elevated Push-up'] }),
  // Triceps
  L('Close-Grip Push-up', CLOSE, NOTHING, { aka: ['Push-Ups - Close Triceps Position'] }),
  L('Diamond Push-up', CLOSE, NOTHING),
  L('Close-Grip Smith Press', CLOSE, one('smith machine'), { p: 'Horizontal press', aka: ['Smith Close-Grip Bench Press', 'Smith Machine Close-Grip Bench Press'] }),
  L('Close-Grip DB Press', CLOSE, one('dumbbells'), { p: 'Horizontal press' }),
  L('Incline Bench Pushdown', T, one('cable stack'), { iso: true }),
  L('EZ-Bar Skullcrusher', T, [['ez bar', 'flat bench']], { common: true }),
  L('DB Skullcrusher', T, [['dumbbells', 'flat bench']]),
  L('JM Press', T, [['barbell', 'flat bench']]),
  L('Tate Press', T, [['dumbbells', 'flat bench']]),
  L('Overhead EZ-Bar Extension', T, one('ez bar'), { iso: true }),
  L('Reverse-Grip Pushdown', T, one('cable stack'), { iso: true }),
  L('Single-Arm Cable Pushdown', T, one('cable stack'), { iso: true }),
  L('Cable Triceps Kickback', T, one('cable stack'), { iso: true }),
  L('Machine Triceps Extension', T, one('triceps machine'), { iso: true }),
  L('Bench Dip', CLOSE, one('flat bench')),
  L('Machine Dip', CLOSE, one('triceps machine')),
  // Biceps and forearms
  L('Barbell Curl', B, one('barbell'), { iso: true, common: true, aka: ['Standing Barbell Curl'] }),
  L('EZ-Bar Curl', B, one('ez bar'), { iso: true, common: true, aka: ['Close-Grip EZ Bar Curl'] }),
  L('EZ-Bar Preacher Curl', B, [['ez bar', 'preacher bench']], { iso: true }),
  L('DB Preacher Curl', B, [['dumbbells', 'preacher bench']], { iso: true }),
  L('Cable Preacher Curl', B, one('cable stack'), { iso: true }),
  L('Concentration Curl', B, one('dumbbells'), { iso: true, common: true }),
  L('Spider Curl', B, [['dumbbells', 'incline bench'], ['ez bar', 'incline bench']], { iso: true }),
  L('Drag Curl', B, one('barbell'), { iso: true, aka: ['Barbell Drag Curl'] }),
  L('Incline Hammer Curl', { Biceps: 1, Forearms: 0.5 }, [['dumbbells', 'incline bench']], { iso: true }),
  L('Cable Hammer Curl', { Biceps: 1, Forearms: 0.5 }, one('cable stack'), { iso: true, aka: ['Rope Hammer Curl', 'Cable Hammer Curls - Rope Attachment'] }),
  L('High Cable Curl', B, one('cable stack'), { iso: true }),
  L('Zottman Curl', { Biceps: 1, Forearms: 0.5 }, one('dumbbells'), { iso: true }),
  L('DB Reverse Curl', { Forearms: 1, Biceps: 0.5 }, one('dumbbells'), { iso: true, aka: ['Standing Dumbbell Reverse Curl'] }),
  L('EZ-Bar Reverse Curl', { Forearms: 1, Biceps: 0.5 }, one('ez bar'), { iso: true }),
  L('DB Wrist Curl', F, one('dumbbells'), { iso: true }),
  L('DB Reverse Wrist Curl', F, one('dumbbells'), { iso: true }),
  L('Reverse Wrist Curl', F, one('barbell', 'dumbbells'), { iso: true, aka: ['Palms-Down Wrist Curl Over A Bench', 'Seated Palms-Down Barbell Wrist Curl'] }),
  L('Cable Wrist Curl', F, one('cable stack'), { iso: true }),
  L('Finger Curl', F, one('barbell'), { iso: true }),
  L('Wrist Roller', F, one('plates'), { iso: true }),
  L('Dead Hang', F, one('pull-up bar')),
  L('Suitcase Carry', { Forearms: 1, Abs: 0.5 }, one('dumbbells')),
  // Shoulders and traps
  L('Push Press', OHP, [['barbell', 'squat rack']], { p: 'Vertical press', aka: ['Barbell Push Press'] }),
  L('Behind-the-Neck Press', OHP, [['barbell', 'squat rack']], { p: 'Vertical press', aka: ['Standing Barbell Press Behind Neck'] }),
  L('Z Press', OHP, [['barbell', 'squat rack']], { p: 'Vertical press' }),
  L('Smith Shoulder Press', OHP, one('smith machine'), { p: 'Vertical press' }),
  L('KB Overhead Press', OHP, one('kettlebells'), { p: 'Vertical press', aka: ['Two-Arm Kettlebell Military Press'] }),
  L('Upright Row', UPRIGHT, one('barbell', 'ez bar', 'cable stack', 'dumbbells'), { common: true }),
  L('Cable Upright Row', UPRIGHT, one('cable stack')),
  L('DB Upright Row', UPRIGHT, one('dumbbells'), { aka: ['Standing Dumbbell Upright Row'] }),
  L('Smith Upright Row', UPRIGHT, one('smith machine'), { aka: ['Smith Machine Upright Row'] }),
  L('Cable Front Raise', { 'Front Delts': 1 }, one('cable stack'), { iso: true }),
  L('Plate Front Raise', { 'Front Delts': 1 }, one('plates'), { iso: true }),
  L('Barbell Front Raise', { 'Front Delts': 1 }, one('barbell'), { iso: true }),
  L('DB Rear Delt Fly', RD, one('dumbbells'), { iso: true, common: true, aka: ['Rear Delt Fly', 'Bent-Over Reverse Fly', 'Seated Bent-Over Rear Delt Raise'] }),
  L('Incline DB Rear Delt Fly', RD, [['dumbbells', 'incline bench']], { iso: true, aka: ['Chest-Supported Rear Delt Fly', 'Lying Rear Delt Raise'] }),
  L('Barbell Rear Delt Row', { 'Rear Delts': 1, 'Mid-Back': 0.5 }, one('barbell'), { iso: true }),
  L('Cable Rear Delt Row', { 'Rear Delts': 1, 'Mid-Back': 0.5 }, one('cable stack'), { iso: true }),
  L('DB Y Raise', SD, one('dumbbells'), { iso: true, aka: ['Incline Y Raise'] }),
  L('Cable Y Raise', SD, one('cable stack'), { iso: true }),
  L('Lu Raise', SD, one('dumbbells', 'plates'), { iso: true }),
  L('Cable External Rotation', OTHER, one('cable stack'), { iso: true }),
  L('DB External Rotation', OTHER, one('dumbbells'), { iso: true, aka: ['Side-Lying External Rotation'] }),
  L('Cable Internal Rotation', OTHER, one('cable stack'), { iso: true }),
  L('DB Shrug', { Traps: 1 }, one('dumbbells'), { iso: true, common: true, program: true }),
  L('Barbell Shrug', { Traps: 1 }, one('barbell'), { iso: true, common: true, program: true, aka: ['Barbell Shrug Behind The Back'] }),
  L('Smith Shrug', { Traps: 1 }, one('smith machine'), { iso: true }),
  L('Cable Shrug', { Traps: 1 }, one('cable stack'), { iso: true }),
  L('Trap Bar Shrug', { Traps: 1 }, one('trap bar'), { iso: true }),
  // Back
  L('Barbell Row', ROW_MID, one('barbell'), { p: 'Horizontal pull', common: true, aka: ['Bent-Over Row', 'Bent-Over Barbell Row'] }),
  L('Pendlay Row', ROW_MID, one('barbell'), { p: 'Horizontal pull' }),
  L('Reverse-Grip Barbell Row', ROW_MID, one('barbell'), { p: 'Horizontal pull', aka: ['Yates Row', 'Reverse Grip Bent-Over Rows'] }),
  L('DB Row', ROW_MID, one('dumbbells'), { p: 'Horizontal pull', common: true, aka: ['One-Arm DB Row', 'Single-Arm DB Row'] }),
  L('Bent-Over DB Row', ROW_MID, one('dumbbells'), { p: 'Horizontal pull', aka: ['Bent Over Two-Dumbbell Row'] }),
  L('Smith Row', ROW_MID, one('smith machine'), { p: 'Horizontal pull' }),
  L('Seal Row', ROW_MID, [['barbell', 'flat bench'], ['dumbbells', 'flat bench']], { p: 'Horizontal pull' }),
  L('Meadows Row', ROW_LAT, [['landmine', 'barbell']], { p: 'Horizontal pull' }),
  L('KB Row', ROW_MID, one('kettlebells'), { p: 'Horizontal pull' }),
  L('Single-Arm Cable Row', ROW_MID, one('cable stack'), { p: 'Horizontal pull', aka: ['Seated One-arm Cable Pulley Rows'] }),
  L('Wide-Grip Cable Row', ROW_MID, one('cable stack'), { p: 'Horizontal pull' }),
  L('High Row Machine', ROW_LAT, one('row machine'), { p: 'Horizontal pull', aka: ['Leverage High Row'] }),
  L('Inverted Row', ROW_MID, one('squat rack', 'smith machine'), { p: 'Horizontal pull', aka: ['Body Row'] }),
  L('Reverse-Grip Lat Pulldown', CHIN, one('lat pulldown'), { p: 'Vertical pull', aka: ['Underhand Pulldown', 'Underhand Cable Pulldowns'] }),
  L('Single-Arm Lat Pulldown', PULLDOWN, one('lat pulldown'), { p: 'Vertical pull', aka: ['One Arm Lat Pulldown'] }),
  L('Behind-the-Neck Pulldown', PULLDOWN, one('lat pulldown'), { p: 'Vertical pull' }),
  L('Neutral-Grip Pull-up', PULLDOWN, one('pull-up bar'), { p: 'Vertical pull' }),
  L('Wide-Grip Pull-up', PULLDOWN, one('pull-up bar'), { p: 'Vertical pull', aka: ['Wide-Grip Rear Pull-Up'] }),
  L('Weighted Pull-up', PULLDOWN, one('pull-up bar'), { p: 'Vertical pull' }),
  L('Weighted Chin-up', CHIN, one('pull-up bar'), { p: 'Vertical pull' }),
  L('Cable Pullover', LATS, one('cable stack'), { iso: true, aka: ['Rope Pullover'] }),
  L('Kneeling High Pulley Row', ROW_LAT, one('cable stack'), { p: 'Horizontal pull' }),
  // Hinge, glutes, hamstrings
  L('Sumo Deadlift', { Hamstrings: 1, Glutes: 0.5, Erectors: 0.5, Adductors: 0.5 }, one('barbell'), { p: 'Hinge', common: true }),
  L('Trap Bar Deadlift', { Hamstrings: 1, Glutes: 0.5, Erectors: 0.5, Quads: 0.5 }, one('trap bar'), { p: 'Hinge', common: true }),
  L('Stiff-Leg Deadlift', HINGE, one('barbell'), { p: 'Hinge' }),
  L('DB Stiff-Leg Deadlift', HINGE, one('dumbbells'), { p: 'Hinge', aka: ['Stiff-Legged Dumbbell Deadlift'] }),
  L('Smith Romanian Deadlift', HINGE, one('smith machine'), { p: 'Hinge', aka: ['Smith Machine Stiff-Legged Deadlift'] }),
  L('Single-Leg RDL', HINGE, one('dumbbells', 'kettlebells', 'barbell'), { p: 'Hinge', aka: ['DB Single-Leg RDL'] }),
  L('KB Deadlift', HINGE, one('kettlebells'), { p: 'Hinge' }),
  L('Rack Pull', { Hamstrings: 1, Glutes: 0.5, Erectors: 0.5, Traps: 0.5 }, [['barbell', 'squat rack']], { p: 'Hinge' }),
  L('Good Morning', HINGE, [['barbell', 'squat rack']], { p: 'Hinge', aka: ['Barbell Good Morning', 'Stiff Leg Barbell Good Morning'] }),
  L('Cable Pull-Through', GLUTE, one('cable stack'), { iso: true, aka: ['Pull Through'] }),
  L('KB Swing', GLUTE, one('kettlebells'), { iso: true, common: true, aka: ['One-Arm Kettlebell Swings'] }),
  L('Glute Ham Raise', { Hamstrings: 1, Glutes: 0.5 }, one('glute-ham developer')),
  L('Nordic Curl', LEGCURL, NOTHING, { aka: ['Nordic Hamstring Curl'] }),
  L('Reverse Hyper', { Glutes: 1, Hamstrings: 0.5, Erectors: 0.5 }, one('reverse hyper machine'), { iso: true }),
  L('Hip Thrust Machine', GLUTE, one('hip thrust machine'), { common: true }),
  L('Smith Hip Thrust', GLUTE, [['smith machine', 'flat bench']]),
  L('Glute Bridge', GLUTE, NOTHING, { aka: ['Bridge', 'Butt Lift (Bridge)'] }),
  L('Barbell Glute Bridge', GLUTE, one('barbell')),
  L('Single-Leg Glute Bridge', GLUTE, NOTHING),
  L('Cable Hip Abduction', { Abductors: 1 }, one('cable stack'), { iso: true }),
  L('Cable Hip Adduction', { Adductors: 1 }, one('cable stack'), { iso: true }),
  L('Copenhagen Plank', { Adductors: 1 }, NOTHING, { iso: true, aka: ['Copenhagen Side Plank'] }),
  // Legs
  L('Hack Squat', SQUAT, one('hack squat'), { p: 'Squat', common: true, aka: ['Hack Squat Machine', 'Narrow Stance Hack Squats'] }),
  L('Barbell Hack Squat', SQUAT, one('barbell'), { p: 'Squat' }),
  L('Belt Squat', SQUAT, one('belt squat'), { p: 'Squat', aka: ['Belt Squat Machine'] }),
  L('Goblet Squat', SQUAT, one('dumbbells', 'kettlebells'), { p: 'Squat', common: true, aka: ['DB Goblet Squat', 'KB Goblet Squat'] }),
  L('Box Squat', SQUAT, [['barbell', 'squat rack']], { p: 'Squat' }),
  L('Zercher Squat', SQUAT, [['barbell', 'squat rack']], { p: 'Squat' }),
  L('DB Squat', SQUAT, one('dumbbells'), { p: 'Squat' }),
  L('DB Sumo Squat', { Quads: 1, Glutes: 0.5, Hamstrings: 0.5, Adductors: 0.5 }, one('dumbbells'), { p: 'Squat', aka: ['Plie Squat', 'Plie Dumbbell Squat'] }),
  L('Bodyweight Squat', SQUAT, NOTHING, { p: 'Squat', aka: ['Air Squat'] }),
  L('Smith Split Squat', SQUAT, one('smith machine'), { p: 'Squat', aka: ['Smith Single-Leg Split Squat'] }),
  L('DB Split Squat', SQUAT, one('dumbbells'), { p: 'Squat' }),
  L('DB Bulgarian Split Squat', SQUAT, [['dumbbells', 'flat bench']], { p: 'Squat' }),
  L('DB Lunge', SQUAT, one('dumbbells'), { common: true }),
  L('DB Walking Lunge', SQUAT, one('dumbbells'), { common: true, aka: ['Walking Lunge'] }),
  L('Barbell Lunge', SQUAT, one('barbell'), { aka: ['Barbell Walking Lunge'] }),
  L('DB Reverse Lunge', SQUAT, one('dumbbells'), { aka: ['Reverse Lunge', 'Dumbbell Rear Lunge'] }),
  L('Lateral Lunge', { Quads: 1, Glutes: 0.5, Hamstrings: 0.5, Adductors: 0.5 }, NOTHING, { aka: ['Side Lunge'] }),
  L('DB Step-up', SQUAT, [['dumbbells', 'flat bench']], { common: true, aka: ['Step-up'] }),
  L('Barbell Step-up', SQUAT, [['barbell', 'flat bench']]),
  L('Sissy Squat', QUADS, NOTHING, { iso: true, aka: ['Weighted Sissy Squat'] }),
  L('Single-Leg Leg Press', SQUAT, one('leg press'), { p: 'Squat' }),
  L('Single-Leg Leg Curl', LEGCURL, one('lying leg curl', 'seated leg curl'), { iso: true, aka: ['Standing Leg Curl'] }),
  L('Smith Calf Raise', CALVES, one('smith machine'), { iso: true, aka: ['Smith Machine Calf Raise'] }),
  L('Leg Press Calf Raise', CALVES, one('leg press'), { iso: true, aka: ['Calf Press'] }),
  L('DB Calf Raise', CALVES, one('dumbbells'), { iso: true, aka: ['Standing Dumbbell Calf Raise'] }),
  L('Barbell Calf Raise', CALVES, one('barbell'), { iso: true, aka: ['Standing Barbell Calf Raise'] }),
  L('Single-Leg Calf Raise', CALVES, NOTHING, { iso: true }),
  L('Tibialis Raise', OTHER, NOTHING, { iso: true, aka: ['Tib Raise'] }),
  // Core
  L('Crunch', A, NOTHING, { iso: true, common: true }),
  L('Sit-up', A, NOTHING, { iso: true }),
  L('Decline Crunch', A, one('decline bench'), { iso: true, aka: ['Weighted Decline Crunch'] }),
  L('Reverse Crunch', A, NOTHING, { iso: true }),
  L('Bicycle Crunch', A, NOTHING, { iso: true }),
  L('Oblique Crunch', A, NOTHING, { iso: true }),
  L('Lying Leg Raise', A, NOTHING, { iso: true, common: true, aka: ['Leg Raise', 'Flat Bench Lying Leg Raise'] }),
  L('Hanging Knee Raise', A, one('pull-up bar'), { iso: true, common: true }),
  L('Toes-to-Bar', A, one('pull-up bar'), { iso: true }),
  L('Ab Wheel Rollout', A, NOTHING, { common: true, aka: ['Ab Rollout', 'Ab Wheel'] }),
  L('Barbell Rollout', A, one('barbell'), { aka: ['Barbell Ab Rollout'] }),
  L('Russian Twist', A, NOTHING, { iso: true }),
  L('Cable Woodchop', A, one('cable stack'), { iso: true, aka: ['Woodchopper', 'Standing Cable Wood Chop'] }),
  L('DB Side Bend', A, one('dumbbells'), { iso: true }),
  L('Hollow Hold', A, NOTHING, { aka: ['Hollow Body Hold'] }),
  L('V-Up', A, NOTHING, { iso: true }),
  L('Flutter Kick', A, NOTHING, { iso: true }),
  L('Neck Curl', OTHER, NOTHING, { iso: true }),
  L('Neck Extension', OTHER, NOTHING, { iso: true }),
];

/** Every lift, the original ones first. */
export const LIFTS: Lift[] = [...ORIGINAL.map((l): Lift => ({ ...l, common: true, program: true })), ...ADDED];

// ---------------------------------------------------------------------------------------------------------------------------
// A name the table doesn't know is read from its words: a movement (the base), the gear, and the few modifiers that change
// which muscles work. The most specific movement phrase wins, wherever it sits in the name: "Leg Press Calf Raise" is a calf
// raise, "Bench-Supported Row" a row, "Straight-Arm Pulldown" not a pulldown. Words the app doesn't know (Kroc, paused, tempo)
// change nothing, so the movement still counts.

/** Spellings nameKey leaves apart, joined or spelled out into the words the movements use. */
const SPELLINGS: [RegExp, string][] = [
  [/ e z /g, ' ez '], [/ ez bar /g, ' ez '], [/ ezbar /g, ' ez '], [/ t bar /g, ' tbar '], [/ v bar /g, ' vbar '], [/ hex bar /g, ' trap bar '],
  [/ skull crusher /g, ' skullcrusher '], [/ pull over /g, ' pullover '], [/ step up /g, ' stepup '], [/ kick back /g, ' kickback '],
  [/ pec dec /g, ' pec deck '], [/ peck deck /g, ' pec deck '], [/ wood chop /g, ' woodchop '], [/ hyper extension /g, ' hyperextension '],
  [/ cross body /g, ' crossbody '], [/ low to high /g, ' lowtohigh '], [/ pull thru /g, ' pull through '], [/ plate loaded /g, ' machine '],
  [/ captain chair /g, ' captainchair '], [/ toe to bar /g, ' toetobar '], [/ behind the neck /g, ' btn '], [/ behind neck /g, ' btn '],
  [/ rdl /g, ' romanian deadlift '], [/ sldl /g, ' stiff leg deadlift '], [/ ohp /g, ' overhead press '], [/ bss /g, ' bulgarian split squat '],
  [/ ghr /g, ' glute ham raise '], [/ kettlebell /g, ' kb '], [/ body weight /g, ' bodyweight '], [/ bw /g, ' bodyweight '],
  [/ step ups /g, ' stepup '], [/ reverse hyperextension /g, ' reverse hyper '], [/ side bridge /g, ' side plank '],
];
/** Plurals nameKey leaves half-folded. */
const FOLD: Record<string, string> = { presse: 'press', crunche: 'crunch', flye: 'fly', flie: 'fly', benche: 'bench', carrie: 'carry', tibiali: 'tibialis' };

/** A name's words: nameKey's folding, then the spellings above. */
export function words(name: string): string[] {
  let s = ` ${nameKey(name)} `;
  for (const [re, to] of SPELLINGS) s = s.replace(re, to);
  return s.trim().split(' ').filter(Boolean).map((w) => FOLD[w] ?? w);
}

/** Whether the words hold this phrase, word for word. */
const has = (ws: string[], phrase: string): boolean => {
  const t = phrase.split(' ');
  return ws.some((_, i) => t.every((x, j) => ws[i + j] === x));
};
/** Whether the words hold the phrase's words in order, at most two other words between each: "Lateral Cable Raise". */
function found(ws: string[], t: string[]): boolean {
  return ws.some((w, i) => {
    if (w !== t[0]) return false;
    let at = i;
    return t.slice(1).every((x) => {
      for (let k = at + 1; k <= at + 3 && k < ws.length; k++) if (ws[k] === x) { at = k; return true; }
      return false;
    });
  });
}

/**
 * A movement. `gear`: what it's done with when no word names the gear (a bench press: a barbell); `needs`: the gear in full when
 * no word names it (several ways, or none needed). `machine`, `cable`: what those words mean for it. `bench`: the bench it's done
 * on with free weights. `rack`: with a barbell it needs a squat rack.
 */
interface Base { m: Vector; p?: Pattern; iso?: true; gear?: Equipment; needs?: Needs; machine?: Equipment; cable?: Equipment; bench?: Equipment; rack?: true }

const HP: Pattern = 'Horizontal press', HL: Pattern = 'Horizontal pull', VP: Pattern = 'Vertical press', VL: Pattern = 'Vertical pull';
const CABLE = one('cable stack');

/**
 * Movements, by phrase. A longer phrase beats a shorter one, and between two as long, the one listed first wins (calf raise before
 * leg press, so "Calf Leg Press" and "Leg Press Calf Raise" are both calf work; row before bench; dip before bench).
 */
const BASES: [string, Base][] = [
  // Calves before the leg press they're done on.
  ['seated calf raise', { m: CALVES, iso: true, needs: one('seated calf machine'), machine: 'seated calf machine' }],
  ['calf raise', { m: CALVES, iso: true, machine: 'standing calf machine' }], ['calf press', { m: CALVES, iso: true }],
  ['calf extension', { m: CALVES, iso: true }], ['calf', { m: CALVES, iso: true }],
  // Known lifts that count for no muscle the app tracks: neck, shins, rotator cuff.
  ['neck curl', { m: OTHER, iso: true }], ['neck extension', { m: OTHER, iso: true }], ['neck flexion', { m: OTHER, iso: true }],
  ['tibialis raise', { m: OTHER, iso: true, needs: NOTHING }], ['tib raise', { m: OTHER, iso: true, needs: NOTHING }], ['tibialis', { m: OTHER, iso: true }],
  // Legs.
  ['leg press', { m: SQUAT, p: 'Squat', needs: one('leg press'), machine: 'leg press' }],
  ['pendulum squat', { m: SQUAT, p: 'Squat', needs: one('pendulum squat'), machine: 'pendulum squat' }],
  ['hack squat', { m: SQUAT, p: 'Squat', needs: one('hack squat'), machine: 'hack squat' }],
  ['belt squat', { m: SQUAT, p: 'Squat', needs: one('belt squat'), machine: 'belt squat' }],
  ['bulgarian split squat', { m: SQUAT, p: 'Squat', needs: one('flat bench'), bench: 'flat bench' }], ['split squat', { m: SQUAT, p: 'Squat' }],
  ['sissy squat', { m: QUADS, iso: true, needs: NOTHING }], ['wall sit', { m: QUADS, needs: NOTHING }],
  ['squat', { m: SQUAT, p: 'Squat', gear: 'barbell', rack: true }],
  ['lunge', { m: SQUAT }], ['stepup', { m: SQUAT, bench: 'flat bench' }],
  ['leg extension', { m: QUADS, iso: true, needs: one('leg extension'), machine: 'leg extension' }],
  ['knee extension', { m: QUADS, iso: true, needs: one('leg extension'), machine: 'leg extension' }],
  ['seated leg curl', { m: LEGCURL, iso: true, needs: one('seated leg curl'), machine: 'seated leg curl' }],
  ['lying leg curl', { m: LEGCURL, iso: true, needs: one('lying leg curl'), machine: 'lying leg curl' }],
  ['leg curl', { m: LEGCURL, iso: true }], ['hamstring curl', { m: LEGCURL, iso: true }], ['ham curl', { m: LEGCURL, iso: true }],
  ['nordic curl', { m: LEGCURL, needs: NOTHING }], ['nordic', { m: LEGCURL, needs: NOTHING }],
  ['glute ham raise', { m: { Hamstrings: 1, Glutes: 0.5 }, needs: one('glute-ham developer') }],
  ['stiff leg deadlift', { m: HINGE, p: 'Hinge', gear: 'barbell' }], ['romanian deadlift', { m: HINGE, p: 'Hinge', gear: 'barbell' }],
  ['deadlift', { m: HINGE, p: 'Hinge', gear: 'barbell' }],
  ['good morning', { m: HINGE, p: 'Hinge', gear: 'barbell', rack: true }],
  ['rack pull', { m: { ...HINGE, Traps: 0.5 }, p: 'Hinge', gear: 'barbell', rack: true }],
  ['hip thrust', { m: GLUTE, needs: [['barbell', 'hip thrust bench'], ['barbell', 'flat bench'], ['smith machine', 'flat bench']], bench: 'flat bench', machine: 'hip thrust machine' }],
  ['glute bridge', { m: GLUTE, needs: NOTHING }], ['hip bridge', { m: GLUTE, needs: NOTHING }], ['hip raise', { m: GLUTE }],
  ['glute press', { m: GLUTE, needs: one('glute press'), machine: 'glute press' }],
  ['glute kickback', { m: GLUTE, iso: true }], ['donkey kick', { m: GLUTE, iso: true }], ['hip extension', { m: GLUTE, iso: true }],
  ['pull through', { m: GLUTE, iso: true, needs: CABLE }], ['swing', { m: GLUTE, iso: true, gear: 'kettlebells' }],
  ['hip abduction', { m: { Abductors: 1 }, iso: true, needs: one('hip abduction machine'), machine: 'hip abduction machine' }],
  ['abduction', { m: { Abductors: 1 }, iso: true, needs: one('hip abduction machine'), machine: 'hip abduction machine' }],
  ['abductor', { m: { Abductors: 1 }, iso: true, needs: one('hip abduction machine'), machine: 'hip abduction machine' }],
  ['hip adduction', { m: { Adductors: 1 }, iso: true, needs: one('hip adduction machine'), machine: 'hip adduction machine' }],
  ['adduction', { m: { Adductors: 1 }, iso: true, needs: one('hip adduction machine'), machine: 'hip adduction machine' }],
  ['adductor', { m: { Adductors: 1 }, iso: true, needs: one('hip adduction machine'), machine: 'hip adduction machine' }],
  ['copenhagen plank', { m: { Adductors: 1 }, iso: true, needs: NOTHING }], ['copenhagen', { m: { Adductors: 1 }, iso: true, needs: NOTHING }],
  ['reverse hyper', { m: { Glutes: 1, Hamstrings: 0.5, Erectors: 0.5 }, iso: true, needs: one('reverse hyper machine'), machine: 'reverse hyper machine' }],
  ['back extension', { m: BACK_EXT, iso: true, needs: one('back extension bench') }], ['hyperextension', { m: BACK_EXT, iso: true, needs: one('back extension bench') }],
  // Chest.
  ['bench press', { m: PRESS, p: HP, gear: 'barbell', bench: 'flat bench', machine: 'chest press machine' }],
  ['chest press', { m: PRESS, p: HP, gear: 'chest press machine', bench: 'flat bench', machine: 'chest press machine' }],
  ['floor press', { m: PRESS, p: HP, gear: 'barbell' }],
  ['squeeze press', { m: PRESS, p: HP }], ['svend press', { m: CHEST, iso: true, needs: one('plates') }],
  ['pike pushup', { m: OHP, needs: NOTHING }], ['handstand pushup', { m: OHP, needs: NOTHING }], ['pushup', { m: PRESS, needs: NOTHING }],
  ['upright dip', { m: CLOSE, needs: one('dip station') }], ['bench dip', { m: CLOSE, needs: one('flat bench') }],
  ['dip', { m: PRESS, needs: one('dip station'), machine: 'triceps machine' }],
  ['reverse pec deck', { m: RD, iso: true, needs: one('pec deck') }],
  ['pec deck', { m: CHEST, iso: true, needs: one('pec deck'), machine: 'pec deck' }], ['butterfly', { m: CHEST, iso: true, needs: one('pec deck') }],
  ['crossover', { m: CHEST, iso: true, needs: one('dual cable'), cable: 'dual cable' }],
  // Shoulders, before the flys and rows that share their words.
  ['rear delt fly', { m: RD, iso: true, machine: 'pec deck' }], ['rear delt row', { m: { 'Rear Delts': 1, 'Mid-Back': 0.5 }, iso: true }],
  ['rear delt', { m: RD, iso: true, machine: 'pec deck' }], ['reverse fly', { m: RD, iso: true, machine: 'pec deck' }],
  ['pull apart', { m: RD, iso: true }], ['face pull', { m: FACE, iso: true, needs: CABLE }],
  ['external rotation', { m: OTHER, iso: true, cable: 'cable stack' }], ['internal rotation', { m: OTHER, iso: true }], ['cuban press', { m: OTHER, iso: true }],
  ['fly', { m: CHEST, iso: true, machine: 'pec deck', cable: 'dual cable', bench: 'flat bench' }],
  // A dumbbell or barbell pullover works the chest more than the lats (Marchetti & Uchida 2011, J Appl Biomech 27(4)); a cable one is a
  // straight-arm pulldown (see MODIFIERS).
  ['pullover', { m: { Chest: 1, Lats: 0.5 }, iso: true, bench: 'flat bench' }],
  ['overhead press', { m: OHP, p: VP, gear: 'barbell', rack: true, machine: 'shoulder press machine' }],
  ['shoulder press', { m: OHP, p: VP, machine: 'shoulder press machine' }],
  ['military press', { m: OHP, p: VP, gear: 'barbell', rack: true }], ['military', { m: OHP, p: VP, gear: 'barbell', rack: true }],
  ['push press', { m: OHP, p: VP, gear: 'barbell', rack: true }], ['z press', { m: OHP, p: VP, gear: 'barbell', rack: true }],
  ['bradford press', { m: OHP, p: VP, gear: 'barbell', rack: true }],
  ['arnold press', { m: OHP, p: VP, gear: 'dumbbells' }], ['arnold', { m: OHP, p: VP, gear: 'dumbbells' }],
  ['landmine press', { m: { 'Front Delts': 1, Chest: 0.5, Triceps: 0.5 }, p: VP, needs: [['landmine', 'barbell']] }],
  ['upright row', { m: UPRIGHT, needs: one('barbell', 'ez bar', 'cable stack', 'dumbbells') }],
  ['lateral raise', { m: SD, iso: true, machine: 'lateral raise machine' }], ['side raise', { m: SD, iso: true, machine: 'lateral raise machine' }],
  ['y raise', { m: SD, iso: true }], ['lu raise', { m: SD, iso: true }], ['deltoid raise', { m: SD, iso: true }], ['scaption', { m: SD, iso: true }],
  ['front delt raise', { m: { 'Front Delts': 1 }, iso: true }], ['front raise', { m: { 'Front Delts': 1 }, iso: true }],
  ['kelso shrug', { m: { 'Mid-Back': 1, Traps: 0.5 }, iso: true }], ['middle back shrug', { m: { 'Mid-Back': 1, Traps: 0.5 }, iso: true }], ['shoulder shrug', { m: { Traps: 1 }, iso: true }], ['shrug', { m: { Traps: 1 }, iso: true }],
  // Triceps.
  ['jm press', { m: T, bench: 'flat bench' }], ['tate press', { m: T, bench: 'flat bench' }], ['french press', { m: T, iso: true }],
  ['triceps press', { m: T, needs: one('triceps machine'), machine: 'triceps machine' }],
  ['triceps extension', { m: T, iso: true, machine: 'triceps machine' }], ['overhead extension', { m: T, iso: true }],
  ['skullcrusher', { m: T, bench: 'flat bench' }], ['pushdown', { m: T, iso: true, needs: CABLE }], ['kickback', { m: T, iso: true }],
  // Arms and grip.
  ['wrist rotation', { m: F, iso: true }], ['pronation', { m: F, iso: true }], ['supination', { m: F, iso: true }], ['finger curl', { m: F, iso: true }], ['wrist curl', { m: F, iso: true }], ['wrist extension', { m: F, iso: true }], ['wrist roller', { m: F, iso: true }],
  ['curl up', { m: A, iso: true, needs: NOTHING }],
  ['curl', { m: B, iso: true, machine: 'biceps curl machine' }],
  ['farmer carry', { m: CARRY, needs: one('dumbbells') }], ['farmer walk', { m: CARRY, needs: one('dumbbells') }], ['farmer', { m: CARRY, needs: one('dumbbells') }],
  ['suitcase carry', { m: { Forearms: 1, Abs: 0.5 }, needs: one('dumbbells') }], ['carry', { m: CARRY, needs: one('dumbbells') }],
  ['dead hang', { m: F, needs: one('pull-up bar') }], ['pinch', { m: F, needs: one('plates') }],
  // Back.
  ['straight arm pulldown', { m: LATS }], ['straight arm pullover', { m: { Chest: 1, Lats: 0.5 }, iso: true, bench: 'flat bench' }], ['straight arm', { m: LATS }], ['lat prayer', { m: LATS, iso: true }],
  ['lat pulldown', { m: PULLDOWN, p: VL, needs: one('lat pulldown'), machine: 'lat pulldown', cable: 'lat pulldown' }],
  ['leg pull in', { m: A, iso: true }], ['bench pull', { m: ROW_MID, p: HL }], ['pull in', { m: PULLDOWN, iso: true, needs: CABLE }], ['archer pull', { m: { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5 }, needs: CABLE }],
  ['landmine row', { m: ROW_LAT, p: HL, needs: [['landmine', 'barbell']] }], ['meadow row', { m: ROW_LAT, p: HL, needs: [['landmine', 'barbell']] }],
  ['seal row', { m: ROW_MID, p: HL, needs: [['barbell', 'flat bench'], ['dumbbells', 'flat bench']], bench: 'flat bench' }],
  ['inverted row', { m: ROW_MID, p: HL, needs: [['squat rack'], ['smith machine']] }],
  ['row', { m: ROW_MID, p: HL, machine: 'row machine' }],
  ['pulldown', { m: PULLDOWN, p: VL, needs: one('lat pulldown'), machine: 'lat pulldown', cable: 'lat pulldown' }],
  ['pullup', { m: PULLDOWN, p: VL, needs: one('pull-up bar') }],
  ['chinup', { m: CHIN, p: VL, needs: one('pull-up bar') }], ['chin', { m: CHIN, p: VL, needs: one('pull-up bar') }],
  // Core.
  ['landmine rotation', { m: { Abs: 1, 'Front Delts': 0.25 }, iso: true, needs: [['landmine', 'barbell']] }],
  ['side plank', { m: { Abs: 1, Erectors: 0.5 }, needs: NOTHING }], ['plank', { m: A, needs: NOTHING }],
  ['bird dog', { m: { Erectors: 1, Glutes: 0.5, Abs: 0.5 }, needs: NOTHING }], ['dead bug', { m: A, needs: NOTHING }],
  ['hollow', { m: A, needs: NOTHING }], ['v up', { m: A, iso: true, needs: NOTHING }],
  ['supported leg raise', { m: A, iso: true, needs: one('captain’s chair', 'dip station') }],
  ['leg raise', { m: A, iso: true, needs: NOTHING }], ['knee raise', { m: A, iso: true }], ['leg lift', { m: A, iso: true, needs: NOTHING }], ['flutter kick', { m: A, iso: true, needs: NOTHING }],
  ['jackknife', { m: A, iso: true, needs: NOTHING }], ['heel touch', { m: A, iso: true, needs: NOTHING }], ['heel toucher', { m: A, iso: true, needs: NOTHING }],
  ['elbow to knee', { m: A, iso: true, needs: NOTHING }], ['pike', { m: A, iso: true }], ['cable lift', { m: A, iso: true, needs: CABLE }], ['tuck', { m: A, iso: true }], ['toetobar', { m: A, iso: true, needs: one('pull-up bar') }],
  ['ab wheel', { m: A }], ['rollout', { m: A }],
  ['side bend', { m: A, iso: true }], ['russian twist', { m: A, iso: true, needs: NOTHING }], ['twist', { m: A, iso: true }],
  ['woodchop', { m: A, iso: true, cable: 'cable stack' }], ['chop', { m: A, iso: true }],
  ['pallof press', { m: A, needs: CABLE }], ['pallof', { m: A, needs: CABLE }],
  ['decline crunch', { m: A, iso: true, needs: one('decline bench') }], ['decline situp', { m: A, iso: true, needs: one('decline bench') }],
  ['crunch', { m: A, iso: true, needs: NOTHING, machine: 'ab crunch machine' }], ['situp', { m: A, iso: true, needs: NOTHING }],
  ['rotation', { m: A, iso: true, machine: 'torso rotation machine' }],
  // Last: single words that other phrases contain.
  ['press', { m: PRESS, p: HP, machine: 'chest press machine' }],
  ['bench', { m: PRESS, p: HP, gear: 'barbell', bench: 'flat bench' }],
  ['extension', { m: T, iso: true }], ['lateral', { m: SD, iso: true, machine: 'lateral raise machine' }],
  ['glute', { m: GLUTE }], ['bridge', { m: GLUTE }], ['oblique', { m: A, iso: true }], ['ab', { m: A, iso: true, machine: 'ab crunch machine' }],
  ['abs', { m: A, iso: true, machine: 'ab crunch machine' }], ['core', { m: A }], ['neck', { m: OTHER, iso: true }], ['grip', { m: F }],
];
const BASE_WORDS = BASES.map(([phrase, base]) => ({ phrase, base, t: phrase.split(' ') }));
const BASE_OF = new Map(BASES);

/** Words that change which muscles a movement works (`m` replaces them, `add` raises a muscle to at least that) or which movement it is (`to`). */
interface Modifier { on: string[]; any: string[]; to?: string; m?: Vector; add?: Vector; gear?: Equipment }
const MODIFIERS: Modifier[] = [
  // A seated or standing press is a shoulder press: "Seated DB Press", "Standing Barbell Press", "Behind-the-Neck Press".
  { on: ['press'], any: ['seated', 'standing', 'overhead', 'shoulder', 'btn'], to: 'overhead press' },
  // A close grip makes a press a triceps lift (as Close-Grip Bench Press).
  { on: ['bench press', 'bench', 'press', 'chest press', 'floor press', 'pushup'], any: ['close grip', 'narrow grip', 'diamond'], m: CLOSE },
  { on: ['pushup'], any: ['triceps'], m: CLOSE },
  { on: ['dip'], any: ['triceps', 'upright', 'straight', 'machine'], m: CLOSE },
  // An underhand, close or V-bar grip brings the biceps in on a vertical pull (round 13).
  { on: ['pulldown', 'lat pulldown', 'pullup'], any: ['close grip', 'narrow grip', 'underhand', 'supinated', 'reverse grip', 'vbar'], m: CHIN },
  { on: ['fly', 'crossover'], any: ['lowtohigh'], add: { 'Front Delts': 0.5 } },
  { on: ['deadlift', 'romanian deadlift', 'stiff leg deadlift', 'squat'], any: ['sumo', 'plie'], add: { Adductors: 0.5 } },
  { on: ['deadlift'], any: ['trap bar'], add: { Quads: 0.5 } },
  { on: ['lunge', 'squat', 'split squat'], any: ['lateral', 'side', 'cossack'], add: { Adductors: 0.5 } },
  { on: ['curl'], any: ['hammer', 'crossbody', 'zottman'], add: { Forearms: 0.5 } },
  { on: ['curl'], any: ['reverse', 'reverse grip', 'overhand', 'pronated'], m: { Forearms: 1, Biceps: 0.5 } },
  { on: ['pullover', 'straight arm pullover'], any: ['cable', 'rope'], m: LATS },
  { on: ['row'], any: ['lat', 'high'], m: ROW_LAT },
  { on: ['kickback'], any: ['leg', 'legged', 'hip', 'donkey'], m: GLUTE },
  { on: ['squat'], any: ['goblet'], gear: 'dumbbells' },
];

/** Gear words, in the order they're read: "Smith Machine" is the Smith machine. null: gear the app doesn't list yet. */
const IMPLEMENTS: [string, Equipment | 'machine' | 'cable' | 'nothing' | null][] = [
  ['smith', 'smith machine'], ['landmine', 'landmine'], ['tbar', 'landmine'], ['trap bar', 'trap bar'], ['ez', 'ez bar'], ['kb', 'kettlebells'], ['band', null],
  ['safety bar', null], ['cable', 'cable'], ['rope', 'cable'], ['pulley', 'cable'], ['db', 'dumbbells'], ['barbell', 'barbell'], ['plate', 'plates'],
  ['leg press', 'leg press'], ['pec deck', 'pec deck'], ['captainchair', 'captain’s chair'], ['hanging', 'pull-up bar'],
  ['machine', 'machine'], ['bodyweight', 'nothing'],
];
/** Lifted in the hand, so done on a bench or in a rack. */
const FREE = new Set<Equipment>(['barbell', 'dumbbells', 'smith machine', 'plates', 'ez bar', 'kettlebells']);

function gearFor(ws: string[], base: Base, gear: Equipment | undefined): Needs | null {
  const named = IMPLEMENTS.find(([w]) => has(ws, w));
  let tool: Equipment | undefined;
  if (!named) {
    if (!gear && base.needs) {
      // "Weighted Push-up": weighted with something, but not said what.
      if (has(ws, 'weighted') && !base.needs[0]?.length) return null;
      return base.needs;
    }
    tool = gear;
  } else {
    const g = named[1];
    if (g === null) return null;
    if (g === 'nothing') return NOTHING;
    tool = g === 'machine' ? base.machine : g === 'cable' ? base.cable ?? 'cable stack' : g;
  }
  if (!tool) return null;
  const alt: Equipment[] = tool === 'landmine' ? ['landmine', 'barbell'] : [tool];
  if (FREE.has(tool)) {
    const bench: Equipment | undefined = has(ws, 'preacher') ? 'preacher bench' : has(ws, 'incline') ? 'incline bench' : has(ws, 'decline') ? 'decline bench'
      : has(ws, 'flat') || has(ws, 'bench') || has(ws, 'kneeling') ? 'flat bench' : base.bench;
    if (bench) alt.push(bench);
    if (base.rack && tool === 'barbell') alt.push('squat rack');
  }
  return [alt];
}

/** What a name's words say it is, without the table. */
export interface Built { m: Vector | null; p: Pattern | null; needs: Needs | null; iso: boolean }

function build(ws: string[]): Built {
  let best: (typeof BASE_WORDS)[number] | null = null;
  for (const b of BASE_WORDS) if (b.t.length > (best?.t.length ?? 0) && found(ws, b.t)) best = b;
  if (!best) return { m: null, p: null, needs: null, iso: false };
  let phrase = best.phrase, base = best.base, m = base.m, gear = base.gear;
  for (const mod of MODIFIERS) {
    if (!mod.on.includes(phrase) || !mod.any.some((w) => has(ws, w))) continue;
    if (mod.to) { phrase = mod.to; base = BASE_OF.get(mod.to)!; m = base.m; gear = base.gear; }
    if (mod.m) m = mod.m;
    if (mod.add) { m = { ...m }; for (const [k, v] of Object.entries(mod.add) as [Muscle, number][]) m[k] = Math.max(m[k] ?? 0, v); }
    if (mod.gear) gear = mod.gear;
  }
  return { m, p: base.p ?? null, needs: gearFor(ws, base, gear), iso: !!base.iso };
}

/** A name read from its words alone (see BASES); the catalog's own records are the test set for it. */
export const fromWords = (name: string): Built => build(words(name));

/** How a name's facts were found: its record in the table (by any spelling that folds to its name, or one of its other names), its words, or not at all. */
export type How = 'catalog' | 'alias' | 'built' | 'none';
/** What a lift name counts as. `lift`: its record, when the table has one. */
export interface Resolved extends Built { how: How; lift?: Lift }

/** Folded words in any order: "Dumbbell Incline Press" is Incline DB Press. */
export const wordKey = (name: string): string => words(name).sort().join(' ');
const BY_KEY = new Map(LIFTS.map((l) => [wordKey(l.name), l]));
const BY_AKA = new Map(LIFTS.flatMap((l) => (l.aka ?? []).map((a) => [wordKey(a), l] as const)));

function resolve(name: string): Resolved {
  const ws = words(name);
  const lift = BY_KEY.get([...ws].sort().join(' '));
  if (lift) return { m: lift.m, p: lift.p ?? null, needs: lift.needs, iso: !!lift.iso, how: 'catalog', lift };
  const aka = BY_AKA.get([...ws].sort().join(' '));
  if (aka) return { m: aka.m, p: aka.p ?? null, needs: aka.needs, iso: !!aka.iso, how: 'alias', lift: aka };
  const b = build(ws);
  return { ...b, how: b.m ? 'built' : 'none' };
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
