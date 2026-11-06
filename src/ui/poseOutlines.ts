import { UPPER_BOX, type Framing, type Pose, type Variant } from '../domain/photos';

// The outline shown over the camera for each shot (domain/photos SHOTS), in the 3:4 frame the still is cut to: viewBox
// 0 0 75 100, head at 8 %, feet at 96 %, so standing where it fits is the same framing every time. Drawn by hand as points
// along one side and smoothed (Catmull-Rom); front and back share a silhouette, mirrored about the middle. Upper body is the
// same paths seen through its head-to-hips square (domain/photos UPPER_BOX), so he stands closer to fill it.

/** Each framing's window onto the outlines. */
export const VIEWBOX: Record<Framing, string> = { full: '0 0 75 100', upper: UPPER_BOX.join(' ') };

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

// Side on, facing right: the body from the nape round the back (shoulder blade, the small of the back, the glutes, hamstring, calf),
// the feet, and up the front (shin, knee, quad, hip, belly, chest, throat); the near arm drawn over it.
const SIDE_BODY = (chest: number): Pt[] => [[36, 18.8], [33.6, 22.8], [32.3, 28], [32.7, 34], [34.1, 40.5], [33.5, 46.5], [31.7, 51.5], [31.8, 56], [33.3, 59.5],
  [33.7, 64.5], [34.5, 70], [33.8, 76], [34.6, 82.5], [36, 90], [35.5, 94.5], [36.2, 96], [45.6, 96], [45.2, 94.6], [40.6, 92.2], [39.9, 86], [40.3, 79.5],
  [41.4, 72], [42.7, 64], [43, 56.5], [41.8, 50.5], [42.7, 45.5], [42.9, 40], [chest - 1.2, 35.8], [chest, 31], [chest - 1, 26.4], [40.8, 22.8], [40.2, 19.4]];
const SIDE_ARM: Pt[] = [[35.8, 23.6], [40.6, 24.4], [41.6, 28.6], [41, 34.6], [40.6, 41], [41.6, 46.8], [41.6, 52], [42.2, 56.4], [40.7, 58.2], [39, 56.2],
  [38.6, 51.6], [37.6, 46.2], [36.6, 41], [35.5, 35], [35.1, 29], [35.4, 25.4]];
// Side chest: the near upper arm down the side, the elbow bent square, the forearm straight out in front and the fist at the front.
const SIDE_CHEST_ARM: Pt[] = [[36.2, 23.4], [41.6, 24.2], [43.2, 28], [42.8, 32.6], [44.8, 34.4], [48.4, 34.2], [51.2, 33.8], [53.4, 35.2], [53.4, 38.6],
  [51.2, 40.2], [47.6, 40.4], [43.6, 41.2], [38.8, 42.4], [35.4, 40.8], [34.6, 35], [34.7, 29], [35.3, 25.4]];
// The back: the same silhouette as the front, plus the spine and the shoulder blades so it reads as a back.
const SPINE = smooth([[MID, 21], [MID, 30], [MID + 0.2, 38], [MID, 46]], false);
const blade = (s: number) => smooth([[MID + s * 2.6, 25.4], [MID + s * 6.6, 25.8], [MID + s * 7.2, 30], [MID + s * 3.6, 34.6]], false);

const front = { relaxed: [head(MID), both(RELAXED)], flexed: [head(MID), both(FLEXED)] };
export const OUTLINES: Record<Pose, Record<Variant, string[]>> = {
  front,
  side: {
    relaxed: [head(38.8, 13.5, 4.2), smooth(SIDE_BODY(43.9), true), smooth(SIDE_ARM, true)],
    flexed: [head(38.8, 13.5, 4.2), smooth(SIDE_BODY(46.4), true), smooth(SIDE_CHEST_ARM, true)],
  },
  back: { relaxed: [...front.relaxed, SPINE, blade(1), blade(-1)], flexed: [...front.flexed, SPINE, blade(1), blade(-1)] },
};

/** What to do for each shot, under its name while recording. */
export const HINTS: Record<Pose, Record<Variant, string>> = {
  front: { relaxed: 'Face the camera, arms loose at your sides', flexed: 'Face the camera, double biceps' },
  side: { relaxed: 'Side on, arms loose', flexed: 'Side on, side chest' },
  back: { relaxed: 'Back to the camera, arms loose', flexed: 'Back to the camera, double biceps' },
};
