import { describe, expect, it } from 'vitest';
import { LIFTS, fromWords, resolveLift, type How, type Needs, type Pattern } from './lifts';
import type { Vector } from './muscles';

// Reading a lift from its words (round 15, stage 2): the catalog is the first test set, then spellings and lifts it doesn't list.

const PRESS: Vector = { Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 };
const CLOSE: Vector = { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 };
const OHP: Vector = { 'Front Delts': 1, Triceps: 0.5, 'Side Delts': 0.5 };
const ROW_MID: Vector = { 'Mid-Back': 1, Lats: 0.5, 'Rear Delts': 0.5, Biceps: 0.5, Forearms: 0.5 };
const ROW_LAT: Vector = { Lats: 1, 'Mid-Back': 0.5, 'Rear Delts': 0.5, Biceps: 0.5, Forearms: 0.5 };
const PULLDOWN: Vector = { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5, Forearms: 0.5 };
const CHIN: Vector = { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.75, Forearms: 0.5 };
const SQUAT: Vector = { Quads: 1, Glutes: 0.5, Hamstrings: 0.5 };
const HINGE: Vector = { Hamstrings: 1, Glutes: 0.5, Erectors: 0.5 };
const GLUTE: Vector = { Glutes: 1, Hamstrings: 0.5 };
const B: Vector = { Biceps: 1 }, T: Vector = { Triceps: 1 }, A: Vector = { Abs: 1 }, SD: Vector = { 'Side Delts': 1 }, RD: Vector = { 'Rear Delts': 1 };
const F: Vector = { Forearms: 1 }, CALF: Vector = { Calves: 1 }, NONE: Vector = {};
const HP: Pattern = 'Horizontal press', HL: Pattern = 'Horizontal pull', VP: Pattern = 'Vertical press', VL: Pattern = 'Vertical pull';

/** A catalog lift whose words read differently from its record, each for a reason. Kept short: every entry is a known disagreement. */
const EXCEPTIONS: Record<string, string> = {
  'Cable Kickback': 'the catalog’s is the glute kickback; "kickback" alone reads as triceps, as DB Kickback does',
  'Machine Row': 'the catalog’s machine row has always been lats first; a row from its words is mid-back',
};

const sorted = (n: Needs | null) => n?.map((alt) => [...alt].sort());

describe('the catalog is the first test set: each lift’s words read as its record', () => {
  it('nearly every lift, and every exception is a lift that still disagrees', () => {
    expect(LIFTS.length).toBeGreaterThan(100);
    expect(Object.keys(EXCEPTIONS).length).toBeLessThanOrEqual(LIFTS.length / 20);
    for (const n of Object.keys(EXCEPTIONS)) {
      const l = LIFTS.find((x) => x.name === n)!;
      expect(l, n).toBeDefined();
      expect(fromWords(n).m, n).not.toEqual(l.m);
    }
  });
  for (const l of LIFTS.filter((x) => !(x.name in EXCEPTIONS))) {
    it(l.name, () => {
      const b = fromWords(l.name);
      expect(b.m, 'muscles').toEqual(l.m);
      expect(b.p, 'pattern').toBe(l.p ?? null);
      expect(b.iso, 'isolation').toBe(!!l.iso);
      // Gear read from words is one of the record's alternatives, or unknown; it never claims gear the record doesn't need.
      for (const alt of sorted(b.needs) ?? []) expect(sorted(l.needs), 'gear').toContainEqual(alt);
    });
  }
});

type Case = [name: string, how: How, m: Vector | null, p?: Pattern | null, more?: { iso?: boolean; needs?: Needs | null; lift?: string }];

const CASES: Case[] = [
  // Spellings of listed lifts: case, plurals, dumbbell → db, word order, joined words, abbreviations.
  ['dumbbell curl', 'catalog', B, null, { lift: 'DB Curl', needs: [['dumbbells']] }],
  ['Pullups', 'catalog', PULLDOWN, VL, { lift: 'Pull-up' }],
  ['lat pull down', 'catalog', PULLDOWN, VL, { lift: 'Lat Pulldown' }],
  ['Romanian Deadlifts', 'catalog', HINGE, 'Hinge', { lift: 'Romanian Deadlift' }],
  ['Curl Hammer', 'catalog', { Biceps: 1, Forearms: 0.5 }, null, { lift: 'Hammer Curl' }],
  ['Farmers Carry', 'catalog', { Forearms: 1, Traps: 0.5 }, null, { lift: 'Farmer’s Carry' }],
  ['Chin Ups', 'catalog', CHIN, VL, { lift: 'Chin-up' }],
  ['Incline Dumbbell Press', 'catalog', PRESS, HP, { lift: 'Incline DB Press' }],
  ['Dumbbell Incline Press', 'catalog', PRESS, HP, { lift: 'Incline DB Press' }],
  ['Push Ups', 'catalog', PRESS, null, { lift: 'Push-up' }],
  ['T Bar Row', 'catalog', ROW_MID, HL, { lift: 'T-Bar Row' }],
  ['Skull Crushers', 'catalog', T, null, { lift: 'Skullcrusher', iso: false }],
  ['RDL', 'catalog', HINGE, 'Hinge', { lift: 'Romanian Deadlift' }],
  ['DB RDL', 'catalog', HINGE, 'Hinge', { lift: 'DB Romanian Deadlift' }],
  ['OHP', 'catalog', OHP, VP, { lift: 'Overhead Press' }],
  ['BSS', 'catalog', SQUAT, 'Squat', { lift: 'Bulgarian Split Squat' }],
  ['Tricep Pushdowns', 'built', T, null, { iso: true, needs: [['cable stack']] }],
  ['Leg Extensions', 'catalog', { Quads: 1 }, null, { lift: 'Leg Extension' }],
  ['Seated Calf Raises', 'catalog', CALF, null, { lift: 'Seated Calf Raise' }],
  ['Face Pulls', 'catalog', { 'Rear Delts': 1, 'Mid-Back': 0.5, Traps: 0.5 }, null, { lift: 'Face Pull' }],
  ['Dips', 'alias', PRESS, null, { needs: [['dip station']], lift: 'Forward-Lean Dips' }],

  // The bugs the first-match keywords had.
  ['Leg Press Calf Raise', 'built', CALF, null, { iso: true, needs: [['leg press']] }],
  ['Calf Press on the Leg Press', 'built', CALF, null, { iso: true, needs: [['leg press']] }],
  ['Neck Curl', 'built', NONE, null, { iso: true }],
  ['Neck Extension', 'built', NONE, null],
  ['Glute Ham Raise', 'built', { Hamstrings: 1, Glutes: 0.5 }, null, { iso: false }],
  ['GHR', 'built', { Hamstrings: 1, Glutes: 0.5 }, null],
  ['Sissy Squat', 'built', { Quads: 1 }, null, { iso: true }],
  ['Copenhagen Plank', 'built', { Adductors: 1 }, null],
  ['Glute Kickback', 'built', GLUTE, null, { iso: true }],
  ['Cable Glute Kickback', 'built', GLUTE, null, { needs: [['cable stack']] }],
  ['Flat Bench Lying Leg Raise', 'built', A, null, { iso: true }],
  ['Close-Grip Barbell Bench Press', 'built', CLOSE, HP, { needs: [['barbell', 'flat bench']] }],
  // Words inside words: "machine" holds "chin", "narrow" holds "row".
  ['Hack Squat Machine', 'built', SQUAT, 'Squat'],
  ['Smith Machine Squat', 'built', SQUAT, 'Squat', { needs: [['smith machine']] }],
  ['Pec Deck Machine', 'built', { Chest: 1 }, null, { needs: [['pec deck']] }],
  ['Machine Fly', 'built', { Chest: 1 }, null, { needs: [['pec deck']], iso: true }],
  ['Narrow Grip Bench Press', 'built', CLOSE, HP],
  ['Machine Incline Press', 'built', PRESS, HP, { needs: [['chest press machine']] }],
  // A bench-supported row is a row.
  ['Bench Supported DB Row', 'built', ROW_MID, HL, { needs: [['dumbbells', 'flat bench']] }],
  ['Incline Bench Row', 'built', ROW_MID, HL],
  ['Incline DB Row', 'built', ROW_MID, HL, { needs: [['dumbbells', 'incline bench']] }],

  // Modifiers, alone and together.
  ['Close-Grip Incline DB Press', 'built', CLOSE, HP, { needs: [['dumbbells', 'incline bench']] }],
  ['Wide-Grip Seated Cable Row', 'built', ROW_MID, HL, { needs: [['cable stack']] }],
  ['Diamond Push-up', 'built', CLOSE, null, { needs: [[]] }],
  ['Triceps Dips', 'built', CLOSE, null, { needs: [['dip station']] }],
  ['Bench Dips', 'built', CLOSE, null, { needs: [['flat bench']] }],
  ['Weighted Dips', 'built', PRESS, null, { needs: [['dip station']] }],
  ['Low to High Cable Crossover', 'built', { Chest: 1, 'Front Delts': 0.5 }, null, { needs: [['dual cable']] }],
  ['High to Low Cable Fly', 'built', { Chest: 1 }, null, { needs: [['dual cable']] }],
  ['Sumo Deadlift', 'built', { ...HINGE, Adductors: 0.5 }, 'Hinge', { needs: [['barbell']] }],
  ['Sumo Squat', 'built', { ...SQUAT, Adductors: 0.5 }, 'Squat'],
  ['Trap Bar Deadlift', 'built', { ...HINGE, Quads: 0.5 }, 'Hinge'],
  ['Hex Bar Deadlift', 'built', { ...HINGE, Quads: 0.5 }, 'Hinge'],
  ['Lateral Lunge', 'built', { ...SQUAT, Adductors: 0.5 }, null],
  ['Cossack Squat', 'built', { ...SQUAT, Adductors: 0.5 }, 'Squat'],
  ['Rope Hammer Curl', 'built', { Biceps: 1, Forearms: 0.5 }, null, { needs: [['cable stack']] }],
  ['Cross Body Hammer Curl', 'built', { Biceps: 1, Forearms: 0.5 }, null],
  ['Zottman Curl', 'catalog', { Biceps: 1, Forearms: 0.5 }, null],
  ['Reverse Grip EZ Bar Curl', 'built', { Forearms: 1, Biceps: 0.5 }, null, { iso: true }],
  ['Cable Reverse Curl', 'built', { Forearms: 1, Biceps: 0.5 }, null, { needs: [['cable stack']] }],
  ['Reverse Wrist Curl', 'built', F, null, { iso: true }],
  ['Paused Bench Press', 'built', PRESS, HP, { needs: [['barbell', 'flat bench']] }],
  ['Tempo Squat', 'built', SQUAT, 'Squat', { needs: [['barbell', 'squat rack']] }],
  ['Deficit Deadlift', 'built', HINGE, 'Hinge', { needs: [['barbell']] }],
  ['Single-Leg RDL', 'built', HINGE, 'Hinge'],
  ['Stiff-Leg Deadlift', 'built', HINGE, 'Hinge'],
  ['Goblet Squat', 'built', SQUAT, 'Squat', { needs: [['dumbbells']] }],
  ['Box Squat', 'built', SQUAT, 'Squat'],
  ['Zercher Squat', 'built', SQUAT, 'Squat', { needs: [['barbell', 'squat rack']] }],
  ['Kroc Row', 'built', ROW_MID, HL],
  ['Pendlay Row', 'built', ROW_MID, HL],
  ['Barbell Row', 'built', ROW_MID, HL, { needs: [['barbell']] }],
  ['Bent Over Row', 'built', ROW_MID, HL],
  ['Seal Row', 'built', ROW_MID, HL],
  ['Single-Arm Cable Row', 'built', ROW_MID, HL, { needs: [['cable stack']] }],
  ['One Arm DB Row', 'built', ROW_MID, HL, { needs: [['dumbbells']] }],
  ['Meadows Row', 'built', ROW_LAT, HL, { needs: [['landmine', 'barbell']] }],
  ['Landmine Meadows Row', 'built', ROW_LAT, HL, { needs: [['landmine', 'barbell']] }],
  ['Lat Row', 'built', ROW_LAT, HL],
  ['Underhand Row', 'built', ROW_MID, HL],
  ['Inverted Row', 'built', ROW_MID, HL],

  // Grip on the vertical pulls (round 13's pull bias).
  ['Neutral Grip Chin', 'built', CHIN, VL],
  ['Supinated Lat Pulldown', 'built', CHIN, VL, { needs: [['lat pulldown']] }],
  ['Underhand Pulldown', 'built', CHIN, VL],
  ['Reverse-Grip Lat Pulldown', 'built', CHIN, VL],
  ['V-Bar Pulldown', 'built', CHIN, VL],
  ['Weighted Chin-up', 'built', CHIN, VL, { needs: [['pull-up bar']] }],
  ['Wide-Grip Lat Pulldown', 'built', PULLDOWN, VL],
  ['Neutral Grip Pulldown', 'built', PULLDOWN, VL],
  ['Weighted Pull-up', 'built', PULLDOWN, VL],
  ['Assisted Pull-up', 'built', PULLDOWN, VL],
  ['Machine Pulldown', 'built', PULLDOWN, VL],
  ['Behind the Neck Pulldown', 'built', PULLDOWN, VL],
  ['Straight Arm Cable Pulldown', 'built', { Lats: 1 }, null, { iso: false, needs: [['cable stack']] }],
  ['Lat Prayer', 'built', { Lats: 1 }, null, { iso: true }],

  // Presses: the bare word is a chest press; seated, standing or overhead makes it a shoulder press.
  ['Seated DB Press', 'built', OHP, VP, { needs: [['dumbbells']] }],
  ['Standing Barbell Press', 'built', OHP, VP, { needs: [['barbell', 'squat rack']] }],
  ['Behind the Neck Press', 'built', OHP, VP],
  ['Military Press', 'built', OHP, VP, { needs: [['barbell', 'squat rack']] }],
  ['Seated Military Press', 'built', OHP, VP],
  ['Push Press', 'built', OHP, VP],
  ['Z Press', 'built', OHP, VP],
  ['Smith Shoulder Press', 'built', OHP, VP, { needs: [['smith machine']] }],
  ['Dumbbell Shoulder Press', 'catalog', OHP, VP, { lift: 'DB Shoulder Press' }],
  ['Seated DB Shoulder Press', 'built', OHP, VP, { needs: [['dumbbells']] }],
  ['Overhead DB Press', 'alias', OHP, VP, { needs: [['dumbbells']], lift: 'DB Shoulder Press' }],
  ['DB Press', 'built', PRESS, HP, { needs: [['dumbbells']] }],
  ['Floor Press', 'built', PRESS, HP],
  ['DB Floor Press', 'built', PRESS, HP, { needs: [['dumbbells']] }],
  ['Pin Press', 'built', PRESS, HP],
  ['Decline Bench Press', 'built', PRESS, HP, { needs: [['barbell', 'decline bench']] }],
  ['DB Bench Press', 'built', PRESS, HP, { needs: [['dumbbells', 'flat bench']] }],
  ['Smith Machine Bench Press', 'built', PRESS, HP, { needs: [['smith machine', 'flat bench']] }],
  ['Hammer Strength Chest Press', 'built', PRESS, HP, { needs: [['chest press machine']] }],
  ['JM Press', 'built', T, null, { iso: false }],
  ['Tate Press', 'built', T, null],
  ['Pallof', 'built', A, null, { needs: [['cable stack']] }],
  ['Svend Press', 'built', { Chest: 1 }, null, { iso: true }],
  ['Pike Push-up', 'built', OHP, null, { needs: [[]] }],
  ['Handstand Push-up', 'built', OHP, null],
  ['Decline Push-up', 'built', PRESS, null, { needs: [[]] }],

  // Shoulders, traps.
  ['Lu Raise', 'built', SD, null, { iso: true }],
  ['Cable Y Raise', 'built', SD, null, { needs: [['cable stack']] }],
  ['Side Lateral Raise', 'built', SD, null],
  ['Lateral Cable Raise', 'catalog', SD, null, { lift: 'Cable Lateral Raise', needs: [['cable stack']] }],
  ['Lateral Raise Cable Single Arm', 'built', SD, null, { needs: [['cable stack']] }],
  ['Egyptian Lateral Raise', 'built', SD, null],
  ['Upright Row', 'built', { 'Side Delts': 1, Traps: 0.5 }, null, { iso: false }],
  ['Cable Upright Row', 'built', { 'Side Delts': 1, Traps: 0.5 }, null, { needs: [['cable stack']] }],
  ['Plate Front Raise', 'built', { 'Front Delts': 1 }, null, { needs: [['plates']] }],
  ['Rear Delt Row', 'built', { 'Rear Delts': 1, 'Mid-Back': 0.5 }, null, { iso: true }],
  ['Bent Over Reverse Fly', 'built', RD, null],
  ['Rear Delt Machine', 'built', RD, null, { needs: [['pec deck']] }],
  ['Rope Face Pull', 'built', { 'Rear Delts': 1, 'Mid-Back': 0.5, Traps: 0.5 }, null, { needs: [['cable stack']] }],
  ['Shrug', 'built', { Traps: 1 }, null, { iso: true }],
  ['DB Shrug', 'built', { Traps: 1 }, null, { needs: [['dumbbells']] }],
  ['Barbell Shrugs', 'built', { Traps: 1 }, null, { needs: [['barbell']] }],
  ['Kelso Shrug', 'built', { 'Mid-Back': 1, Traps: 0.5 }, null],
  ['External Rotation', 'built', NONE, null, { iso: true }],
  ['Cable External Rotation', 'built', NONE, null, { needs: [['cable stack']] }],
  ['Cuban Press', 'built', NONE, null],

  // Chest and arms.
  ['Pec Deck', 'built', { Chest: 1 }, null, { iso: true }],
  ['DB Fly', 'built', { Chest: 1 }, null, { needs: [['dumbbells', 'flat bench']] }],
  ['Incline DB Flyes', 'built', { Chest: 1 }, null, { needs: [['dumbbells', 'incline bench']] }],
  ['Cable Crossover', 'built', { Chest: 1 }, null, { needs: [['dual cable']] }],
  ['DB Pullover', 'built', { Chest: 1, Lats: 0.5 }, null, { iso: true, needs: [['dumbbells', 'flat bench']] }],
  ['Cable Pullover', 'built', { Lats: 1 }, null, { needs: [['cable stack']] }],
  ['Straight-Arm Dumbbell Pullover', 'built', { Chest: 1, Lats: 0.5 }, null, { needs: [['dumbbells', 'flat bench']] }],
  ['Straight Arm Rope Pullover', 'built', { Lats: 1 }, null, { needs: [['cable stack']] }],
  ['Spider Curl', 'built', B, null, { iso: true }],
  ['Concentration Curl', 'built', B, null],
  ['Barbell Curl', 'built', B, null, { needs: [['barbell']] }],
  ['EZ Bar Curl', 'built', B, null],
  ['Preacher Curl Machine', 'built', B, null, { needs: [['biceps curl machine']] }],
  ['Finger Curl', 'built', F, null],
  ['Wrist Roller', 'built', F, null],
  ['Rope Pushdown', 'catalog', T, null],
  ['V-Bar Pushdown', 'built', T, null, { needs: [['cable stack']] }],
  ['Overhead Triceps Extension', 'built', T, null, { iso: true }],
  ['Cable Overhead Extension', 'catalog', T, null, { lift: 'Overhead Cable Extension' }],
  ['Rope Overhead Extension', 'built', T, null, { needs: [['cable stack']] }],
  ['EZ Bar Skullcrusher', 'built', T, null, { iso: false }],
  ['French Press', 'built', T, null, { iso: true }],
  ['Triceps Kickback', 'built', T, null, { iso: true }],
  ['Cable Triceps Kickback', 'built', T, null, { needs: [['cable stack']] }],

  // Legs, glutes, lower back.
  ['Leg Curl', 'built', { Hamstrings: 1 }, null, { iso: true }],
  ['Standing Leg Curl', 'built', { Hamstrings: 1 }, null],
  ['Leg Curl Something', 'built', { Hamstrings: 1 }, null],
  ['Nordic Curl', 'built', { Hamstrings: 1 }, null, { iso: false }],
  ['Leg Extension Machine', 'built', { Quads: 1 }, null, { needs: [['leg extension']] }],
  ['Hack Squat', 'built', SQUAT, 'Squat'],
  ['Belt Squat', 'built', SQUAT, 'Squat'],
  ['Walking Lunge', 'built', SQUAT, null],
  ['Reverse Lunge', 'built', SQUAT, null],
  ['DB Lunges', 'built', SQUAT, null, { needs: [['dumbbells']] }],
  ['Step-up', 'built', SQUAT, null],
  ['Split Squat', 'built', SQUAT, 'Squat'],
  ['DB Bulgarian Split Squat', 'built', SQUAT, 'Squat', { needs: [['dumbbells', 'flat bench']] }],
  ['Wall Sit', 'built', { Quads: 1 }, null],
  ['Good Morning', 'built', HINGE, 'Hinge', { needs: [['barbell', 'squat rack']] }],
  ['Rack Pull', 'built', { ...HINGE, Traps: 0.5 }, 'Hinge'],
  ['Kettlebell Swing', 'built', GLUTE, null, { iso: true }],
  ['Cable Pull Through', 'built', GLUTE, null, { iso: true, needs: [['cable stack']] }],
  ['Hip Thrust Machine', 'built', GLUTE, null],
  ['Smith Hip Thrust', 'built', GLUTE, null, { needs: [['smith machine', 'flat bench']] }],
  ['Glute Bridge', 'built', GLUTE, null],
  ['Donkey Kick', 'built', GLUTE, null, { iso: true }],
  ['Reverse Hyper', 'built', { Glutes: 1, Hamstrings: 0.5, Erectors: 0.5 }, null, { iso: true }],
  ['Hyperextension', 'built', { Erectors: 1, Glutes: 0.5, Hamstrings: 0.5 }, null, { needs: [['back extension bench']] }],
  ['45 Degree Back Extension', 'built', { Erectors: 1, Glutes: 0.5, Hamstrings: 0.5 }, null],
  ['Hip Adduction', 'built', { Adductors: 1 }, null, { needs: [['hip adduction machine']] }],
  ['Adductor Machine', 'built', { Adductors: 1 }, null, { needs: [['hip adduction machine']] }],
  ['Cable Hip Abduction', 'built', { Abductors: 1 }, null, { needs: [['cable stack']] }],
  ['Donkey Calf Raise', 'built', CALF, null],
  ['Smith Calf Raise', 'built', CALF, null, { needs: [['smith machine']] }],
  ['Tibialis Raise', 'built', NONE, null, { iso: true }],

  // Core and carries.
  ['Ab Wheel Rollout', 'built', A, null, { iso: false }],
  ['Hanging Knee Raise', 'built', A, null, { iso: true, needs: [['pull-up bar']] }],
  ['Toes to Bar', 'built', A, null],
  ['Russian Twist', 'built', A, null, { iso: true }],
  ['Cable Woodchop', 'built', A, null, { needs: [['cable stack']] }],
  ['DB Side Bend', 'built', A, null, { needs: [['dumbbells']] }],
  ['Reverse Crunch', 'built', A, null, { iso: true }],
  ['Standing Cable Crunch', 'built', A, null, { needs: [['cable stack']] }],
  ['Weighted Plank', 'built', A, null, { needs: null }],
  ['Farmer Walk', 'built', { Forearms: 1, Traps: 0.5 }, null, { needs: [['dumbbells']] }],
  ['Suitcase Carry', 'built', { Forearms: 1, Abs: 0.5 }, null],
  ['Dead Hang', 'built', F, null, { needs: [['pull-up bar']] }],

  // Names from free-exercise-db the first builder misread.
  ['Calf-Machine Shoulder Shrug', 'built', { Traps: 1 }, null],
  ['Leg Pull-In', 'built', A, null, { iso: true }],
  ['Incline Bench Pull', 'built', ROW_MID, HL],
  ['Reverse Flyes With External Rotation', 'built', RD, null],
  ['Wrist Rotations with Straight Bar', 'built', F, null],
  ['Barbell Step Ups', 'built', SQUAT, null, { needs: [['barbell', 'flat bench']] }],
  ['Reverse Hyperextension', 'built', { Glutes: 1, Hamstrings: 0.5, Erectors: 0.5 }, null],
  ['Dip Machine', 'built', CLOSE, null],
  ['Kneeling High Pulley Row', 'built', ROW_LAT, HL, { needs: [['cable stack']] }],
  ['One-Legged Cable Kickback', 'built', GLUTE, null, { needs: [['cable stack']] }],
  ['Tricep Push-up', 'built', CLOSE, null],
  ['Standing Dumbbell Straight-Arm Front Delt Raise Above Head', 'built', { 'Front Delts': 1 }, null],
  ['Side Bridge', 'catalog', { Abs: 1, Erectors: 0.5 }, null, { lift: 'Side Plank' }],
  ['Smith Machine Hip Raise', 'built', GLUTE, null, { needs: [['smith machine']] }],
  ['Flutter Kicks', 'built', A, null],
  ['Dumbbell Scaption', 'built', SD, null, { needs: [['dumbbells']] }],

  // Stage 3: new gear the words name, and a few movements the evaluation found.
  ['Trap Bar RDL', 'built', HINGE, 'Hinge', { needs: [['trap bar']] }],
  ['KB Goblet Squat Paused', 'built', SQUAT, 'Squat', { needs: [['kettlebells']] }],
  ['Seated EZ Curl', 'built', B, null, { iso: true, needs: [['ez bar']] }],
  ['Hack Squat Calf Raise', 'built', CALF, null, { iso: true }],
  ['Kneeling Hip Thrust Machine', 'built', GLUTE, null, { needs: [['hip thrust machine']] }],
  ['Middle Back Shrug', 'built', { 'Mid-Back': 1, Traps: 0.5 }, null, { iso: true }],
  ['Hanging Pike', 'built', A, null, { iso: true, needs: [['pull-up bar']] }],
  ['Alternate Heel Touchers', 'built', A, null, { iso: true, needs: [[]] }],
  ['Standing Cable Lift', 'built', A, null, { iso: true, needs: [['cable stack']] }],
  // Nothing to go on: no muscles, no pattern, no gear.
  ['Zercher Thing', 'none', null, null, { iso: false, needs: null }],
  ['Atlas Stone', 'none', null, null],
  ['Burpee', 'none', null, null],
  ['Power Clean', 'none', null, null],
  ['Rowing Machine', 'none', null, null],
  ['Leg Day', 'none', null, null],
  ['Chest', 'none', null, null],
];

describe('resolveLift: what a name counts as, and how it was found', () => {
  it(`has ${CASES.length} cases, each name once`, () => {
    expect(CASES.length).toBeGreaterThanOrEqual(150);
    const names = CASES.map((c) => c[0].toLowerCase());
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
  for (const [name, how, m, p, more] of CASES) {
    it(name, () => {
      // A 'built' case is the builder's: the words alone give it. Since the catalog grew (stage 3) the table may list the name
      // too, and then its record counts the same muscles, with the gear the record names.
      const listed = how === 'built' && resolveLift(name).how !== 'built';
      if (listed) {
        expect(['catalog', 'alias'], 'how').toContain(resolveLift(name).how);
        expect(resolveLift(name).m, 'the record’s muscles').toEqual(m);
      }
      const r = how === 'built' ? { ...fromWords(name), how: 'built', lift: undefined } : resolveLift(name);
      expect(r.how, 'how').toBe(how);
      expect(r.m, 'muscles').toEqual(m);
      if (p !== undefined) expect(r.p, 'pattern').toBe(p);
      if (more?.iso !== undefined) expect(r.iso, 'isolation').toBe(more.iso);
      if (more && 'needs' in more) expect(sorted(r.needs), 'gear').toEqual(sorted(more.needs ?? null));
      if (more?.lift) expect(r.lift?.name, 'lift').toBe(more.lift);
    });
  }
});

describe('fromWords', () => {
  it('a modifier that changes nothing leaves the profile as the plain lift’s', () => {
    for (const w of ['Paused', 'Tempo', 'Single-Arm', 'Seated', 'Kroc', 'Pendlay', 'Chains'])
      expect(fromWords(`${w} Cable Row`).m, w).toEqual(fromWords('Cable Row').m);
  });
  it('the more specific phrase wins whatever the order of the words', () => {
    expect(fromWords('Calf Raise on Leg Press').m).toEqual(CALF);
    expect(fromWords('Leg Press Calf Raise').m).toEqual(CALF);
    expect(fromWords('Calf Leg Press').m).toEqual(CALF);
    expect(fromWords('Seated Leg Curl Machine').m).toEqual({ Hamstrings: 1 });
    expect(fromWords('Straight-Arm Lat Pulldown').m).toEqual({ Lats: 1 });
    expect(fromWords('Upright Row').m).toEqual({ 'Side Delts': 1, Traps: 0.5 });
  });
  it('a lift with no gear words takes the gear its movement needs; one with gear words, those', () => {
    expect(fromWords('Lat Pulldown Wide').needs).toEqual([['lat pulldown']]);
    expect(fromWords('Cable Lateral Raise Single Arm').needs).toEqual([['cable stack']]);
    expect(fromWords('Smith Machine Incline Press').needs).toEqual([['smith machine', 'incline bench']]);
    expect(fromWords('Mystery Curl').needs).toBeNull();
  });
});
