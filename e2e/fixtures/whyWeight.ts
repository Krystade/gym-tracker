// "Why this weight" (the target's "?"): one lift per kind of target, as an import CSV. Synthetic lifts and numbers only.
// Each lift's lines are what its branch of the decision path reads (src/domain/whyWeight.test.ts checks the path itself).

const H = 'date,exercise,set,weight_lb,reps,rir,flags,source,pain_region,pain_severity,target_weight_lb,target_reps,target_sets';
const add = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** The lifts, and the lines each one's sheet shows, in order (data-input on each line). */
export const WHY = {
  normal: { lift: 'Bench Press', lines: ['last', 'progress', 'goal', 'sets'] },
  stall: { lift: 'Overhead Press', lines: ['last', 'progress', 'goal', 'hits', 'sets'] },
  jump: { lift: 'Cable Curl', lines: ['last', 'progress', 'range', 'step', 'drop', 'sets'] },
  hold: { lift: 'Leg Extension', lines: ['last', 'pain', 'sets'] },
  fresh: { lift: 'Hack Squat', lines: ['new', 'range', 'sets'] },
} as const;

/** Every lift's sessions before `today` (YYYY-MM-DD). */
export function whyCsv(today: string): string {
  const rows = [H];
  const sess = (d: number, lift: string, w: number, reps: number[], o: { aim?: number; pain?: [string, number] } = {}) =>
    reps.forEach((r, i) => rows.push([add(today, -d), lift, i + 1, w, r, '', o.pain && i === reps.length - 1 ? 'pain' : '', 'sample',
      o.pain && i === reps.length - 1 ? o.pain[0] : '', o.pain && i === reps.length - 1 ? o.pain[1] : '', o.aim ? w : '', o.aim ?? '', o.aim ? reps.length : ''].join(',')));
  // Targets hit last time: a rep a set.
  sess(12, WHY.normal.lift, 135, [9, 9, 8]);
  sess(5, WHY.normal.lift, 135, [10, 10, 9], { aim: 9 });
  // Missed three times running: repeat.
  for (const d of [15, 10, 5]) sess(d, WHY.stall.lift, 95, [10, 9, 8], { aim: 10 });
  // Cable lifts whose 2.5 lb jumps cost about 2 reps (learned), and a curl that topped its range last time.
  const cable = (lift: string, from: number, start: number) => {
    for (let i = 0; i < 6; i++) {
      sess(start - 8 * i, lift, from + 2.5 * i, [15, 15, 14]);
      sess(start - 8 * i - 4, lift, from + 2.5 * (i + 1), [13, 13, 12]);
    }
  };
  cable(WHY.jump.lift, 30, 100);
  cable('Face Pull', 20, 99);
  cable('Cable Pushdown', 50, 98);
  sess(6, WHY.jump.lift, 47.5, [15, 15, 14]);
  // Moderate knee pain last time: held.
  sess(9, WHY.hold.lift, 100, [12, 11, 10]);
  sess(4, WHY.hold.lift, 105, [12, 12, 11], { pain: ['knee', 2] });
  return rows.join('\n');
}
