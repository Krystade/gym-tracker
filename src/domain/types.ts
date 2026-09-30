export const FLAGS = ['bodyweight', 'partial', 'unsure', 'pain', 'double_pulley', 'warmup'] as const;
export type Flag = (typeof FLAGS)[number];
export const isFlag = (s: string): s is Flag => (FLAGS as readonly string[]).includes(s);

export interface SetEntry {
  /** Deterministic: `${source}|${date}|${exercise lowercased}|${setNo}` — re-imports overwrite rather than duplicate. */
  id: string;
  date: string; // YYYY-MM-DD, local
  /** Ordering within a date: import row index, or epoch ms for live-logged sets. */
  seq: number;
  loggedAt?: string;
  exercise: string;
  asWritten?: string;
  setNo: number;
  weight: number; // lb, 0 = bodyweight
  reps: number | null; // null = partial / not recorded
  rir?: number;
  flags: Flag[];
  note?: string;
  source: string; // 'app' or an import label
}
