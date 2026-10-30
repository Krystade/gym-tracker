import type { Pose, Variant } from '../domain/photos';

// The outline shown over the camera for each shot (domain/photos SHOTS), in the 3:4 frame the still is cut to: viewBox
// 0 0 75 100, head at 8 %, feet at 96 %, so standing where it fits is the same framing every time. Drawn by hand as points
// along one side and smoothed (Catmull-Rom); front and back share a silhouette, mirrored about the middle.

type Pt = readonly [number, number];
const MID = 37.5;
const f = (n: number) => Math.round(n * 10) / 10;

/** A smooth path through the points (Catmull-Rom as cubic Béziers); `closed` joins the last back to the first. */
function smooth(pts: readonly Pt[], closed: boolean): string {
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}
const head = (cx: number, cy = 13.5, rx = 4.3, ry = 5.6) => `M${f(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${f(2 * rx)} 0a${rx} ${ry} 0 1 0 ${f(-2 * rx)} 0Z`;
/** One side, neck to crotch, and its mirror back up: an open line, so nothing is drawn across under the chin. */
const both = (side: readonly Pt[]) => smooth([...side, ...[...side].reverse().slice(1).map(([x, y]): Pt => [2 * MID - x, y])], false);

// Below the waist, front and back alike: hip, outside of the leg, foot, inside of the leg to the crotch.
const LEG: Pt[] = [[44.6, 48], [44.8, 55], [43.6, 63], [42.3, 70], [42.7, 76.5], [41.5, 84.5], [40.5, 91.5], [41.9, 95], [40.9, 96], [38.6, 96], [38.6, 92], [38.7, 84.5],
  [39, 77], [38.9, 71], [38.5, 62], [MID, 53]];
const RELAXED: Pt[] = [[39.6, 18.9], [39.8, 21.4], [44.6, 23.2], [48.8, 24.6], [50.3, 27.6], [50.9, 32.5], [51.5, 38], [51.7, 42], [51.9, 46.5], [52, 50.5], [52.4, 54],
  [51.2, 56.6], [49.8, 54.6], [49.5, 50.5], [49.1, 45.5], [48.6, 41], [48, 34.5], [46.8, 29.6], [45.2, 33], [43.4, 41], ...LEG];
// Double biceps: the upper arm out level with the shoulder, the forearm straight up, the fist about level with the head.
const FLEXED: Pt[] = [[39.6, 18.9], [39.8, 21.2], [44, 22.5], [48, 23.3], [52, 21.9], [54.8, 19.8], [56.6, 19.4], [56.6, 15], [56.9, 11.2], [56.4, 8.6], [58.5, 6.5],
  [61.2, 7], [62.2, 9.6], [61.4, 12.2], [62.3, 16], [62.8, 20.2], [62.2, 24.2], [58, 26.3], [53.5, 27.1], [49.6, 28.7], [46.9, 30.6], [46.6, 33.6], [43.6, 41.5], ...LEG];

// Side on, facing right: the body from the nape round the back, the feet and up the front; the near arm drawn over it.
const SIDE_BODY = (chest: number): Pt[] => [[35.8, 18.6], [33.7, 23.8], [32.9, 30], [33.4, 37], [34.4, 43], [32.8, 50], [33.4, 54.6], [34.4, 62], [35.4, 70], [35.1, 76],
  [36.3, 84], [37.1, 91.5], [36.4, 95.3], [37.8, 96], [45, 96], [44.6, 94.5], [40.7, 91.3], [40.5, 84], [40.9, 76], [41.7, 70], [43.5, 61], [43.3, 53], [42.7, 48],
  [43.1, 42], [42.6, 36.4], [chest, 30.6], [chest - 0.6, 26.2], [40.6, 22.6], [40.4, 19.2]];
const SIDE_ARM: Pt[] = [[37, 24], [41.2, 26.2], [40.9, 33], [40.6, 40], [41.4, 47], [41.4, 51.6], [41.8, 56], [40.6, 57.4], [39.2, 55.6], [39.2, 51.4], [38.4, 46], [37.6, 40.4],
  [36.6, 33], [36, 27]];
// Side chest: the near arm bent, the forearm across the front, the fist out in front of the belly.
const SIDE_CHEST_ARM: Pt[] = [[37.4, 23.8], [41.8, 25.8], [41.2, 31], [40.6, 34.4], [43.6, 33.7], [46, 33.6], [48.2, 33.1], [49.5, 35.6], [48.1, 38.6], [44, 39.4],
  [40.4, 40.4], [37.2, 40.9], [35.6, 38.6], [35.3, 32], [36, 26.4]];

const front = { relaxed: [head(MID), both(RELAXED)], flexed: [head(MID), both(FLEXED)] };
export const OUTLINES: Record<Pose, Record<Variant, string[]>> = {
  front,
  side: {
    relaxed: [head(38.8, 13.5, 4.2), smooth(SIDE_BODY(44.2), true), smooth(SIDE_ARM, true)],
    flexed: [head(38.8, 13.5, 4.2), smooth(SIDE_BODY(45.4), true), smooth(SIDE_CHEST_ARM, true)],
  },
  back: front,
};

/** What to do for each shot, under its name while recording. */
export const HINTS: Record<Pose, Record<Variant, string>> = {
  front: { relaxed: 'Face the camera, arms loose at your sides', flexed: 'Face the camera, double biceps' },
  side: { relaxed: 'Side on, arms loose', flexed: 'Side on, side chest' },
  back: { relaxed: 'Back to the camera, arms loose', flexed: 'Back to the camera, double biceps' },
};
