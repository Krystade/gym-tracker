// A made-up notes log brought in twice: once through Paste from notes ('notes'), once as a CSV a converter made from the same
// text ('log-csv'). Synthetic lifts and numbers only. 11 sets in both, 3 of them differing (a warm-up flag only the paste read,
// and a lift the two named differently), repeated identical sets that must all stay, and one day only the paste has.

export const PASTE = 'notes', CONVERTED = 'log-csv';
export const TWINS = 11, IDENTICAL = 8, DIFFERING = 3, PASTE_ONLY = 1;

type Row = { date: string; exercise: string; set: number; weight: number; reps: number; flags: string[]; source: string };
const day = (source: string, date: string, lifts: [string, [number, number, string[]?][]][]): Row[] =>
  lifts.flatMap(([exercise, sets]) => sets.map(([weight, reps, flags = []], i) => ({ date, exercise, set: i + 1, weight, reps, flags, source })));

const D1 = '2026-04-03', D2 = '2026-04-05', D3 = '2026-04-07';
const lifts = (legRaise: string, warmup: string[]): [string, [number, number, string[]?][]][] => [
  ['Incline Bench Press', [[0, 15, warmup]]],
  ['Lat Pulldown', [[100, 12], [100, 12], [100, 10]]],
  ['Skullcrusher', [[50, 12], [50, 12], [50, 12]]],
  [legRaise, [[0, 15, ['bodyweight']], [0, 15, ['bodyweight']]]],
];
const curls: [string, [number, number, string[]?][]][] = [['Cable Curl', [[50, 10], [55, 8]]]];

export const pasteRows: Row[] = [
  ...day(PASTE, D1, lifts('Hanging Leg Raise', ['bodyweight', 'warmup'])), ...day(PASTE, D2, curls), ...day(PASTE, D3, [['Cable Curl', [[60, 8]]]]),
];
export const convertedRows: Row[] = [...day(CONVERTED, D1, lifts('Leg Raise', ['bodyweight'])), ...day(CONVERTED, D2, curls)];

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
export const toCsv = (rows: Row[]) => [HEADER, ...rows.map((r) => [r.date, r.exercise, '', r.set, r.weight, r.reps, '', r.flags.join(';'), '', r.source].join(','))].join('\n');

/** Each row as the app stores it, for a month document (ids as setId makes them; seq is the import's order). */
export const asSets = (rows: Row[]) => rows.map((r, i) => ({
  id: `${r.source}|${r.date}|${r.exercise.toLowerCase()}|${r.set}`, date: r.date, seq: i, exercise: r.exercise, setNo: r.set,
  weight: r.weight, reps: r.reps, flags: r.flags, source: r.source,
}));
export const MONTH = '2026-04';
