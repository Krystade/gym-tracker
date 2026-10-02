import { addDays, weekStart } from './analytics';
import { CATALOG } from './catalog';
import { gearOf } from './equipment';
import { muscleVector, MUSCLES } from './muscles';
import type { Slot } from './program';
import { exerciseNames, sameExercise } from './stats';
import type { Flag, Region, SetEntry } from './types';

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

/** Form defaults: a new pain entry guesses the region and starts mild; an old pain set without details stays unknown until tapped. */
export function painDefaults(initial: { flags: Flag[]; painRegion?: Region; painSeverity?: 1 | 2 | 3 }, exercise: string): { region?: Region; severity?: 1 | 2 | 3 } {
  const had = initial.flags.includes('pain');
  return { region: initial.painRegion ?? (had ? undefined : likelyRegion(exercise)), severity: initial.painSeverity ?? (had ? undefined : 1) };
}

export interface Suggestion { name: string; score: number; why: string }

/** What the two lifts share ("works chest and triceps"), plus the biggest thing the swap adds ("+ more front delts"). */
function muscleWhy(from: string, to: string): string {
  const va = muscleVector(from) ?? {}, vb = muscleVector(to) ?? {};
  const shared = MUSCLES.map((m) => [m, Math.min(va[m] ?? 0, vb[m] ?? 0)] as const).filter(([, o]) => o >= 0.25).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const extra = MUSCLES.filter((m) => (vb[m] ?? 0) >= 0.5 && (va[m] ?? 0) < 0.25).sort((a, b) => (vb[b] ?? 0) - (vb[a] ?? 0))[0];
  const works = shared.length ? `works ${shared.map(([m]) => m.toLowerCase()).join(' and ')}` : 'similar muscles';
  return extra ? `${works} + more ${extra.toLowerCase()}` : works;
}

/** Same-muscle alternatives, ranked by similarity, pushed down if they hurt recently or load a region that did. */
export function swapSuggestions(exercise: string, entries: SetEntry[], today: string, limit = 5, available?: Set<string>): Suggestion[] {
  const pain = recentPain(entries, today);
  const logged = exerciseNames(entries);
  const pool = [...logged, ...CATALOG.filter((c) => !logged.some((l) => sameExercise(l, c)))].filter((n) => !sameExercise(n, exercise) && (!available || available.has(n)));
  const out: Suggestion[] = [];
  for (const name of pool) {
    const sim = similarity(exercise, name);
    if (sim <= 0.5) continue;
    let score = sim;
    const why: string[] = [muscleWhy(exercise, name)];
    // Swaps for one lift share their muscles, so the gear is what tells them apart.
    const gear = gearOf(name);
    if (gear && gear !== gearOf(exercise)) why.push(gear);
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
      // Two consecutive weekly increases, so one bad set doesn't raise an alarm; checked on complete weeks too,
      // so the warning doesn't vanish each Monday while the new week is still empty.
      rising: [n - 1, n - 2].some((k) => k >= 2 && weekly[k - 2] < weekly[k - 1] && weekly[k - 1] < weekly[k]),
      byExercise: [...ex.entries()].map(([exercise, xs]) => ({
        exercise, sets: xs.length,
        maxSeverity: Math.max(0, ...xs.map((x) => x.painSeverity ?? 0)),
        avgWeight: Math.round(xs.reduce((a, x) => a + x.weight, 0) / xs.length),
      })).sort((a, b) => b.sets - a.sets),
    };
  }).sort((a, b) => b.total - a.total);
}
