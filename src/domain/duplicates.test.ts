import { describe, expect, it } from 'vitest';
import { findDuplicateImports, importOverlap } from './duplicates';
import { setId } from './ids';
import type { Flag, SetEntry } from './types';

// Synthetic sets only. Two imports of one made-up notes log: a paste ('notes') and a CSV made from the same text ('log-csv').
let seq = 0;
const s = (source: string, date: string, exercise: string, setNo: number, weight: number, reps: number | null, more: Partial<SetEntry> = {}): SetEntry => ({
  id: setId(source, date, exercise, setNo), date, seq: seq++, exercise, setNo, weight, reps, flags: [] as Flag[], source, ...more,
});
/** One import's day: lifts in order, each a list of [weight, reps]. */
const day = (source: string, date: string, lifts: [string, [number, number | null][]][]) =>
  lifts.flatMap(([ex, sets]) => sets.map(([w, r], i) => s(source, date, ex, i + 1, w, r)));
const D1 = '2026-04-03', D2 = '2026-04-05', D3 = '2026-04-07';
const ids = (xs: SetEntry[]) => xs.map((x) => x.id).sort();

describe('findDuplicateImports', () => {
  it('pairs two imports of the same day set by set, and repeated identical sets in a session all survive once', () => {
    // Three sets of 100×12 and two of 50×12 in one session, each a real set: each pairs with exactly one twin.
    const lifts: [string, [number, number][]][] = [['Lat Pulldown', [[100, 12], [100, 12], [100, 12]]], ['Skullcrusher', [[50, 12], [50, 12]]]];
    const paste = day('notes', D1, lifts), csv = day('log-csv', D1, lifts);
    const r = findDuplicateImports([...csv, ...paste]);
    expect(r.pairs).toHaveLength(5);
    expect(r).toMatchObject({ identical: 5, differing: 0 });
    expect(ids(r.pairs.map((p) => p.remove))).toEqual(ids(csv));
    expect(ids(r.pairs.map((p) => p.keep))).toEqual(ids(paste));
    // One to one, in order: the paste's set n pairs with the CSV's set n.
    for (const p of r.pairs) expect(p.keep.setNo).toBe(p.remove.setNo);
    expect(r.days).toEqual([{ date: D1, pairs: r.pairs, lifts: ['Lat Pulldown', 'Skullcrusher'] }]);
  });

  it('a session one import holds more sets of leaves the extra set alone', () => {
    const paste = day('notes', D1, [['Bench Press', [[100, 10], [100, 10], [100, 10]]]]);
    const csv = day('log-csv', D1, [['Bench Press', [[100, 10], [100, 10]]]]);
    const r = findDuplicateImports([...paste, ...csv]);
    expect(ids(r.pairs.map((p) => p.remove))).toEqual(ids(csv));
    expect(r.pairs).toHaveLength(2); // the paste's third 100×10 is a set of its own
  });

  it('pairs a lift the two imports named differently by its weight×reps sequence, and calls the pair differing', () => {
    const paste = day('notes', D2, [['Hanging Leg Raise', [[0, 15], [0, 15], [0, 15]]], ['Cable Curl', [[50, 10]]]]);
    const csv = day('log-csv', D2, [['Leg Raise', [[0, 15], [0, 15], [0, 15]]], ['Cable Curl', [[50, 10]]]]);
    const r = findDuplicateImports([...csv, ...paste]);
    expect(r.pairs).toHaveLength(4);
    expect(r.pairs.filter((p) => p.differs.includes('exercise')).map((p) => [p.keep.exercise, p.remove.exercise])).toEqual(Array(3).fill(['Hanging Leg Raise', 'Leg Raise']));
    expect(r).toMatchObject({ identical: 1, differing: 3 });
  });

  it('pairs a lift by another name the catalog knows it by, even where the sets differ', () => {
    const paste = day('notes', D2, [['Bench Press', [[135, 8], [135, 8]]]]);
    const csv = day('log-csv', D2, [['Flat Bench Press', [[135, 8], [135, 7]]]]);
    const r = findDuplicateImports([...paste, ...csv]);
    expect(r.pairs.map((p) => [p.keep.id, p.remove.id])).toEqual([[paste[0].id, csv[0].id]]); // 135×8 vs 135×7: not one set
  });

  it('never pairs two different lifts on a day, nor sets with different weights or reps', () => {
    const paste = day('notes', D2, [['Seated Cable Row', [[85, 11], [70, 12]]]]);
    const csv = day('log-csv', D2, [['Lat Pulldown', [[100, 12]]], ['Seated Cable Row', [[90, 11], [70, 10]]]]);
    expect(findDuplicateImports([...paste, ...csv]).pairs).toEqual([]);
  });

  it('keeps the copy with more detail; with equal detail the paste; and lists what differs', () => {
    const paste = [
      s('notes', D3, 'Incline Bench Press', 1, 0, 15, { flags: ['bodyweight', 'warmup'] }),
      s('notes', D3, 'Incline Bench Press', 2, 95, 8, { flags: [] }),
      s('notes', D3, 'Rope Pushdown', 1, 40, 12, {}),
    ];
    const csv = [
      s('log-csv', D3, 'Incline Bench Press', 1, 0, 15, { flags: ['bodyweight'] }),
      s('log-csv', D3, 'Incline Bench Press', 2, 95, 8, { flags: [], asWritten: 'incline bench' }),
      s('log-csv', D3, 'Rope Pushdown', 1, 40, 12, { note: 'hard side' }),
    ];
    const r = findDuplicateImports([...csv, ...paste]);
    const by = new Map(r.pairs.map((p) => [p.keep.exercise + p.keep.setNo, p]));
    expect(by.get('Incline Bench Press1')).toMatchObject({ keep: { source: 'notes' }, differs: ['flags'] });
    // Identical but for provenance (as written): the paste.
    expect(by.get('Incline Bench Press2')).toMatchObject({ keep: { source: 'notes' }, differs: [] });
    // The CSV's copy has the note: it's kept, and the paste's copy goes.
    expect(by.get('Rope Pushdown1')).toMatchObject({ keep: { source: 'log-csv' }, remove: { source: 'notes' }, differs: ['note'] });
  });

  it('a copy changed by hand since wins over its twin; a copy Undo put back does not', () => {
    const p = s('notes', D1, 'Cable Curl', 1, 50, 10, { note: 'slow' }), c = s('log-csv', D1, 'Cable Curl', 1, 50, 10, { editedAt: 1_800_000_000_000 });
    expect(findDuplicateImports([p, c]).pairs[0]).toMatchObject({ keep: { id: c.id }, remove: { id: p.id } });
    const back = { ...c, editedAt: undefined, restoredAt: 1_800_000_000_000 };
    expect(findDuplicateImports([p, back]).pairs[0]).toMatchObject({ keep: { id: p.id }, remove: { id: back.id } });
  });

  it('leaves alone sets logged in the app, days only one import covers, and a day of one import alone', () => {
    const app = day('app', D1, [['Cable Curl', [[50, 10]]]]), imp = day('notes', D1, [['Cable Curl', [[50, 10]]]]);
    const lone = [...day('xlsx', D2, [['Cable Curl', [[50, 10]]]]), ...day('notes', D3, [['Cable Curl', [[50, 10]]]])];
    expect(findDuplicateImports([...app, ...imp, ...lone])).toEqual({ pairs: [], days: [], identical: 0, differing: 0 });
  });

  it('with three imports of one day keeps exactly one copy of each set', () => {
    const lifts: [string, [number, number][]][] = [['Leg Press', [[300, 10], [300, 10]]]];
    const all = [...day('a-csv', D1, lifts), ...day('b-csv', D1, lifts), ...day('notes', D1, lifts)];
    const r = findDuplicateImports(all);
    expect(r.pairs).toHaveLength(4);
    const gone = new Set(r.pairs.map((p) => p.remove.id));
    expect(all.filter((e) => !gone.has(e.id)).map((e) => e.source)).toEqual(['notes', 'notes']);
    for (const p of r.pairs) expect(gone.has(p.keep.id)).toBe(false);
  });
});

describe('importOverlap', () => {
  const log = [...day('notes', D1, [['Cable Pushdown', [[90, 10], [100, 9]]], ['Hanging Leg Raise', [[0, 15]]]]), ...day('app', D2, [['Bench Press', [[135, 8]]]])];

  it('holds back sets on a day and lift the log has from another source, by name, catalog name or sequence', () => {
    const file = [
      ...day('log-csv', D1, [['cable  pushdown', [[90, 10], [100, 9]]], ['Leg Raise', [[0, 15]]], ['Cable Curl', [[40, 12]]]]),
      ...day('log-csv', D2, [['Flat Bench Press', [[140, 5]]]]),
      ...day('log-csv', D3, [['Cable Pushdown', [[90, 10]]]]),
    ];
    const r = importOverlap(log, file);
    expect(r.groups.map((g) => [g.date, g.exercise, g.sets, g.existing, g.existingSource])).toEqual([
      [D1, 'cable  pushdown', 2, 'Cable Pushdown', 'notes'],
      [D1, 'Leg Raise', 1, 'Hanging Leg Raise', 'notes'],
      [D2, 'Flat Bench Press', 1, 'Bench Press', 'app'],
    ]);
    expect(ids(r.held)).toEqual(ids(file.filter((e) => !(e.exercise === 'Cable Curl' || e.date === D3))));
  });

  it('holds nothing back from the same source, a day the log lacks, or a lift that day lacks', () => {
    const more = day('notes', D1, [['Cable Pushdown', [[100, 8]]]]).map((e) => ({ ...e, setNo: 3, id: setId('notes', D1, 'Cable Pushdown', 3) }));
    const r = importOverlap(log, [...more, ...day('x', D3, [['Cable Pushdown', [[90, 10]]]]), ...day('x', D1, [['Cable Curl', [[40, 12]]]])]);
    expect(r).toEqual({ held: [], groups: [] });
  });
});
