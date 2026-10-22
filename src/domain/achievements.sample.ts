// A synthetic lifter for pacing the tiers (achievements.test, the perf budget): 2 years, a 3-day A/B/C full-body split, ~85% attendance, a 2-week holiday, a
// 3-week layoff, a light week every 7th week, double progression 8-12 reps, pull-ups from 2 reps, cardio some Fridays,
// pain on ~2% of sets. Deterministic (seeded).
import { addDays } from './analytics';
import type { SetEntry, Flag } from './types';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

const DAYS: { name: string; lifts: [string, number, number][] }[] = [ // [lift, start weight, step]
  { name: 'A', lifts: [['Barbell Squat', 95, 10], ['Bench Press', 75, 5], ['Barbell Row', 65, 5], ['Cable Curl', 30, 5], ['Cable Crunch', 40, 5]] },
  { name: 'B', lifts: [['Deadlift', 115, 10], ['Overhead Press', 45, 5], ['Lat Pulldown', 70, 5], ['Cable Pushdown', 30, 5], ['DB Lateral Raise', 10, 2.5]] },
  { name: 'C', lifts: [['Leg Press', 140, 10], ['Bench Press', 75, 5], ['Pull-up', 0, 0], ['Seated Leg Curl', 50, 5], ['Standing Calf Raise', 60, 10]] },
];

export function synthLog(start = '2024-10-21', weeks = 104, seed = 7, perWeek = 3): SetEntry[] {
  const r = rng(seed), out: SetEntry[] = [];
  const state = new Map<string, { w: number; reps: number }>();
  let pullReps = 2, dayIdx = 0, seq = 0;
  for (let wk = 0; wk < weeks; wk++) {
    const holiday = wk >= 30 && wk < 32, layoff = wk >= 64 && wk < 67;
    if (holiday || layoff) continue;
    const light = wk % 7 === 6;
    for (const off of [0, 2, 4].slice(0, perWeek)) {
      if (r() < 0.15) continue;
      const date = addDays(start, wk * 7 + off), day = DAYS[dayIdx++ % 3];
      for (const [lift, w0, step] of day.lifts) {
        const st = state.get(lift) ?? { w: w0, reps: 8 };
        const sets = light ? 2 : 3;
        for (let n = 1; n <= sets; n++) {
          const flags: Flag[] = [];
          if (light) flags.push('light');
          if (r() < 0.02) flags.push('pain');
          let weight = light ? Math.round(st.w * 0.9 / 5) * 5 : st.w, reps = Math.max(5, st.reps - (n - 1) + (r() < 0.3 ? 1 : 0));
          if (lift === 'Pull-up') { weight = 0; reps = Math.max(1, pullReps - (n - 1)); flags.push('bodyweight'); }
          out.push({ id: `syn|${date}|${lift}|${n}`, date, seq: ++seq, exercise: lift, setNo: n, weight, reps, flags, source: 'app', ...(flags.includes('pain') && { painRegion: 'elbow' as const, painSeverity: 1 as const }) });
        }
        // Double progression: +1 rep a session to 12, then a weight step back to 8. Slower with time.
        if (!light && lift !== 'Pull-up') {
          const slow = wk > 52 ? 0.45 : wk > 26 ? 0.65 : 0.9;
          if (r() < slow) { if (st.reps >= 12) { st.w += step; st.reps = 8; } else st.reps += 1; }
        }
        state.set(lift, st);
      }
      if (day.name === 'C' && !light && r() < 0.35) pullReps = Math.min(14, pullReps + 1);
      if (off === 4 && r() < 0.5) out.push({ id: `syn|${date}|treadmill`, date, seq: ++seq, exercise: 'Treadmill', setNo: 1, weight: 0, reps: null, flags: ['cardio'], cardio: { seconds: 600 + Math.floor(r() * 900) }, source: 'app' });
    }
    // After the layoff, strength drops back a little.
    if (wk === 63) for (const st of state.values()) st.w = Math.round(st.w * 0.9 / 5) * 5;
  }
  return out;
}
