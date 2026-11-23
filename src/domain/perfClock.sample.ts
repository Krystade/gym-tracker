// Timing tests under load (tests only). The whole suite runs its ~145 files at once, a worker on every core, and there wall-clock
// timings come out 1.2 to 8 times what they are alone (2026-11-22, full runs on main: the pain fit 30–73 ms against its 25, the
// reminder's reuse 10–29 ms against 5, the gap fit 168–218 ms against 150, achievements 205 ms against 150), while alone each
// passes with room: the code was no slower, the machine was busier. So a run is timed between two runs of a fixed reference
// workload and read in idle milliseconds: its wall time over how much slower the reference ran beside it (the lesser of the two,
// so a GC pause in one isn't read as load) than it does on an idle desktop (REF_IDLE_MS), never under 1 (a faster machine keeps
// a budget as written; only a busy one is allowed for, by as much as it is busy right then). The reference is plain JS of the
// fits' kind (small objects made and sorted, a Map filled, float loops over a typed array) and none of the app's code, so code
// made slower can't slow the reference with it and pass. Budgets stay the idle desktop's.

const REF_N = 4000;
let sink = 0;
/** The reference workload; its wall time, ms. */
function reference(): number {
  const t = performance.now();
  let s = 12345;
  const xs: { k: number; v: number }[] = [];
  for (let i = 0; i < REF_N; i++) { s = (s * 16807) % 2147483647; xs.push({ k: s % 997, v: s / 2147483647 }); }
  xs.sort((a, b) => a.k - b.k || a.v - b.v);
  const m = new Map<number, number>();
  for (const x of xs) m.set(x.k, (m.get(x.k) ?? 0) + Math.log1p(x.v));
  const f = new Float64Array(REF_N);
  for (let r = 0; r < 8; r++) for (let i = 0; i < REF_N; i++) f[i] = 0.5 * f[i] + Math.exp(-xs[i].v * r) * (m.get(xs[i].k) ?? 0);
  sink += f[REF_N - 1] + m.size;
  return performance.now() - t;
}
/** The reference's median on an idle desktop (2026-11-22, alone: best 1.15 ms, 9 in 10 under 1.8), ms. */
export const REF_IDLE_MS = 1.3;
for (let k = 0; k < 20; k++) reference(); // JIT warm-up, so the first timings aren't read as load

export interface Started { r: number; at: number }
/** Before a run: the reference, then the clock. */
export const start = (): Started => { const r = reference(); return { r, at: performance.now() }; };
/** After it: the clock, then the reference; the run's time in idle ms (see the header). */
export function stop(t: Started): number {
  const ms = performance.now() - t.at;
  // How much slower than idle the machine ran beside it: the lesser of the two references over REF_IDLE_MS, at least 1.
  const slow = Math.max(1, Math.min(t.r, reference()) / REF_IDLE_MS);
  return ms / slow;
}
