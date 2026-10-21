import { session, type Set0 } from '../seed';

// IA A1 (owner, 2026-10-21): an ordinary training week for Today's order. Synthetic lifts and numbers only.

/** A Wednesday at 17:00: last week's digest is on Today all week, and Monday's session is the one before today's. */
export const WED = new Date('2026-10-21T17:00:00');

const DAYS: [string, number, number][][] = [
  [['Bench Press', 135, 8], ['Lat Pulldown', 110, 10], ['Seated Cable Row', 120, 10], ['Cable Curl', 40, 12]],
  [['Leg Press', 270, 10], ['Romanian Deadlift', 155, 8], ['Seated Leg Curl', 90, 12]],
  [['Overhead Press', 85, 8], ['Pull-up', 0, 8], ['Lateral Raise', 20, 12], ['Triceps Pushdown', 50, 12]],
];

/** Six weeks of Mon/Wed/Fri A/B/C before `today`, three sets a lift, a little heavier each fortnight. */
export function sixWeeks(today = WED): Set0[] {
  const out: Set0[] = [];
  let k = 0;
  for (let d = 42; d >= 1; d--) {
    const day = new Date(today.getTime() - d * 864e5);
    if (![1, 3, 5].includes(day.getDay())) continue;
    day.setHours(17, 30, 0, 0);
    const up = 5 * Math.floor((42 - d) / 14);
    out.push(...session(day, DAYS[k++ % 3].map(([n, w, r]) => [n, [[w + up, r], [w + up, r], [w + up, r - 1]]] as [string, [number, number][]])));
  }
  return out;
}

const H = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,logged_at';
/** The same weeks as an import CSV (a weight of 0 is a bodyweight set). */
export const sixWeeksCsv = (today = WED) => [H, ...sixWeeks(today).map((s) =>
  `${s.date},${s.exercise},,${s.setNo},${s.weight},${s.reps},,${s.weight === 0 ? 'bodyweight' : ''},,sample,${s.loggedAt}`)].join('\n');
