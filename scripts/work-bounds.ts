// Which start-to-save times (SetEntry.workS) count as a set (domain/timing workBounds), checked on synthetic sets: the log has no
// work_s column yet, so the sets and the mistakes are drawn from plausible ranges, seeded, and every policy sees the same draws.
//
//   npx jiti scripts/work-bounds.ts
//
// A set: an overhead (unrack, set up, tap Save) of 4–12 s plus its reps at 2–4 s each (Schoenfeld, Ogborn & Krieger 2015:
// 0.5–8 s a rep in the trials; a heavy single 3–6 s), ±12 % from set to set, its reps ±1.5 around the lift's usual. The mistakes:
// Start tapped late, mid-set (1 s to half the set); Start tapped early, in the rest (+20 s to 4 min); the card left open (+5 min
// to an hour). Scored per lift against the median of its true set times, which is what setWork wants: the error of the kept
// median, the good sets dropped, the mistakes kept, and how often a lift with WORK_MIN or more sets falls under it (so its set
// time goes back to 4 s a rep). "fixed" is the old filter alone (WORK_LO–WORK_HI); "shipped" is setWorks as the app runs it.
import type { SetEntry } from '../src/domain/types';
import { setWorks, WORK_HI, WORK_LO, WORK_MIN, workBounds } from '../src/domain/timing';

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261123);
const U = (lo: number, hi: number) => lo + (hi - lo) * R();
const N = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };

interface Sample { t: number; good: boolean }
/** One lift's n sets, with the mistakes at rate `bad` (split late 0.35 / early 0.4 / left open 0.25). */
function lift(n: number, bad: number): { xs: Sample[]; truth: number } {
  const reps = [1, 3, 5, 8, 10, 12, 15, 20][Math.floor(R() * 8)];
  const perRep = reps <= 3 ? U(3, 6) : U(2, 4), over = U(4, 12);
  const xs: Sample[] = [], clean: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.max(1, reps + Math.round(1.5 * N()));
    const t = (over + r * perRep) * Math.exp(0.12 * N());
    clean.push(t);
    const u = R();
    if (u >= bad) { xs.push({ t, good: true }); continue; }
    const k = u / bad;
    xs.push({ t: k < 0.35 ? U(1, Math.max(1.5, t / 2)) : k < 0.75 ? t + U(20, 240) : t + U(300, 3600), good: false });
  }
  return { xs: xs.map((s) => ({ ...s, t: Math.max(1, Math.round(s.t)) })), truth: median(clean) };
}

/** A policy: which times it keeps (for the counts), and the median and n setWork would use. */
type Policy = (ts: number[]) => { keep: (t: number) => boolean; median: number | null; n: number };
const inRange = (t: number) => t >= WORK_LO && t <= WORK_HI;
const policies: [string, Policy][] = [
  [`fixed ${WORK_LO}–${WORK_HI} (was)`, (ts) => { const k = ts.filter(inRange); return { keep: inRange, median: k.length ? median(k) : null, n: k.length }; }],
  ['shipped setWorks', (ts) => {
    const w = setWorks(ts.map((workS, i) => ({ id: `s${i}`, exercise: 'Cable Curl', workS, flags: [] }) as unknown as SetEntry)).get('cable curl');
    const b = workBounds(ts); // what its median is taken over
    return { keep: (t) => t >= b.lo && t <= b.hi, median: w?.median ?? null, n: w?.n ?? 0 };
  }],
];

const NS = [5, 8, 12, 20, 40, 80], BADS = [0, 0.1, 0.25], LIFTS = 400;
{
  const all = Array.from({ length: 2000 }, () => lift(20, 0)).flatMap((l) => l.xs.map((s) => s.t)).sort((a, b) => a - b);
  console.log(`real sets (40,000): shortest ${all[0]} s, 0.1 % ${all[40]} s, median ${all[20000]} s, 99.9 % ${all[39960]} s, longest ${all.at(-1)} s; outside ${WORK_LO}–${WORK_HI}: ${all.filter((t) => !inRange(t)).length}`);
}
console.log(`${LIFTS} synthetic lifts per cell; error = |median used − true median| / true median`);
for (const bad of BADS) for (const n of NS) {
  const draws = Array.from({ length: LIFTS }, () => lift(n, bad));
  const cells = policies.map(([name, p]) => {
    let err = 0, worst: number[] = [], goodDrop = 0, good = 0, badKeep = 0, bads = 0, under = 0;
    for (const { xs, truth } of draws) {
      const r = p(xs.map((s) => s.t));
      for (const s of xs) { if (s.good) { good++; if (!r.keep(s.t)) goodDrop++; } else { bads++; if (r.keep(s.t)) badKeep++; } }
      if (n >= WORK_MIN && r.n < WORK_MIN) under++;
      const e = r.median != null ? Math.abs(r.median - truth) / truth : 1;
      err += e; worst.push(e);
    }
    worst = worst.sort((a, b) => a - b);
    const pc = (x: number) => `${(100 * x).toFixed(1)}%`;
    return `${name}: err ${pc(err / LIFTS)} (p90 ${pc(worst[Math.floor(0.9 * LIFTS)])}), good dropped ${pc(goodDrop / Math.max(1, good))}, mistakes kept ${bads ? pc(badKeep / bads) : '–'}, under WORK_MIN ${under}`;
  });
  console.log(`mistakes ${bad * 100}%, n ${n}\n  ${cells.join('\n  ')}`);
}
