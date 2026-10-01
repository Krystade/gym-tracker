import { test } from 'vitest';
import { parseNotes, parseNoteDate, nameKey, matchExercise, toEntries } from './domain/notes';
const T = '2026-10-01';
const fmt = (x: any) => `${x.weight}x${x.reps}${x.flags.length ? '[' + x.flags.join(',') + ']' : ''}${x.note ? ' n:' + x.note : ''}${x.rir != null ? ' rir' + x.rir : ''}${x.painRegion ? ' reg:' + x.painRegion : ''}`;
const show = (s: string, hold = false) => {
  const ls = parseNotes(s, T, () => hold);
  return ls.filter(l => l.kind !== 'blank').map(l => `${JSON.stringify(l.raw)} => ${l.kind} ${l.date} name=${JSON.stringify(l.name)} lead=${JSON.stringify(l.lead)} sets=${JSON.stringify(l.sets?.map(fmt))} ${l.reason ?? ''}`).join('\n');
};
const cases = [
  'Bench 135 x 8, 8, 7',
  'Bench 135x8,8,7',
  'Bench: 135 x 8/8/7',
  'Squat 3x10 @ 135',
  'Squat 3x5 225',
  'Squat 3 x 5 @ 225lbs',
  'Squat: 225 3x5',
  'Squat 225x5x3',
  'Squat 225x5x30',
  'Squat 225 x5 x 3 sets',
  'BENCH PRESS 135X8',
  'Bench press 135 × 8',
  'Bench press 135 ✕ 8',
  'Bench press 135 – 8',
  'Bench 135lb x 8',
  'Bench 135 lbs x 8',
  'Bench 135#x8',
  'Bench 60kg x 8',
  'Bench 135x8x',
  'Bench 135x8-10',
  'Bench 135 x 8–10',
  'Bench 135x8 135x8 135x7 (last one hard)',
  'Lat pulldown — 100x12',
  'Lat pulldown – 100x12',
  'Lat pulldown—100x12',
  'Lat pulldown -100x12',
  'Pull-ups: -30x8',
  'Pull ups -30x8',
  'Pull-ups BWx8',
  'Pull ups BW x 8',
  'Pull ups bw8',
  'Dips BW+25x8',
  'Dips +25x8',
  'Incline 30 degree DB press 50x10',
  '45 degree hyperextension BWx12',
  'Leg press 45: 180x10',
  '21s curl 30x7',
  'Single-arm row 2 sets 50x10',
  'Curl 25s x 10',
  'Curl 25sx10',
  'Curl 25.5x10',
  'Curl 25,5x10',
  'Curl .5x10',
  'Bench 135x8 ?',
  'Bench 135x8?',
  '  Bench   135x8  ',
  'Bench\t135x8\t135x7',
  ' Bench 135 x 8',
  'Bench 135x8 @2',
  'Bench 135x8 @ 8 RPE',
  'Bench 135x8 RPE 8',
  'Bench 135x8 2-3 RIR',
  'Bench 135x8 1 rir left',
  'Bench 135x8 elbow pain',
  'Bench 135x8 no pain',
  'Bench 135x8 shoulder felt fine, elbow hurt',
  'Bench (WU) 95x10, 135x8',
  'Bench 95x10 wu, 135x8',
  'Bench warm up 95x10 135x8',
  'Plank 45s 40s',
  'Plank 1:05',
  'Plank: 1:05, 0:50',
  '6:30am Bench 135x8',
  'Bench 135x8 at 6:30',
  'Rest 1:30 Bench 135x8',
  'Bench 135x8 rest 90s',
  'Run 2 miles 20:00',
  'Walked 3.1 mi',
  'Bench 135x8 x 3',
  '135x8',
  'Bench 135',
  'Bench',
  'Bench skip',
  'Bench: skipped',
  'Bench — ',
  'Bench: —',
  'Bench: n/a',
  '...',
  '-',
  '•',
  '• Bench 135x8',
  '- Bench 135x8',
  '* Bench 135x8',
  '1. Bench 135x8',
  '1) Bench 135x8',
  '☐ Bench 135x8',
  '✓ Bench 135x8',
  'Bench 135x8 and 135x7',
  'Bench 135x8; 135x7',
  'Bench 135x8 then 155x5',
  'Cable fly 2x15',
  'Cable fly 2.5x15',
  "Farmer's walk 50s x 40",
  'Farmer’s walk 50sx40s',
  'Bench 135x8x3?',
  'Bench 100x12x3 then 90x12',
  'Bench 135 x 8 x 3 sets of 8',
  'DB press 2x50x10',
  'Bench 135x8 felt easy 2x',
];
test('lines', () => { console.log(cases.map(c => show(c)).join('\n')); });
const holds = ['Plank 45s 40s', 'Plank 45 sec, 30 seconds', 'Plank 25x45s', 'Plank 1:05 1:10', 'Plank 3x45s', 'Plank 3x45', 'Plank 45s x 3', 'Plank 60', 'Plank 1 min', 'Plank 45"'];
test('holds', () => { console.log(holds.map(c => show(c, true)).join('\n')); });
const dateCases = ['10/1', '9/30', '10/2', '12/25', '1/5', 'Mon 9/29', 'Monday 9/29', '9/29 Monday', 'Monday, Sept 29', 'Sept 29', 'Sep. 29th', '29 Sept', 'September 29, 2025', '9/29/25', '9-29-25', '2026-09-29', '2/30', '2/29', '9/29:', '9/29 - Push day', '9/29 push day 2', '9/29 Week 3', '12-10-8', '8-10', '3/4', '9/29 Bench 135x8', 'Oct 1st', 'October', 'Mon', 'Monday', 'Today', 'Push day', 'Day 2', 'Week 3 Day 2', '10/1/2026 6:30pm', 'Wednesday Oct 1, 2026', '1st Oct', 'Wed 10/1 – legs', 'Sept 31', 'Mar 3 sets', 'May 5x5', 'Sat 9/27', 'Thurs 9/25', 'Tues. 9/23', '9.29', '9/29/2026'];
test('dates', () => { console.log(dateCases.map(c => `${JSON.stringify(c)} -> ${JSON.stringify(parseNoteDate(c, T))}`).join('\n')); });
test('multiline', () => {
  const t = '9/28\r\nBench 135x8\r\n12-10-8\r\nCurl 30x10\r\n\r\n9/29\r\nSquat\r\n225x5\r\n225x5\r\nMonday\r\n135x8\r\n8-10 reps\r\nCurl 30x10';
  console.log(show(t));
  console.log('--- no date');
  console.log(show('Upper day\nBench 135x8\nRow 100x10\n'));
  console.log('--- heading then unrelated'); console.log(show('9/28\nSquat\nnotes: felt tired\n225x5'));
  console.log('--- CR only'); console.log(show('9/28\rBench 135x8\rCurl 30x10'));
  console.log('--- LS'); console.log(show('9/28 Bench 135x8 Curl 30x10'));
  console.log('--- reps lines'); console.log(show('9/28\nBench 135\n8, 8, 7\nSquat 225 for 5 reps'));
  console.log('--- sets headers'); console.log(show('9/28\nBench\n3 sets of 8 at 135\n135 for 8'));
});
test('names', () => {
  const pairs = [['Overhead Dumbell Extensions', 'overhead DB extension'], ['Pull-ups', 'Pullups'], ['Pull Up', 'pull-ups'], ['Lat Pulldown', 'Lat pull-down'], ['Lat Pulldown', 'Lat pull down'], ['Bicep curls', 'Biceps curl'], ['Face pulls', 'Facepull'], ['RDL', 'Romanian deadlift'], ['Smith squat', 'Smith machine squat'], ['Press', 'Presses'], ['Abs', 'Ab'], ['Leg press', 'Leg presses'], ['Dips', 'Dip'], ['Seated row', 'Seated rows'], ['Calves raise', 'Calf raise'], ['Pec deck', 'Pec-deck'], ['Chest press', 'Chest presses'], ['Lunges', 'Lunge'], ['Crunches', 'Crunch'], ['Lying leg curls', 'Lying leg curl']];
  console.log(pairs.map(([a, b]) => `${a} -> ${nameKey(a)} | ${b} -> ${nameKey(b)} ${nameKey(a) === nameKey(b) ? 'SAME' : 'diff'}`).join('\n'));
  const known = ['Bench Press', 'Incline Bench Press', 'Incline DB Press', 'Lat Pulldown', 'Seated Cable Row', 'Leg Press', 'Leg Curl', 'Leg Extension', 'Bicep Curl', 'Hammer Curl', 'Tricep Pushdown', 'Overhead Tricep Extension', 'Squat', 'Smith Squat', 'Front Squat', 'Calf Raise', 'Seated Calf Raise'];
  for (const n of ['bench', 'Bench', 'Incline bench', 'incline press', 'Leg', 'Curl', 'Curls', 'Pushdown', 'Tricep pushdowns', 'Squats', 'Front squats', 'Calf raises', 'seated calf', 'Seated row', 'Row', 'DB bench', 'press', 'Lat pull down', 'leg ext', 'Hamstring curl', 'Leg curl machine'])
    console.log(n, JSON.stringify(matchExercise(n, known, {})));
  console.log(JSON.stringify(matchExercise('lat pull-downs', known, { [nameKey('Lat pulldown')]: 'Lat Pulldown' })));
  console.log(JSON.stringify(matchExercise('Bench', known, { [nameKey('bench')]: 'Bench Press' })));
});
test('ids', () => {
  const t = '9/28\nBench 135x8 135x8\nCurl 30x10\nBench 135x6';
  const a = toEntries(parseNotes(t, T, () => false), (n) => n, { ignored: new Set(), include: new Set() }, []);
  console.log(a.entries.map(e => `${e.id} seq${e.seq} ${e.weight}x${e.reps}`).join('\n'));
  const b = toEntries(parseNotes(t, T, () => false), (n) => n, { ignored: new Set([1]), include: new Set() }, []);
  console.log('ignored line1:\n' + b.entries.map(e => `${e.id} seq${e.seq} ${e.weight}x${e.reps}`).join('\n'));
  const c = toEntries(parseNotes('9/28\nbench press 135x8\nBench Press 135x6', T, () => false), (n) => n, { ignored: new Set(), include: new Set() }, []);
  console.log('case:\n' + c.entries.map(e => `${e.id} ${e.exercise} ${e.asWritten ?? ''}`).join('\n'));
  const d = toEntries(parseNotes('9/28\nPull-ups BWx8\nPullups BWx6', T, () => false), (n) => n, { ignored: new Set(), include: new Set() }, [{ id: 'x', date: '2026-09-28', seq: 1, exercise: 'Pull ups', setNo: 1, weight: 0, reps: 5, flags: [], source: 'app' } as any]);
  console.log('nameKey groups vs sameExercise existing:\n' + JSON.stringify(d.groups) + '\n' + d.entries.map(e => `${e.id} ${e.exercise} ${e.asWritten ?? ''}`).join('\n'));
});
