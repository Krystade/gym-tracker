import type { SetEntry } from '../types';
import { rng } from './num';

// Synthetic pain histories with KNOWN recurrence parameters, for item 08's tests. Synthetic only; no personal data.
//
// A lifter trains every 3–4 days, one lift from each of three regions' pairs per session, in a shuffled order. A lift-session
// hurts with probability
//   P = base + j_own·Σ 2^(−Δd/h) over this lift's past pain sessions + j_region·Σ 2^(−Δd/h) over the region's other lifts'
//       (today's earlier ones included)
// capped at 0.9: pain makes more pain likely, on the same lift most, and less so with time (half-life h days). `own` and `region`
// are branching ratios, the further pain sessions one pain session brings on that lift (or the region's other) when it is done
// weekly: j = ratio·(1 − 2^(−7/h)), so a history stays bursty, not runaway, whatever h (own + region < 1).

/** Two lifts per region (care.likelyRegion reads each into it). */
export const PAIN_LIFTS = [
  { name: 'Cable Pushdown', region: 0 }, { name: 'Overhead DB Triceps Extension', region: 0 },
  { name: 'DB Lateral Raise', region: 1 }, { name: 'Machine Shoulder Press', region: 1 },
  { name: 'Leg Extension', region: 2 }, { name: 'Seated Leg Curl', region: 2 },
] as const;

export interface PainTruth { base: number; own: number; region: number; h: number }
/** The jump in P per past pain session for a branching ratio `b` at half-life `h`, a lift done weekly. */
const jump = (b: number, h: number) => b * (1 - 2 ** (-7 / h));
export interface PainSimOptions {
  sessions: number; truth: PainTruth;
  /** Severity logged on a pain set (none: an import's unknown). */
  severity?: 1 | 2 | 3;
  /** Only these lifts (default: all six). */
  lifts?: readonly number[];
}
export interface PainSim { entries: SetEntry[]; days: string[]; p: Map<string, number> }

const day = (n: number) => new Date(Date.UTC(2025, 0, 6) + n * 864e5).toISOString().slice(0, 10);

export function painLog(seed: number, o: PainSimOptions): PainSim {
  const r = rng(seed);
  const { base, own, region, h } = o.truth;
  const use = o.lifts ?? PAIN_LIFTS.map((_, i) => i);
  const pains: number[][] = PAIN_LIFTS.map(() => []); // days of each lift's pain sessions
  const entries: SetEntry[] = [];
  const days: string[] = [];
  const p = new Map<string, number>();
  let d = 0, seq = 0;
  for (let s = 0; s < o.sessions; s++) {
    d += s % 2 ? 4 : 3;
    const date = day(d);
    days.push(date);
    // One lift of each region's pair (of those in use), in a shuffled order.
    const today = r.shuffle([0, 1, 2].map((reg) => use.filter((i) => PAIN_LIFTS[i].region === reg)).filter((xs) => xs.length).map((xs) => r.pick(xs)));
    const start = Date.UTC(2025, 0, 6) + d * 864e5 + 17 * 36e5;
    today.forEach((li, k) => {
      const decay = (ds: number[]) => ds.reduce((a, t) => a + 2 ** (-(d - t) / h), 0);
      const regionOther = PAIN_LIFTS.reduce((a, x, j) => (j !== li && x.region === PAIN_LIFTS[li].region ? a + decay(pains[j]) : a), 0);
      const prob = Math.min(0.9, base + jump(own, h) * decay(pains[li]) + jump(region, h) * regionOther);
      const hurt = r.next() < prob;
      p.set(`${date}|${li}`, prob);
      for (let set = 0; set < 3; set++) {
        const pain = hurt && set === 2;
        entries.push({
          id: `pain|${seed}|${d}|${li}|${set}`, date, seq: seq++, exercise: PAIN_LIFTS[li].name, setNo: set + 1, weight: 50, reps: 10,
          flags: pain ? ['pain'] : [], ...(pain && o.severity && { painSeverity: o.severity }), source: 'sim',
          loggedAt: new Date(start + (k * 3 + set) * 180e3).toISOString(),
        });
      }
      if (hurt) pains[li].push(d);
    });
  }
  return { entries, days, p };
}
