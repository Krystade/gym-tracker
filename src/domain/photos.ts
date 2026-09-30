// Progress photos live only in this device's IndexedDB. Nothing here is ever exported or synced.

export const POSES = ['front', 'side', 'back'] as const;
export type Pose = (typeof POSES)[number];
export interface PhotoMeta { id: string; date: string; pose: Pose; width: number; height: number; addedAt: string }

/** One photo per pose per date: a retake replaces it. */
export const photoId = (date: string, pose: Pose): string => `${date}:${pose}`;

export function fitSize(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

export function timeline(metas: PhotoMeta[]): { date: string; photos: PhotoMeta[] }[] {
  const by = new Map<string, PhotoMeta[]>();
  for (const x of metas) by.set(x.date, [...(by.get(x.date) ?? []), x]);
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, photos]) => ({ date, photos: photos.sort((a, b) => POSES.indexOf(a.pose) - POSES.indexOf(b.pose)) }));
}

export function comparePair(metas: PhotoMeta[], pose: Pose): [string, string] | null {
  const dates = [...new Set(metas.filter((x) => x.pose === pose).map((x) => x.date))].sort();
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
