export const FLAGS = ['bodyweight', 'partial', 'unsure', 'pain', 'double_pulley', 'warmup', 'test', 'hold', 'cardio', 'light',
  'form_fail', 'good_form', 'full_stack', 'no_spot'] as const;
export type Flag = (typeof FLAGS)[number];
export const isFlag = (s: string): s is Flag => (FLAGS as readonly string[]).includes(s);

/** A pain set's severity (SetEntry.painSeverity): 0 tingle, 1 mild, 2 moderate, 3 sharp. */
export type Severity = 0 | 1 | 2 | 3;
export const TINGLE = 0;
export const isSeverity = (n: unknown): n is Severity => n === 0 || n === 1 || n === 2 || n === 3;
/**
 * A set that hurt, as every plan reads pain (painPlan, the morning check, the learning core, records, swaps): pain-flagged and not
 * a tingle. A tingle is kept on the set and counted in the pain report's trend, and nothing else acts on it.
 */
export const hurts = (e: { flags: readonly string[]; painSeverity?: number }): boolean => e.flags.includes('pain') && e.painSeverity !== TINGLE;

export const REGIONS = ['elbow', 'lower back', 'shoulder', 'wrist', 'knee', 'other'] as const;
export type Region = (typeof REGIONS)[number];
export const isRegion = (s: string): s is Region => (REGIONS as readonly string[]).includes(s);

/**
 * The next-morning check on a pain set (item 08, the 24-hour rule): settled, still sore, worse, or `skipped` (dismissed: read as
 * unknown, which changes nothing). Kept on every pain set of that region that day, so it syncs and backs up with them.
 */
export const MORNINGS = ['settled', 'sore', 'worse', 'skipped'] as const;
export type Morning = (typeof MORNINGS)[number];
export const isMorning = (s: string): s is Morning => (MORNINGS as readonly string[]).includes(s);

/** A cardio machine session. `aim`: the distance (mi) or floors suggested when it was logged, for "met the aim?". */
export interface CardioData { seconds: number; miles?: number; incline?: number; level?: number; floors?: number; aim?: number }

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
  /** When Undo put this set back after a delete (epoch ms): it beats that delete in sync without moving the set in its day. */
  restoredAt?: number;
  /** When this set was last changed by hand (epoch ms): between two phones that both changed it, the newer change wins in sync. */
  editedAt?: number;
  exercise: string;
  asWritten?: string;
  setNo: number;
  weight: number; // lb, 0 = bodyweight
  reps: number | null; // null = partial / not recorded
  rir?: number;
  flags: Flag[];
  note?: string;
  /**
   * Where a `pain`-flagged set hurt, and how much: 0 tingle (owner, 2026-11-21: logged and tracked, but no pain to any plan:
   * see `hurts`), 1 mild (≤3/10), 2 moderate (4–5/10), 3 sharp (>5/10). None: not logged (an import), read as moderate.
   */
  painRegion?: Region;
  painSeverity?: Severity;
  /** On a pain set: how that region felt the next morning, and his own words on it, if any (never sent anywhere but his sync). */
  morning?: Morning;
  morningNote?: string;
  source: string; // 'app' or an import label
  /** What the app suggested when this set was logged, and where: for comparing suggested with done. */
  target?: { weight: number | null; reps: number; sets: number }; // weight null: first session, no weight suggested
  gym?: string;
  /**
   * Where the visit this set began was, as codes only friends' phones can compare (domain/place): on a visit's first set, with
   * Location for Together on. Never a place: no point or cell is kept anywhere.
   */
  loc?: string;
  /** A cardio machine session: weight 0, reps null, the `cardio` flag. */
  cardio?: CardioData;
  /**
   * How long the set itself took, s (owner, 2026-11-22): from the set's start (its card opened, its reps field tapped, or Start
   * tapped) to its save, on a set logged live. Never on a hold or cardio, whose seconds are the set itself (reps, cardio.seconds).
   * What timing learns a lift's set time from (timing.setWork); absent when no start was seen.
   */
  workS?: number;
  /** The person's own tags (see domain/tags): plain labels, shown with the set; nothing counts them. */
  tags?: string[];
  /**
   * Not used for learning or records (More → Bar sets logged per side: an old machine's sets whose bar weight isn't known):
   * kept as logged and shown in History, marked; every learner and record reads the log without it (stats.learnable).
   */
  excluded?: true;
}
