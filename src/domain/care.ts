import { addDays, weekStart } from './analytics';
import { CATALOG } from './catalog';
import { muscleVector, MUSCLES } from './muscles';
import type { Slot } from './program';
import { exerciseNames, sameExercise } from './stats';
import type { Region, SetEntry } from './types';

// Not medical advice: these helpers record and surface patterns; they never diagnose.

export function similarity(a: string, b: string): number {
  const va = muscleVector(a), vb = muscleVector(b);
  if (!va || !vb) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const m of MUSCLES) { const x = va[m] ?? 0, y = vb[m] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// First match wins: "Leg Curl" is a knee lift before it is a curl; "Back Extension" is a back lift before it is an extension.
const REGION_RULES: [RegExp, Region][] = [
  [/wrist|pinch/i, 'wrist'],
  [/leg extension|leg curl|lunge|split squat|step-?up/i, 'knee'],
  [/deadlift|squat|good morning|back extension|hinge|hip thrust|leg press/i, 'lower back'],
  [/curl|pushdown|push down|extension|skull|kickback|triceps|\bdips?\b/i, 'elbow'],
  [/press|raise|\bfly\b|face pull|rear delt|pec deck|pull-?up|pulldown|chin|push-?up|bench/i, 'shoulder'],
];
export const likelyRegion = (exercise: string): Region => REGION_RULES.find(([re]) => re.test(exercise))?.[1] ?? 'other';

/** Lifts that load a region hard; steered away from while that region has hurt recently. */
const STRESS: Partial<Record<Region, RegExp>> = {
  elbow: /skull|overhead.*extension|close-grip|\bdips?\b|french press/i,
  'lower back': /deadlift|barbell squat|smith squat|good morning|bent-over row/i,
  shoulder: /overhead press|arnold|upright row|\bdips?\b|behind the neck/i,
  knee: /leg extension|lunge|split squat/i,
};

export const HOLD_EXERCISES = new Set(['plank', 'side plank', 'bird dog', 'dead bug', 'mcgill curl-up', 'plate pinch hold']);
export const isHold = (name: string): boolean => HOLD_EXERCISES.has(name.trim().replace(/\s+/g, ' ').toLowerCase());

/** McGill's "big 3" for spine endurance, as hold-time sets. */
export const BACK_BLOCK: Slot[] = ['Bird Dog', 'Side Plank', 'McGill Curl-Up'].map((exercise) => ({ exercise, sets: 2, repMin: 20, repMax: 40 }));

export function recentPain(entries: SetEntry[], today: string, days = 60): { byExercise: Map<string, number>; regions: Set<Region> } {
  const since = addDays(today, -days);
  const byExercise = new Map<string, number>();
  const regions = new Set<Region>();
  for (const e of entries) {
    if (!e.flags.includes('pain') || e.date < since || e.date > today) continue;
    const k = e.exercise.toLowerCase();
    byExercise.set(k, (byExercise.get(k) ?? 0) + 1);
    regions.add(e.painRegion ?? likelyRegion(e.exercise));
  }
  return { byExercise, regions };
}

export interface Suggestion { name: string; score: number; why: string }

/** Same-muscle alternatives, ranked by similarity, pushed down if they hurt recently or load a region that did. */
export function swapSuggestions(exercise: string, entries: SetEntry[], today: string, limit = 5): Suggestion[] {
  const pain = recentPain(entries, today);
  const logged = exerciseNames(entries);
  const pool = [...logged, ...CATALOG.filter((c) => !logged.some((l) => sameExercise(l, c)))].filter((n) => !sameExercise(n, exercise));
  const out: Suggestion[] = [];
  for (const name of pool) {
    const sim = similarity(exercise, name);
    if (sim <= 0.5) continue;
    let score = sim;
    const why: string[] = [sim > 0.99 ? 'same muscles' : 'similar muscles'];
    const hurt = pain.byExercise.get(name.toLowerCase()) ?? 0;
    if (hurt) { score -= 0.3 * Math.min(hurt, 3); why.push('pain logged recently'); }
    const loaded = [...pain.regions].find((r) => STRESS[r]?.test(name));
    if (loaded) { score -= 0.25; why.push(`loads your ${loaded}, which hurt recently`); }
    if (!hurt && !loaded && pain.regions.size) why.push('no recent pain');
    if (logged.includes(name)) { score += 0.05; why.push('you’ve done it'); }
    out.push({ name, score, why: why.join(' · ') });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface RegionReport {
  region: Region; weekly: number[]; total: number; rising: boolean;
  byExercise: { exercise: string; sets: number; maxSeverity: number; avgWeight: number }[];
}

/** Pain-flagged sets per region per week (oldest first, ending with this week). */
export function painReport(entries: SetEntry[], today: string, weeks = 8): RegionReport[] {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const by = new Map<Region, SetEntry[]>();
  for (const e of entries) {
    if (!e.flags.includes('pain') || e.date < first || e.date > today) continue;
    const r = e.painRegion ?? 'other';
    by.set(r, [...(by.get(r) ?? []), e]);
  }
  return [...by.entries()].map(([region, sets]) => {
    const weekly = Array(weeks).fill(0) as number[];
    for (const e of sets) weekly[Math.round((Date.parse(weekStart(e.date)) - Date.parse(first)) / (7 * 864e5))]++;
    const ex = new Map<string, SetEntry[]>();
    for (const e of sets) ex.set(e.exercise, [...(ex.get(e.exercise) ?? []), e]);
    const n = weekly.length;
    return {
      region, weekly, total: sets.length,
      // Two consecutive weekly increases, so one bad set doesn't raise an alarm.
      rising: n >= 3 && weekly[n - 3] < weekly[n - 2] && weekly[n - 2] < weekly[n - 1],
      byExercise: [...ex.entries()].map(([exercise, xs]) => ({
        exercise, sets: xs.length,
        maxSeverity: Math.max(0, ...xs.map((x) => x.painSeverity ?? 0)),
        avgWeight: Math.round(xs.reduce((a, x) => a + x.weight, 0) / xs.length),
      })).sort((a, b) => b.sets - a.sets),
    };
  }).sort((a, b) => b.total - a.total);
}
