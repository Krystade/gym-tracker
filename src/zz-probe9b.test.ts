import { test } from 'vitest';
import { parseNotes, toEntries } from './domain/notes';
const T = '2026-10-01';
const fmt = (x: any) => `${x.weight}x${x.reps}${x.flags.length ? '[' + x.flags.join(',') + ']' : ''}${x.note ? ' n:' + x.note : ''}`;
const show = (s: string) => parseNotes(s, T, () => false).filter(l => l.kind !== 'blank').map(l => `${JSON.stringify(l.raw)} => ${l.kind} ${l.date} name=${JSON.stringify(l.name)} sets=${JSON.stringify(l.sets?.map(fmt))}`).join('\n');
test('b', () => {
  for (const c of ['9/28\nSquat 225x5\n•\tBench 135x8', '9/28\nSquat 225x5\n1.\tBench 135x8', '9/28\nDecline 20 x 10', '9/28\nDecline sit-up 20 x 10', '9/28\nBench\nDec 20 x 10', 'Bench 135x8 135x8x 135x7', 'Bench 135x8 135x', 'Marching 10 min', '9/28\nSquat 225x5\nMay 5x5 felt ok\nJune 15 x 5', 'Bench 135x8 x3 x3', 'Bench 135 x 8 × 3'])
    console.log(show(c) + '\n--');
  // add-anyway overwrite
  const first = toEntries(parseNotes('9/28\nBench 135x8 135x8', T, () => false), n => n, { ignored: new Set(), include: new Set() }, []).entries;
  const second = toEntries(parseNotes('9/28\nBench 155x5', T, () => false), n => n, { ignored: new Set(), include: new Set(['2026-09-28|bench']) }, first);
  console.log('first', first.map(e => e.id + ' ' + e.weight + 'x' + e.reps), 'second', second.entries.map(e => e.id + ' ' + e.weight + 'x' + e.reps));
});
