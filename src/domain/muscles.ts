import { normalizeName } from './ids';

export const MUSCLES = ['Chest', 'Triceps', 'Biceps', 'Front Delts', 'Side Delts', 'Rear Delts', 'Lats', 'Mid-Back', 'Traps', 'Erectors',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms', 'Adductors', 'Abductors'] as const;
export type Muscle = (typeof MUSCLES)[number];
export type Vector = Partial<Record<Muscle, number>>;
export const MUSCLE_LABEL: Record<Muscle, string> = Object.fromEntries(MUSCLES.map((m) => [m, m])) as Record<Muscle, string>;

const PRESS: Vector = { Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 };
const OHP: Vector = { 'Front Delts': 1, Triceps: 0.5, 'Side Delts': 0.5 };
const ROW_MID: Vector = { 'Mid-Back': 1, Lats: 0.5, 'Rear Delts': 0.5, Biceps: 0.5, Forearms: 0.5 };
const ROW_LAT: Vector = { Lats: 1, 'Mid-Back': 0.5, 'Rear Delts': 0.5, Biceps: 0.5, Forearms: 0.5 };
const PULLDOWN: Vector = { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5, Forearms: 0.5 };
const SQUAT: Vector = { Quads: 1, Glutes: 0.5, Hamstrings: 0.5 };
const HINGE: Vector = { Hamstrings: 1, Glutes: 0.5, Erectors: 0.5 };
const LEGCURL: Vector = { Hamstrings: 1 };
const B: Vector = { Biceps: 1 }, T: Vector = { Triceps: 1 }, A: Vector = { Abs: 1 }, SD: Vector = { 'Side Delts': 1 }, RD: Vector = { 'Rear Delts': 1 };

const TABLE: Record<string, Vector> = {
  'bench press': PRESS, 'incline bench press': PRESS, 'smith incline press': PRESS, 'smith flat press': PRESS, 'incline db press': PRESS,
  'flat db press': PRESS, 'machine chest press': PRESS, 'push-up': PRESS, 'weighted push-up': PRESS, 'close-grip push-up': { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 },
  'close-grip smith press': { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 }, 'close-grip bench press': { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 },
  'forward-lean dips': { Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 }, 'upright dips': { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 }, dips: { Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 },
  'machine chest fly': { Chest: 1 }, 'cable chest fly': { Chest: 1 }, 'low-to-high cable fly': { Chest: 1, 'Front Delts': 0.5 },
  'cable pushdown': T, 'rope pushdown': T, 'incline bench pushdown': T, 'overhead cable extension': T, 'overhead db triceps extension': T,
  skullcrusher: { Triceps: 1 }, 'db kickback': T, 'triceps press machine': T,
  'db curl': B, 'incline db curl': B, 'hammer curl': { Biceps: 1, Forearms: 0.5 }, 'cable curl': B, 'bayesian cable curl': B, 'preacher curl': B,
  'cross-body db curl': { Biceps: 1, Forearms: 0.5 }, 'machine biceps curl': B, 'reverse curl': { Forearms: 1, Biceps: 0.5 }, 'db reverse curl': { Forearms: 1, Biceps: 0.5 },
  'zottman curl': { Biceps: 1, Forearms: 0.5 }, 'wrist curl': { Forearms: 1 }, 'db wrist curl': { Forearms: 1 }, 'db reverse wrist curl': { Forearms: 1 },
  'farmer’s carry': { Forearms: 1, Traps: 0.5 }, 'plate pinch hold': { Forearms: 1 },
  'overhead press': OHP, 'overhead db press': OHP, 'machine shoulder press': OHP, 'arnold press': OHP,
  'db lateral raise': SD, 'cable lateral raise': SD, 'machine lateral raise': SD, 'front raise': { 'Front Delts': 1 },
  'face pull': { 'Rear Delts': 1, 'Mid-Back': 0.5, Traps: 0.5 }, 'cable rear delt fly': RD, 'reverse pec deck': RD,
  'lat pulldown': PULLDOWN, 'close-grip lat pulldown': PULLDOWN, 'lat pull-in': PULLDOWN, 'pull-up': PULLDOWN, 'chin-up': { Lats: 1, Biceps: 0.5, 'Mid-Back': 0.5, Forearms: 0.5 },
  'straight-arm pulldown': { Lats: 1 }, 'archer pull': { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5 },
  'seated cable row': ROW_MID, 'chest-supported row': ROW_MID, 'kneeling db row': ROW_MID, 'machine row': ROW_LAT,
  'cable crunch': A, 'ab crunch machine': A, 'decline sit-up': A, 'decline crunch (weighted)': A, 'hanging leg raise': A, 'supported leg raise': A, 'leg raise': A,
  'torso rotation machine': A, plank: A, 'side plank': { Abs: 1, Erectors: 0.5 }, 'bird dog': { Erectors: 1, Glutes: 0.5, Abs: 0.5 },
  'mcgill curl-up': A, 'dead bug': A, 'pallof press': A, 'back extension': { Erectors: 1, Glutes: 0.5, Hamstrings: 0.5 },
  'leg press': SQUAT, 'barbell squat': SQUAT, 'smith squat': SQUAT, 'bulgarian split squat': SQUAT, 'leg extension': { Quads: 1 },
  'seated leg curl': LEGCURL, 'lying leg curl': LEGCURL, 'romanian deadlift': HINGE, 'db romanian deadlift': HINGE,
  'hip thrust': { Glutes: 1, Hamstrings: 0.5 }, 'glute press': { Glutes: 1, Hamstrings: 0.5 }, 'cable kickback': { Glutes: 1, Hamstrings: 0.5 },
  'hip adduction machine': { Adductors: 1 }, 'hip abduction machine': { Abductors: 1 },
  'standing calf raise': { Calves: 1 }, 'seated calf raise': { Calves: 1 }, 'db calf raise': { Calves: 1 },
};

// Order matters (leg curl before curl; press before row), and words need boundaries: "machine"
// contains "chin" and "narrow" contains "row".
const KEYWORDS: [RegExp, Vector][] = [
  [/\bleg curl|\bham(string)? curl|\bnordic/i, LEGCURL], [/\bwrist curl/i, { Forearms: 1 }], [/\bcurl/i, B],
  [/pushdown|push down|kickback|skull|\btriceps? ext|french press/i, T],
  [/lateral raise|side raise|upright row/i, SD], [/rear delt|reverse fly|reverse pec|face pull/i, RD],
  [/\bsquat|leg press|\blunge|step-?up|\bhack\b/i, SQUAT], [/deadlift|good morning|\bhinge|\brdl\b/i, HINGE], [/leg ext/i, { Quads: 1 }],
  [/\bcalf|\bcalves/i, { Calves: 1 }], [/hip thrust|\bglute/i, { Glutes: 1, Hamstrings: 0.5 }],
  [/\bfly\b|\bflyes?\b|pec deck/i, { Chest: 1 }], [/overhead press|shoulder press|military|\bohp\b/i, OHP],
  [/bench|chest press|incline.*\bpress|push-?up|\bdips?\b/i, PRESS],
  [/pulldown|pull-?up|\bchin(-?ups?)?\b/i, PULLDOWN], [/\brows?\b/i, ROW_MID],
  [/crunch|sit-?up|plank|leg raise|\babs?\b/i, A],
];

export function muscleVector(name: string): Vector | null {
  const key = normalizeName(name).toLowerCase();
  if (TABLE[key]) return TABLE[key];
  for (const [re, v] of KEYWORDS) if (re.test(key)) return v;
  return null;
}
