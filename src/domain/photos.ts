// Progress photos live only in this device's IndexedDB: never synced, and copied out only in the backup file (domain/backup).

export const POSES = ['front', 'side', 'back'] as const;
export type Pose = (typeof POSES)[number];
/** Each pose relaxed and flexed (owner 2026-10-29: double biceps front and back, side chest). Photos from before are relaxed. */
export const VARIANTS = ['relaxed', 'flexed'] as const;
export type Variant = (typeof VARIANTS)[number];
/**
 * Upper body (owner 2026-11-06): the same poses framed head to hips in a square, for a bathroom mirror he can't step back from.
 * Each photo keeps its framing; photos from before have none and are full. Only photos of one framing are set side by side.
 */
export const FRAMINGS = ['full', 'upper'] as const;
export type Framing = (typeof FRAMINGS)[number];
export interface PhotoMeta { id: string; date: string; pose: Pose; variant: Variant; framing?: Framing; width: number; height: number; addedAt: string }
export const framingOf = (m: Pick<PhotoMeta, 'framing'>): Framing => m.framing ?? 'full';
export const FRAMING_NAME: Record<Framing, string> = { full: 'Full body', upper: 'Upper body' };
/** Each framing's frame, width / height: the still is cut to it and every screen shows it so. */
export const ASPECT: Record<Framing, number> = { full: 3 / 4, upper: 1 };
/** Upper body's square in the full frame's outline units (ui/poseOutlines, 75 × 100): x, y, width, height. Head to hips. */
export const UPPER_BOX = [9, 3, 57, 57] as const;
/** One photo of the routine: a pose, relaxed or flexed. */
export interface Shot { pose: Pose; variant: Variant }

/** The routine in the order it's walked through: each pose relaxed then flexed, so he turns only between poses. */
export const SHOTS: readonly Shot[] = POSES.flatMap((pose) => VARIANTS.map((variant) => ({ pose, variant })));
export const shotIndex = (s: Shot): number => POSES.indexOf(s.pose) * VARIANTS.length + VARIANTS.indexOf(s.variant);
/** "Front", "Front flexed": relaxed is the plain pose, as every photo was before variants. */
export const shotName = (s: Shot): string => `${s.pose[0].toUpperCase()}${s.pose.slice(1)}${s.variant === 'flexed' ? ' flexed' : ''}`;
/** A photo's name where its framing matters (alt text): upper body said, full body named as it always was. */
export const framedName = (s: Shot, f: Framing): string => `${shotName(s)}${f === 'upper' ? ', upper body' : ''}`;

/**
 * One photo per pose, variant and framing per date: a retake replaces it. A full photo's id is as it was before framings, so
 * nothing moved; an upper body one has `:upper` on the end, so both can be kept of the same pose on one day.
 */
export const photoId = (date: string, pose: Pose, variant: Variant, framing: Framing = 'full'): string =>
  `${date}:${pose}:${variant}${framing === 'upper' ? ':upper' : ''}`;
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

/** Auto capture (owner 2026-10-30): the next pose comes up by itself after one of these, in seconds; 4 unless he picks another. */
export const AUTO_DELAYS = [2, 4, 6] as const;
export type AutoDelay = (typeof AUTO_DELAYS)[number];
export const AUTO_DEFAULT: AutoDelay = 4;

/**
 * Where each shot's scrubber starts in a recording. `marks[i]`: the second the i-th shot came up (Next pose, or Auto's timer);
 * `end`: when recording stopped. Manual: the middle of its time on screen, as he walks to the phone to tap Next, so both ends
 * are walking. Auto (`settled`): near the end, when he has settled into the pose (a fifth of the span before it, 0.4 s at
 * most). Shots that never came up (the recording stopped first) get none.
 */
export const seeds = (marks: readonly number[], end: number, settled = false): number[] =>
  marks.map((at, i) => {
    const to = Math.max(at, Math.min(end, marks[i + 1] ?? end));
    return Math.min(end, settled ? to - Math.min(0.4, (to - at) * 0.2) : (at + to) / 2);
  });

/**
 * A shot's latest photo in `framing`: laid over the camera at 30 % (the ghost), so each session is framed like the last. None:
 * the outline.
 */
export function lastOf(metas: readonly PhotoMeta[], s: Shot, framing: Framing): PhotoMeta | null {
  let best: PhotoMeta | null = null;
  for (const m of metas) if (m.pose === s.pose && m.variant === s.variant && framingOf(m) === framing && (!best || m.date > best.date)) best = m;
  return best;
}

/** Mean brightness of RGBA pixels, 0–255 (Rec. 601 luma). */
export function meanLuma(px: ArrayLike<number>): number {
  let sum = 0;
  const n = Math.floor(px.length / 4);
  for (let i = 0; i < n * 4; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return n ? sum / n : 0;
}
/** The same-light check's margin: the camera this much darker or brighter than the ghost's photo is said. */
export const LIGHT_DIFF = 0.25;
/** The camera's brightness against last time's photo of the same shot: 'darker', 'brighter', or null within LIGHT_DIFF. */
export function lightVs(now: number, then: number): 'darker' | 'brighter' | null {
  if (!(then > 4)) return null; // a black photo is no measure
  return now < then * (1 - LIGHT_DIFF) ? 'darker' : now > then * (1 + LIGHT_DIFF) ? 'brighter' : null;
}

export function timeline(metas: PhotoMeta[]): { date: string; photos: PhotoMeta[] }[] {
  const by = new Map<string, PhotoMeta[]>();
  for (const x of metas) by.set(x.date, [...(by.get(x.date) ?? []), x]);
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, photos]) => ({ date, photos: photos.sort((a, b) => shotIndex(a) - shotIndex(b)) }));
}

export function comparePair(metas: PhotoMeta[], pose: Pose, variant: Variant, framing: Framing): [string, string] | null {
  const dates = shotDates(metas, { pose, variant }, framing);
  return dates.length >= 2 ? [dates[0], dates.at(-1)!] : null;
}
/** The framings there are photos in, full first: Photos offers Full body or Upper body only where there are both. */
export const framingsIn = (metas: readonly PhotoMeta[]): Framing[] => FRAMINGS.filter((f) => metas.some((m) => framingOf(m) === f));

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

/** The dates with a photo of shot `s` in `framing` from `from` to `to`, oldest first: the progress video's frames, one each. */
export function shotDates(metas: readonly PhotoMeta[], s: Shot, framing: Framing, from = '', to = '9999-12-31'): string[] {
  return [...new Set(metas.filter((m) => m.pose === s.pose && m.variant === s.variant && framingOf(m) === framing && m.date >= from && m.date <= to)
    .map((m) => m.date))].sort();
}

/** The progress video (plan S5): a timelapse of one shot's stills, each date held this long, built on the phone and never stored. */
export const FRAME_SECONDS = 0.6;
/** What the phone records the video as: MP4 first (all iOS Safari makes), else WebM; null: no recorder, so the flipbook instead. */
export function videoType(supported: (type: string) => boolean): string | null {
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => { try { return supported(t); } catch { return false; } }) ?? null;
}

/**
 * Save as image's crop line, as a share of the photo's height: just under the chin of the capture outline (head 8–19 %, so y 20
 * of its 100), and the same line in upper body's square.
 */
export const CHIN: Record<Framing, number> = { full: 0.2, upper: (20 - UPPER_BOX[1]) / UPPER_BOX[3] };

/** Under a before and after: how far apart they are and the PRs set between, as "12 weeks apart · 3 PRs between". */
export function apartLine(from: string, to: string, prs: number): string {
  const d = Math.round(days(from, to));
  const span = d < 14 ? `${d} ${d === 1 ? 'day' : 'days'}` : `${Math.round(d / 7)} weeks`;
  return `${span} apart · ${prs === 0 ? 'no' : prs} PR${prs === 1 ? '' : 's'} between`;
}

/** The photo-day line on Today (plan S6): every this many days since the last photo, two weeks unless he picks another; 0 is off. */
export const PHOTO_EVERY = [7, 14, 28, 0] as const;
export type PhotoEvery = (typeof PHOTO_EVERY)[number];
export const PHOTO_EVERY_DEFAULT: PhotoEvery = 14;
/** Not now puts the line away this long. */
export const PHOTO_SNOOZE = 7;
/**
 * Days since the last photo when the photo-day line is due: `every` days or more, not put off past today, and only once there's
 * a photo at all (no photos is no habit to keep). Null: no line.
 */
export function photoDayDue(metas: readonly PhotoMeta[], today: string, every: number, snoozedTo?: string): number | null {
  if (!every || !metas.length || (snoozedTo ?? '') > today) return null;
  const last = metas.reduce((d, m) => (m.date > d ? m.date : d), '');
  const n = Math.round(days(last, today));
  return last < today && n >= every ? n : null;
}
