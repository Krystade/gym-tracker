// Progress photos live only in this device's IndexedDB: never synced, and copied out only in the backup file (domain/backup).

export const POSES = ['front', 'side', 'back'] as const;
export type Pose = (typeof POSES)[number];
/** Each pose relaxed and flexed (owner 2026-10-29: double biceps front and back, side chest). Photos from before are relaxed. */
export const VARIANTS = ['relaxed', 'flexed'] as const;
export type Variant = (typeof VARIANTS)[number];
export interface PhotoMeta { id: string; date: string; pose: Pose; variant: Variant; width: number; height: number; addedAt: string }
/** One photo of the routine: a pose, relaxed or flexed. */
export interface Shot { pose: Pose; variant: Variant }

/** The routine in the order it's walked through: each pose relaxed then flexed, so he turns only between poses. */
export const SHOTS: readonly Shot[] = POSES.flatMap((pose) => VARIANTS.map((variant) => ({ pose, variant })));
export const shotIndex = (s: Shot): number => POSES.indexOf(s.pose) * VARIANTS.length + VARIANTS.indexOf(s.variant);
/** "Front", "Front flexed": relaxed is the plain pose, as every photo was before variants. */
export const shotName = (s: Shot): string => `${s.pose[0].toUpperCase()}${s.pose.slice(1)}${s.variant === 'flexed' ? ' flexed' : ''}`;

/** One photo per pose and variant per date: a retake replaces it. */
export const photoId = (date: string, pose: Pose, variant: Variant): string => `${date}:${pose}:${variant}`;
/** A photo from before variants (id `date:pose`, no variant): relaxed, under its id now. Used by db v10 and an older backup file. */
export function relaxedIfOld<M extends Omit<PhotoMeta, 'variant'> & { variant?: Variant }>(m: M): M & { variant: Variant } {
  return m.variant ? (m as M & { variant: Variant }) : { ...m, id: photoId(m.date, m.pose, 'relaxed'), variant: 'relaxed' };
}

export function fitSize(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** The middle of a `w`×`h` frame at `aspect` (width / height), as CSS object-fit: cover shows it: the still is what was framed. */
export function coverCrop(w: number, h: number, aspect: number): { x: number; y: number; width: number; height: number } {
  if (w / h > aspect) { const width = Math.round(h * aspect); return { x: Math.round((w - width) / 2), y: 0, width, height: h }; }
  const height = Math.round(w / aspect);
  return { x: 0, y: Math.round((h - height) / 2), width: w, height };
}

/**
 * Where each shot's scrubber starts in a recording: the middle of the time it was on screen. `marks[i]`: the second the i-th
 * shot came up (Next pose); `end`: when recording stopped. He walks to the phone to tap Next, so both ends of a span are
 * walking and the middle is the pose held. Shots that never came up (the recording stopped first) get none.
 */
export const seeds = (marks: readonly number[], end: number): number[] =>
  marks.map((at, i) => { const to = Math.max(at, Math.min(end, marks[i + 1] ?? end)); return Math.min(end, (at + to) / 2); });

export function timeline(metas: PhotoMeta[]): { date: string; photos: PhotoMeta[] }[] {
  const by = new Map<string, PhotoMeta[]>();
  for (const x of metas) by.set(x.date, [...(by.get(x.date) ?? []), x]);
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, photos]) => ({ date, photos: photos.sort((a, b) => shotIndex(a) - shotIndex(b)) }));
}

export function comparePair(metas: PhotoMeta[], pose: Pose, variant: Variant): [string, string] | null {
  const dates = [...new Set(metas.filter((x) => x.pose === pose && x.variant === variant).map((x) => x.date))].sort();
  return dates.length >= 2 ? [dates[0], dates.at(-1)!] : null;
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/** Trend weight at the nearest weigh-in within ±`window` days; the earlier one on a tie. */
export function weightNear(date: string, points: { date: string; trend: number }[], window = 3): number | null {
  let best: { d: number; t: number } | null = null;
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    const d = days(date, p.date);
    if (d <= window && (!best || d < best.d)) best = { d, t: p.trend };
  }
  return best ? best.t : null;
}

/** A camera shot is always today's; a library photo takes the date field (blank → today), never a future date. */
export function photoDate(source: 'camera' | 'library', field: string, today: string): string | null {
  if (source === 'camera' || !field) return today;
  return field > today ? null : field;
}
