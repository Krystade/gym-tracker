import { describe, expect, it } from 'vitest';
import { nameKey, nameSimilarity, parseNoteDate, readSets } from './notes';

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
