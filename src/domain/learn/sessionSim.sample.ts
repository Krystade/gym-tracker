import { liftKey } from '../ids';
import { isIsolation, SET_WORK, type Step } from '../timing';
import type { SetEntry } from '../types';
import { rng } from './num';

// Synthetic timed sessions with a KNOWN pace, for item 11's tests (learn/session). Synthetic only; no personal data.
//
// Every gap (one set's done-time to the next set's) is drawn as
//   ln g = base + compound·[the set before is a compound lift] + switch·[the next set is another lift]
//          + warm·[the set before was a warm-up] + pos·(the gap's place in the session) + l_L + u_d + ε
// with l_L ~ N(0, liftSd²) per lift (drawn once), u_d ~ N(0, daySd²) per day, ε ~ N(0, sd²): the model learn/session fits, so
// its expected sum is known exactly. Breaks (a 20–40 min wait added to a gap) and late entries (a set given a guessed time
// and an `enteredAt`) are put in on request, to check they are left out.

export const SESSION_LIFTS = ['Bench Press', 'Squat', 'Lat Pulldown', 'Seated Cable Row', 'Cable Curl', 'Cable Pushdown', 'DB Lateral Raise', 'Leg Extension'] as const;

export interface PaceTruth {
  base: number; compound: number; switch: number; warm: number; pos: number;
  liftSd: number; daySd: number; sd: number;
}
export const PACE_TRUTH: PaceTruth = { base: Math.log(200), compound: 0.4, switch: 0.2, warm: -0.7, pos: 0.02, liftSd: 0.15, daySd: 0.2, sd: 0.35 };

export interface PaceSimOptions {
  sessions: number; truth?: Partial<PaceTruth>;
  /** Days between sessions (default 2–3, alternating). */
  every?: number;
  /** Day of the first session, from 2025-01-06. */
  start?: number;
  /** Share of gaps with a break added. */
  breaks?: number;
  /** Share of sets entered late, with a guessed time (`enteredAt`). */
  late?: number;
  /** Lifts a session does (default 4) and sets of each (default 3); warm-ups before the first compound (default 1). */
  lifts?: number; sets?: number; warmups?: number;
}
export interface PaceSim { entries: SetEntry[]; truth: PaceTruth; lift: Map<string, number>; days: string[] }

const dateOf = (n: number) => new Date(Date.UTC(2025, 0, 6) + n * 864e5).toISOString().slice(0, 10);

/** The log, the truth, each lift's own l_L (by liftKey), and the session dates. */
export function paceLog(seed: number, o: PaceSimOptions): PaceSim {
  const r = rng(seed);
  const truth = { ...PACE_TRUTH, ...o.truth };
  const lift = new Map<string, number>(SESSION_LIFTS.map((n) => [liftKey(n), r.normal(0, truth.liftSd)]));
  const entries: SetEntry[] = [];
  const days: string[] = [];
  let d = o.start ?? 0, seq = 0;
  for (let s = 0; s < o.sessions; s++) {
    d += s === 0 ? 0 : o.every ?? (s % 2 ? 2 : 3);
    const date = dateOf(d);
    days.push(date);
    const steps = sessionSteps(r.shuffle([...SESSION_LIFTS]).slice(0, o.lifts ?? 4), o.sets ?? 3, o.warmups ?? 1);
    const u = r.normal(0, truth.daySd);
    let t = Date.UTC(2025, 0, 6) + d * 864e5 + 17 * 36e5;
    steps.forEach((st, i) => {
      if (i) {
        const a = steps[i - 1];
        let g = Math.exp(meanLn(truth, lift, a, st, i - 1) + u + r.normal(0, truth.sd));
        if (o.breaks && r.next() < o.breaks) g += r.uniform(1200, 2400);
        t += g * 1000;
      }
      const late = o.late != null && r.next() < o.late;
      entries.push({
        id: `ps${seed}-${seq}`, date, seq: seq++, exercise: st.exercise, setNo: i + 1, weight: 100, reps: 10,
        flags: st.warmup ? ['warmup'] : [], source: 'sample',
        loggedAt: new Date(late ? t + r.uniform(-300, 300) * 1000 : t).toISOString(),
        ...(late && { enteredAt: new Date(t + 3600e3).toISOString() }),
      });
    });
  }
  return { entries, truth, lift, days };
}

/** A session's steps: each lift's sets in turn, `warmups` warm-ups before the first compound lift's. */
export function sessionSteps(lifts: readonly string[], sets: number, warmups: number): Step[] {
  const first = lifts.find((n) => !isIsolation(n));
  return lifts.flatMap((n) => [...Array.from({ length: n === first ? warmups : 0 }, () => ({ exercise: n, warmup: true })), ...Array.from({ length: sets }, () => ({ exercise: n }))]);
}

/** The gap's mean ln seconds before the day effect and noise. */
function meanLn(t: PaceTruth, lift: Map<string, number>, a: Step, b: Step, pos: number): number {
  return t.base + (isIsolation(a.exercise) ? 0 : t.compound) + (liftKey(a.exercise) !== liftKey(b.exercise) ? t.switch : 0)
    + (a.warmup ? t.warm : 0) + t.pos * pos + (lift.get(liftKey(a.exercise)) ?? 0);
}

/** One gap's true expected seconds, from `a` to `b` at place `pos`, averaged over a new day's effect and the noise. */
export const trueGap = (sim: PaceSim, a: Step, b: Step, pos: number): number =>
  Math.exp(meanLn(sim.truth, sim.lift, a, b, pos) + (sim.truth.daySd ** 2 + sim.truth.sd ** 2) / 2);

/** The true expected seconds of a session of `steps` (first set's work + every gap). */
export function trueSeconds(sim: PaceSim, steps: readonly Step[]): number {
  let s = SET_WORK;
  for (let i = 1; i < steps.length; i++) s += trueGap(sim, steps[i - 1], steps[i], i - 1);
  return s;
}
