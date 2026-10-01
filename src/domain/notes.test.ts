import { describe, expect, it } from 'vitest';
import { matchExercise, parseAliasesJson, nameKey, nameSimilarity, parseNoteDate, parseNotes, readSets, toEntries } from './notes';
import { setId } from './ids';
import type { SetEntry } from './types';

// Every string here is synthetic: no real log lines.
const TODAY = '2026-10-01';
const brief = (text: string, hold = false) => readSets(text, hold).sets.map((s) => [s.weight, s.reps, s.flags.join(';')]);

describe('readSets', () => {
  it('reads weight×reps in every spelling', () => {
    expect(brief('80x10 80 x 9 80×8 80X7 80*6')).toEqual([[80, 10, ''], [80, 9, ''], [80, 8, ''], [80, 7, ''], [80, 6, '']]);
  });
  it('splits on commas, semicolons and "and"', () => {
    expect(brief('50x12, 55x10; 60x8 and 60x6').map((s) => s[1])).toEqual([12, 10, 8, 6]);
  });
  it('reads decimals, bodyweight, dumbbell shorthand and partials', () => {
    expect(brief('12.5x15 BWx12 bw x 10 0x8 40sx12 90x')).toEqual([
      [12.5, 15, ''], [0, 12, 'bodyweight'], [0, 10, 'bodyweight'], [0, 8, 'bodyweight'], [40, 12, ''], [90, null, 'partial'],
    ]);
  });
  it('marks unsure sets', () => {
    expect(brief('70x9?')).toEqual([[70, 9, 'unsure']]);
  });
  it('expands weight×reps×sets', () => {
    expect(brief('100x12x3')).toEqual([[100, 12, ''], [100, 12, ''], [100, 12, '']]);
  });
  it('reads a negative weight as an assisted bodyweight set', () => {
    const [s] = readSets('-30x8', false).sets;
    expect(s).toMatchObject({ weight: 0, reps: 8, flags: ['bodyweight'], note: 'assisted -30 lb' });
  });
  it('gives text between sets to the set before it, and leading text to the first set', () => {
    const r = readSets('felt fresh 60x10 easy one, 70x8 grinder', false);
    expect(r.sets.map((s) => s.note)).toEqual(['felt fresh; easy one', 'grinder']);
  });
  it('reads RIR in its usual forms, keeping the conservative end', () => {
    expect(readSets('50x10 2 rir 50x9 1-2 RIR 50x8 rir 0 50x7 @3', false).sets.map((s) => s.rir)).toEqual([2, 1, 0, 3]);
  });
  it('flags pain with the region the note names, and unsure notes', () => {
    const [a, b] = readSets('40x10 elbow hurt a bit 40x8 not sure about the count', false).sets;
    expect(a).toMatchObject({ flags: ['pain'], painRegion: 'elbow' });
    expect(b.flags).toEqual(['unsure']);
  });
  it('flags warm-ups and strips the marker from the note', () => {
    const r = readSets('(WU) 45x10 95x8 warm up 135x5', false).sets;
    expect(r.map((s) => s.flags)).toEqual([['warmup'], ['warmup'], []]);
    expect(r.map((s) => s.note)).toEqual([undefined, undefined, undefined]);
  });
  it('reads holds in seconds for hold exercises', () => {
    expect(brief('45s 30 sec 1:05 25x40s', true)).toEqual([[0, 45, 'hold;bodyweight'], [0, 30, 'hold;bodyweight'], [0, 65, 'hold;bodyweight'], [25, 40, 'hold']]);
  });
  it('doesn’t read times or distances as sets', () => {
    expect(brief('1.5 miles in 15:30')).toEqual([]);
    expect(brief('2 sets were rough')).toEqual([]);
  });
});

describe('parseNoteDate', () => {
  it('reads the usual date forms', () => {
    const d = (s: string) => parseNoteDate(s, TODAY)?.date;
    expect(d('9/14/26')).toBe('2026-09-14');
    expect(d('9/14/2026')).toBe('2026-09-14');
    expect(d('9-14-26')).toBe('2026-09-14');
    expect(d('2026-09-14')).toBe('2026-09-14');
    expect(d('Mon 9/14')).toBe('2026-09-14');
    expect(d('September 14')).toBe('2026-09-14');
    expect(d('Sep 14, 2026')).toBe('2026-09-14');
    expect(d('14 Sept')).toBe('2026-09-14');
  });
  it('keeps the text after the date', () => {
    expect(parseNoteDate('9/14 push day', TODAY)).toEqual({ date: '2026-09-14', rest: 'push day' });
  });
  it('puts a yearless date in the past', () => {
    expect(parseNoteDate('12/20', TODAY)?.date).toBe('2025-12-20');
    expect(parseNoteDate('10/1', TODAY)?.date).toBe('2026-10-01');
  });
  it('rejects days that don’t exist and non-dates', () => {
    expect(parseNoteDate('2/30', TODAY)).toBeNull();
    expect(parseNoteDate('13/2', TODAY)).toBeNull();
    expect(parseNoteDate('Bench press', TODAY)).toBeNull();
    expect(parseNoteDate('80x10', TODAY)).toBeNull();
  });
});

describe('nameKey', () => {
  it('folds spelling, plurals and synonyms', () => {
    expect(nameKey('Overhead Dumbell Extensions')).toBe(nameKey('overhead DB extension'));
    expect(nameKey('Cable push downs')).toBe(nameKey('Cable Pushdown'));
    expect(nameKey('Pull-ups')).toBe(nameKey('pullup'));
    expect(nameKey('Tricep kickbacks')).toBe(nameKey('Triceps Kickback'));
    expect(nameKey('Farmer’s Carry')).toBe(nameKey("farmers carry"));
    expect(nameKey('Bench press')).toBe('bench press');
  });
  it('scores word overlap', () => {
    expect(nameSimilarity('Incline curl', 'Incline DB Curl')).toBeCloseTo(2 / 3);
    expect(nameSimilarity('Leg press', 'Bench press')).toBeCloseTo(1 / 3);
  });
});

describe('parseNotes', () => {
  const NOTE = [
    'Gym log',
    '9/28/26',
    'Seated Row\t80x10 70x12 dropped weight 70x12',
    'Face Pull\tSkip',
    'Bench press: 95x10, 115x8',
    'Run: 2 miles in 20:00',
    '',
    '9/29',
    'Lat pulldown',
    '100x12 100x10',
    '(WU) 60x5',
    'Plank: 45s 40s',
    'Tricep pushdown - 50x12 50x10',
    'Cable fly skipped',
    '9/30 Smith squat 135x8',
  ].join('\n');
  const lines = parseNotes(NOTE, TODAY, (n) => /plank/i.test(n));
  const kinds = lines.map((l) => l.kind);

  it('classifies every line', () => {
    expect(kinds).toEqual(['heading', 'date', 'sets', 'skip', 'sets', 'unparsed', 'blank', 'date', 'heading', 'sets', 'sets', 'sets', 'sets', 'skip', 'sets']);
  });
  it('carries the date down and reads names across separators', () => {
    const sets = lines.filter((l) => l.kind === 'sets');
    expect(sets.map((l) => [l.date, l.name, l.sets!.length])).toEqual([
      ['2026-09-28', 'Seated Row', 3], ['2026-09-28', 'Bench press', 2],
      ['2026-09-29', 'Lat pulldown', 2], ['2026-09-29', 'Lat pulldown', 1], ['2026-09-29', 'Plank', 2], ['2026-09-29', 'Tricep pushdown', 2],
      ['2026-09-30', 'Smith squat', 1],
    ]);
    expect(sets[3].sets![0].flags).toContain('warmup');
    expect(sets[4].sets!.map((s) => s.reps)).toEqual([45, 40]);
  });
  it('says why a line didn’t parse', () => {
    expect(lines[5].reason).toMatch(/85x10/);
  });
  it('puts lines before any date on today', () => {
    expect(parseNotes('Curl: 30x10', TODAY, () => false)[0]).toMatchObject({ kind: 'sets', date: TODAY });
  });
});

describe('matchExercise', () => {
  const known = ['Cable Pushdown', 'Incline DB Curl', 'Seated Cable Row', 'Lat Pulldown'];
  it('prefers a saved mapping, then an exact folded match, then a close one', () => {
    expect(matchExercise('Pushdowns', known, { [nameKey('Pushdowns')]: 'Cable Pushdown' })).toMatchObject({ exercise: 'Cable Pushdown', how: 'alias' });
    expect(matchExercise('lat pull down', known, {})).toMatchObject({ exercise: 'Lat Pulldown', how: 'exact' });
    expect(matchExercise('Incline curl', known, {})).toMatchObject({ exercise: 'Incline DB Curl', how: 'fuzzy' });
  });
  it('keeps an unknown name as a new exercise, with suggestions', () => {
    const m = matchExercise('  zercher   squat ', known, {});
    expect(m).toMatchObject({ exercise: 'zercher squat', how: 'new' });
    expect(Array.isArray(m.suggestions)).toBe(true);
  });
});

describe('toEntries', () => {
  const text = '9/29\nLat pulldown: 100x12 100x10\n110x8\nCurl: 30x10 double pulley\nCurl: 30x8\n9/30\nCurl: 35x8';
  const lines = parseNotes(text, TODAY, () => false);
  const resolve = (n: string) => (/curl/i.test(n) ? 'Cable Curl' : 'Lat Pulldown');
  const existing: SetEntry[] = [{ id: 'x', date: '2026-09-30', seq: 0, exercise: 'cable curl', setNo: 1, weight: 30, reps: 9, flags: [], source: 'app' }];

  it('numbers sets per day and exercise across lines, with stable ids', () => {
    const { entries } = toEntries(lines, resolve, { ignored: new Set(), include: new Set() }, existing);
    const pull = entries.filter((e) => e.exercise === 'Lat Pulldown');
    expect(pull.map((e) => [e.setNo, e.weight, e.reps])).toEqual([[1, 100, 12], [2, 100, 10], [3, 110, 8]]);
    expect(pull[0].id).toBe(setId('notes', '2026-09-29', 'Lat Pulldown', 1));
    expect(pull[0]).toMatchObject({ source: 'notes', asWritten: 'Lat pulldown' });
    expect(toEntries(lines, resolve, { ignored: new Set(), include: new Set() }, existing).entries.map((e) => e.id)).toEqual(entries.map((e) => e.id));
  });
  it('keeps double pulley for the rest of the paste', () => {
    const { entries } = toEntries(lines, resolve, { ignored: new Set(), include: new Set() }, []);
    expect(entries.filter((e) => e.exercise === 'Cable Curl').map((e) => e.flags.includes('double_pulley'))).toEqual([true, true, true]);
  });
  it('leaves out days already logged unless included, and ignored lines', () => {
    const r = toEntries(lines, resolve, { ignored: new Set([2]), include: new Set() }, existing);
    expect(r.groups.find((g) => g.date === '2026-09-30')).toMatchObject({ existing: true });
    expect(r.entries.some((e) => e.date === '2026-09-30')).toBe(false);
    expect(r.entries.filter((e) => e.exercise === 'Lat Pulldown')).toHaveLength(2);
    const key = r.groups.find((g) => g.date === '2026-09-30')!.key;
    expect(toEntries(lines, resolve, { ignored: new Set(), include: new Set([key]) }, existing).entries.some((e) => e.date === '2026-09-30')).toBe(true);
  });
});

describe('parseAliasesJson', () => {
  it('reads a mappings file, folding its keys', () => {
    expect(parseAliasesJson('{"type":"gym-tracker-aliases","aliases":{"Push Downs":"Cable Pushdown","x":1}}')).toEqual({ aliases: { [nameKey('Push Downs')]: 'Cable Pushdown' }, skipped: 1 });
  });
  it('ignores other JSON', () => {
    expect(parseAliasesJson('{"type":"gym-tracker-profile"}')).toBeNull();
    expect(parseAliasesJson('not json')).toBeNull();
  });
});
