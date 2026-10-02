export const FLAGS = ['bodyweight', 'partial', 'unsure', 'pain', 'double_pulley', 'warmup', 'test', 'hold'] as const;
export type Flag = (typeof FLAGS)[number];
export const isFlag = (s: string): s is Flag => (FLAGS as readonly string[]).includes(s);

export const REGIONS = ['elbow', 'lower back', 'shoulder', 'wrist', 'knee', 'other'] as const;
export type Region = (typeof REGIONS)[number];
export const isRegion = (s: string): s is Region => (REGIONS as readonly string[]).includes(s);

export interface SetEntry {
  /** Deterministic: `${source}|${date}|${exercise lowercased}|${setNo}` — re-imports overwrite rather than duplicate. */
  id: string;
  date: string; // YYYY-MM-DD, local
  /** Ordering within a date: import row index, or epoch ms for live-logged sets. */
  seq: number;
  /** When the set was done (a guess for one entered late); absent if unknown. */
  loggedAt?: string;
  /** When a late set was entered; absent for sets logged as they were done. */
  enteredAt?: string;
  exercise: string;
  asWritten?: string;
  setNo: number;
  weight: number; // lb, 0 = bodyweight
  reps: number | null; // null = partial / not recorded
  rir?: number;
  flags: Flag[];
  note?: string;
  /** Where a `pain`-flagged set hurt, and how much: 1 mild (≤3/10), 2 moderate (4–5/10), 3 sharp (>5/10). */
  painRegion?: Region;
  painSeverity?: 1 | 2 | 3;
  source: string; // 'app' or an import label
  /** What the app suggested when this set was logged, and where: for comparing suggested with done. */
  target?: { weight: number | null; reps: number; sets: number }; // weight null: first session, no weight suggested
  gym?: string;
}
