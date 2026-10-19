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
const CLOSE: Vector = { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 };
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
  L('Close-Grip Bench Press', CLOSE, [['barbell', 'flat bench'], ['smith machine', 'flat bench']], { p: 'Horizontal press' }),
  L('DB Kickback', T, one('dumbbells'), { iso: true }),
  L('Cable Kickback', { Glutes: 1, Hamstrings: 0.5 }, one('cable stack'), { iso: true }),
  L('Triceps Press Machine', T, one('triceps machine')),
  L('Upright Dips', CLOSE, one('dip station')),
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
  // Known by name, not listed: generic names logged before the catalog had them.
  L('close-grip push-up', CLOSE, NOTHING, { hidden: true }),
  L('close-grip smith press', CLOSE, one('smith machine'), { p: 'Horizontal press', hidden: true }),
  L('dips', PRESS, one('dip station'), { hidden: true }),
  L('incline bench pushdown', T, one('cable stack'), { iso: true, hidden: true }),
  L('db reverse curl', { Forearms: 1, Biceps: 0.5 }, one('dumbbells'), { iso: true, hidden: true }),
  L('zottman curl', { Biceps: 1, Forearms: 0.5 }, null, { iso: true, hidden: true }),
  L('db wrist curl', { Forearms: 1 }, one('dumbbells'), { iso: true, hidden: true }),
  L('db reverse wrist curl', { Forearms: 1 }, one('dumbbells'), { iso: true, hidden: true }),
  L('overhead db press', OHP, one('dumbbells'), { p: 'Vertical press', hidden: true }),
  L('decline crunch (weighted)', A, null, { iso: true, hidden: true }),
  L('leg raise', A, null, { iso: true, hidden: true }),
  L('db calf raise', { Calves: 1 }, one('dumbbells'), { iso: true, hidden: true }),
];

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

const UPRIGHT: Vector = { 'Side Delts': 1, Traps: 0.5 }, FACE: Vector = { 'Rear Delts': 1, 'Mid-Back': 0.5, Traps: 0.5 };
const GLUTE: Vector = { Glutes: 1, Hamstrings: 0.5 }, BACK_EXT: Vector = { Erectors: 1, Glutes: 0.5, Hamstrings: 0.5 };
const CHEST: Vector = { Chest: 1 }, QUADS: Vector = { Quads: 1 }, CALVES: Vector = { Calves: 1 }, F: Vector = { Forearms: 1 }, LATS: Vector = { Lats: 1 };
const CARRY: Vector = { Forearms: 1, Traps: 0.5 }, OTHER: Vector = {};
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
  ['tibialis raise', { m: OTHER, iso: true }], ['tib raise', { m: OTHER, iso: true }], ['tibialis', { m: OTHER, iso: true }],
  // Legs.
  ['leg press', { m: SQUAT, p: 'Squat', needs: one('leg press'), machine: 'leg press' }],
  ['pendulum squat', { m: SQUAT, p: 'Squat', needs: one('pendulum squat'), machine: 'pendulum squat' }],
  ['hack squat', { m: SQUAT, p: 'Squat' }], ['belt squat', { m: SQUAT, p: 'Squat' }],
  ['bulgarian split squat', { m: SQUAT, p: 'Squat', needs: one('flat bench'), bench: 'flat bench' }], ['split squat', { m: SQUAT, p: 'Squat' }],
  ['sissy squat', { m: QUADS, iso: true }], ['wall sit', { m: QUADS, needs: NOTHING }],
  ['squat', { m: SQUAT, p: 'Squat', gear: 'barbell', rack: true }],
  ['lunge', { m: SQUAT }], ['stepup', { m: SQUAT, bench: 'flat bench' }],
  ['leg extension', { m: QUADS, iso: true, needs: one('leg extension'), machine: 'leg extension' }],
  ['knee extension', { m: QUADS, iso: true, needs: one('leg extension'), machine: 'leg extension' }],
  ['seated leg curl', { m: LEGCURL, iso: true, needs: one('seated leg curl'), machine: 'seated leg curl' }],
  ['lying leg curl', { m: LEGCURL, iso: true, needs: one('lying leg curl'), machine: 'lying leg curl' }],
  ['leg curl', { m: LEGCURL, iso: true }], ['hamstring curl', { m: LEGCURL, iso: true }], ['ham curl', { m: LEGCURL, iso: true }],
  ['nordic curl', { m: LEGCURL }], ['nordic', { m: LEGCURL }],
  ['glute ham raise', { m: { Hamstrings: 1, Glutes: 0.5 } }],
  ['stiff leg deadlift', { m: HINGE, p: 'Hinge', gear: 'barbell' }], ['romanian deadlift', { m: HINGE, p: 'Hinge', gear: 'barbell' }],
  ['deadlift', { m: HINGE, p: 'Hinge', gear: 'barbell' }],
  ['good morning', { m: HINGE, p: 'Hinge', gear: 'barbell', rack: true }],
  ['rack pull', { m: { ...HINGE, Traps: 0.5 }, p: 'Hinge', gear: 'barbell', rack: true }],
  ['hip thrust', { m: GLUTE, needs: [['barbell', 'hip thrust bench'], ['barbell', 'flat bench'], ['smith machine', 'flat bench']], bench: 'flat bench' }],
  ['glute bridge', { m: GLUTE, needs: NOTHING }], ['hip bridge', { m: GLUTE, needs: NOTHING }], ['hip raise', { m: GLUTE }],
  ['glute press', { m: GLUTE, needs: one('glute press'), machine: 'glute press' }],
  ['glute kickback', { m: GLUTE, iso: true }], ['donkey kick', { m: GLUTE, iso: true }], ['hip extension', { m: GLUTE, iso: true }],
  ['pull through', { m: GLUTE, iso: true, needs: CABLE }], ['swing', { m: GLUTE, iso: true }],
  ['hip abduction', { m: { Abductors: 1 }, iso: true, needs: one('hip abduction machine'), machine: 'hip abduction machine' }],
  ['abduction', { m: { Abductors: 1 }, iso: true, needs: one('hip abduction machine'), machine: 'hip abduction machine' }],
  ['abductor', { m: { Abductors: 1 }, iso: true, needs: one('hip abduction machine'), machine: 'hip abduction machine' }],
  ['hip adduction', { m: { Adductors: 1 }, iso: true, needs: one('hip adduction machine'), machine: 'hip adduction machine' }],
  ['adduction', { m: { Adductors: 1 }, iso: true, needs: one('hip adduction machine'), machine: 'hip adduction machine' }],
  ['adductor', { m: { Adductors: 1 }, iso: true, needs: one('hip adduction machine'), machine: 'hip adduction machine' }],
  ['copenhagen plank', { m: { Adductors: 1 }, iso: true }], ['copenhagen', { m: { Adductors: 1 }, iso: true }],
  ['reverse hyper', { m: { Glutes: 1, Hamstrings: 0.5, Erectors: 0.5 }, iso: true }],
  ['back extension', { m: BACK_EXT, iso: true, needs: one('back extension bench') }], ['hyperextension', { m: BACK_EXT, iso: true, needs: one('back extension bench') }],
  // Chest.
  ['bench press', { m: PRESS, p: HP, gear: 'barbell', bench: 'flat bench', machine: 'chest press machine' }],
  ['chest press', { m: PRESS, p: HP, gear: 'chest press machine', bench: 'flat bench', machine: 'chest press machine' }],
  ['floor press', { m: PRESS, p: HP, gear: 'barbell' }],
  ['squeeze press', { m: PRESS, p: HP }], ['svend press', { m: CHEST, iso: true }],
  ['pike pushup', { m: OHP, needs: NOTHING }], ['handstand pushup', { m: OHP, needs: NOTHING }], ['pushup', { m: PRESS, needs: NOTHING }],
  ['upright dip', { m: CLOSE, needs: one('dip station') }], ['bench dip', { m: CLOSE, needs: one('flat bench') }],
  ['dip', { m: PRESS, needs: one('dip station') }],
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
  ['upright row', { m: UPRIGHT }],
  ['lateral raise', { m: SD, iso: true, machine: 'lateral raise machine' }], ['side raise', { m: SD, iso: true, machine: 'lateral raise machine' }],
  ['y raise', { m: SD, iso: true }], ['lu raise', { m: SD, iso: true }], ['deltoid raise', { m: SD, iso: true }], ['scaption', { m: SD, iso: true }],
  ['front delt raise', { m: { 'Front Delts': 1 }, iso: true }], ['front raise', { m: { 'Front Delts': 1 }, iso: true }],
  ['kelso shrug', { m: { 'Mid-Back': 1, Traps: 0.5 }, iso: true }], ['shoulder shrug', { m: { Traps: 1 }, iso: true }], ['shrug', { m: { Traps: 1 }, iso: true }],
  // Triceps.
  ['jm press', { m: T, bench: 'flat bench' }], ['tate press', { m: T, bench: 'flat bench' }], ['french press', { m: T, iso: true }],
  ['triceps press', { m: T, needs: one('triceps machine'), machine: 'triceps machine' }],
  ['triceps extension', { m: T, iso: true }], ['overhead extension', { m: T, iso: true }],
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
  ['landmine row', { m: ROW_LAT, p: HL, needs: [['landmine', 'barbell']] }],
  ['row', { m: ROW_MID, p: HL, machine: 'row machine' }],
  ['pulldown', { m: PULLDOWN, p: VL, needs: one('lat pulldown'), machine: 'lat pulldown', cable: 'lat pulldown' }],
  ['pullup', { m: PULLDOWN, p: VL, needs: one('pull-up bar') }],
  ['chinup', { m: CHIN, p: VL, needs: one('pull-up bar') }], ['chin', { m: CHIN, p: VL, needs: one('pull-up bar') }],
  // Core.
  ['landmine rotation', { m: { Abs: 1, 'Front Delts': 0.25 }, iso: true, needs: [['landmine', 'barbell']] }],
  ['side plank', { m: { Abs: 1, Erectors: 0.5 }, needs: NOTHING }], ['plank', { m: A, needs: NOTHING }],
  ['bird dog', { m: { Erectors: 1, Glutes: 0.5, Abs: 0.5 }, needs: NOTHING }], ['dead bug', { m: A, needs: NOTHING }],
  ['hollow', { m: A, needs: NOTHING }], ['v up', { m: A, iso: true, needs: NOTHING }],
  ['leg raise', { m: A, iso: true }], ['knee raise', { m: A, iso: true }], ['leg lift', { m: A, iso: true }], ['flutter kick', { m: A, iso: true }],
  ['jackknife', { m: A, iso: true }], ['heel touch', { m: A, iso: true }], ['tuck', { m: A, iso: true }], ['toetobar', { m: A, iso: true, needs: one('pull-up bar') }],
  ['ab wheel', { m: A }], ['rollout', { m: A }],
  ['side bend', { m: A, iso: true }], ['russian twist', { m: A, iso: true }], ['twist', { m: A, iso: true }],
  ['woodchop', { m: A, iso: true, cable: 'cable stack' }], ['chop', { m: A, iso: true }],
  ['pallof press', { m: A, needs: CABLE }], ['pallof', { m: A, needs: CABLE }],
  ['crunch', { m: A, iso: true, machine: 'ab crunch machine' }], ['situp', { m: A, iso: true }],
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
  { on: ['deadlift', 'romanian deadlift', 'stiff leg deadlift', 'squat'], any: ['sumo'], add: { Adductors: 0.5 } },
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
  ['smith', 'smith machine'], ['landmine', 'landmine'], ['tbar', 'landmine'], ['trap bar', null], ['ez', null], ['kb', null], ['band', null],
  ['safety bar', null], ['cable', 'cable'], ['rope', 'cable'], ['pulley', 'cable'], ['db', 'dumbbells'], ['barbell', 'barbell'], ['plate', 'plates'],
  ['leg press', 'leg press'], ['pec deck', 'pec deck'], ['captainchair', 'captain’s chair'], ['hanging', 'pull-up bar'],
  ['machine', 'machine'], ['bodyweight', 'nothing'],
];
/** Lifted in the hand, so done on a bench or in a rack. */
const FREE = new Set<Equipment>(['barbell', 'dumbbells', 'smith machine', 'plates']);

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

/** How a name's facts were found: its record in the table (by any spelling that folds to its name), its words, or not at all. */
export type How = 'catalog' | 'built' | 'none';
/** What a lift name counts as. `lift`: its record, when the table has one. */
export interface Resolved extends Built { how: How; lift?: Lift }

/** Folded words in any order: "Dumbbell Incline Press" is Incline DB Press. */
export const wordKey = (name: string): string => words(name).sort().join(' ');
const BY_KEY = new Map(LIFTS.map((l) => [wordKey(l.name), l]));

function resolve(name: string): Resolved {
  const ws = words(name);
  const lift = BY_KEY.get([...ws].sort().join(' '));
  if (lift) return { m: lift.m, p: lift.p ?? null, needs: lift.needs, iso: !!lift.iso, how: 'catalog', lift };
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
