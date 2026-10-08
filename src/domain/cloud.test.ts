import { describe, expect, it } from 'vitest';
import { mergeMonth, monthHash, monthOf, monthsToSync, splitByMonth, type CloudMonth } from './cloud';
import type { SetEntry } from './types';

// Synthetic sets only.
const set = (date: string, setNo: number, over: Partial<SetEntry> = {}): SetEntry =>
  ({ id: `app|${date}|bench press|${setNo}`, date, seq: Date.parse(`${date}T18:00:00Z`) + setNo, exercise: 'Bench Press', setNo, weight: 100, reps: 10, flags: [], source: 'app', ...over });
const NOW = Date.parse('2026-10-07T12:00:00Z');
const remote = (over: Partial<CloudMonth> = {}): CloudMonth => ({ sets: [], body: [], deleted: {}, updatedAt: 1, ...over });

describe('mergeMonth', () => {
  it('a first sync uploads everything on the phone', () => {
    const r = mergeMonth({ sets: [set('2026-10-01', 1)], body: [{ date: '2026-10-01', weight: 180 }], tombstones: new Set() }, null, NOW);
    expect(r.doc.sets.map((s) => s.id)).toEqual(['app|2026-10-01|bench press|1']);
    expect(r.doc.body).toEqual([{ date: '2026-10-01', weight: 180 }]);
    expect(r).toMatchObject({ importSets: [], deleteIds: [], importBody: [], changed: true });
  });

  it('takes sets from the other phone, and the phone wins where both have the same set', () => {
    const mine = set('2026-10-01', 1, { reps: 9 });
    const r = mergeMonth({ sets: [mine], body: [], tombstones: new Set() }, remote({ sets: [set('2026-10-01', 1, { reps: 12 }), set('2026-10-02', 1)] }), NOW);
    expect(r.importSets.map((s) => s.id)).toEqual(['app|2026-10-02|bench press|1']);
    expect(r.doc.sets.find((s) => s.id === mine.id)!.reps).toBe(9);
    expect(r.doc.sets).toHaveLength(2);
  });

  it('a set deleted here is deleted in the cloud, with the time it went', () => {
    const gone = set('2026-10-01', 2);
    const r = mergeMonth({ sets: [set('2026-10-01', 1)], body: [], tombstones: new Set([gone.id]) }, remote({ sets: [set('2026-10-01', 1), gone] }), NOW);
    expect(r.doc.sets.map((s) => s.id)).toEqual([set('2026-10-01', 1).id]);
    expect(r.doc.deleted).toEqual({ [gone.id]: NOW });
    expect(r.importSets).toEqual([]);
  });

  it('a set deleted on the other phone is deleted here', () => {
    const gone = set('2026-10-01', 2);
    const r = mergeMonth({ sets: [set('2026-10-01', 1), gone], body: [], tombstones: new Set() }, remote({ deleted: { [gone.id]: NOW - 1000 } }), NOW);
    expect(r.deleteIds).toEqual([gone.id]);
    expect(r.doc.sets.map((s) => s.id)).toEqual([set('2026-10-01', 1).id]);
  });

  it('a set logged again under a deleted id after the delete stays, and its tombstone goes', () => {
    const relogged = set('2026-10-01', 2, { seq: NOW - 10 });
    const r = mergeMonth({ sets: [relogged], body: [], tombstones: new Set([relogged.id]) }, remote({ deleted: { [relogged.id]: NOW - 5000 } }), NOW);
    expect(r.deleteIds).toEqual([]);
    expect(r.doc.sets.map((s) => s.id)).toEqual([relogged.id]);
    expect(r.doc.deleted).toEqual({});
  });

  it('body days fill each other in; the phone wins a field both have', () => {
    const r = mergeMonth({ sets: [], body: [{ date: '2026-10-01', weight: 180 }], tombstones: new Set() },
      remote({ body: [{ date: '2026-10-01', weight: 175, protein: 150 }, { date: '2026-10-02', calories: 2400 }] }), NOW);
    expect(r.doc.body).toEqual([{ date: '2026-10-01', weight: 180, protein: 150 }, { date: '2026-10-02', calories: 2400 }]);
    expect(r.importBody).toEqual([{ date: '2026-10-01', protein: 150 }, { date: '2026-10-02', calories: 2400 }]);
  });

  it('nothing to push when the cloud already has what the phone has', () => {
    const s = set('2026-10-01', 1);
    expect(mergeMonth({ sets: [s], body: [], tombstones: new Set() }, remote({ sets: [s] }), NOW).changed).toBe(false);
  });

  it('cloud documents hold no undefined fields (Firestore rejects them)', () => {
    const r = mergeMonth({ sets: [set('2026-10-01', 1, { note: undefined })], body: [], tombstones: new Set() }, null, NOW);
    expect(JSON.stringify(r.doc)).not.toContain('undefined');
    expect('note' in r.doc.sets[0]).toBe(false);
  });
});

describe('splitByMonth and monthsToSync', () => {
  it('groups sets, body days and tombstones by month', () => {
    const m = splitByMonth([set('2026-09-30', 1), set('2026-10-01', 1)], [{ date: '2026-10-03', weight: 1 }], new Set(['app|2026-08-02|curl|1']));
    expect([...m.keys()].sort()).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(m.get('2026-08')!.tombstones.size).toBe(1);
    expect(monthOf('2026-10-07')).toBe('2026-10');
  });

  it('syncs a month that changed here, changed in the cloud, or only exists in the cloud', () => {
    const local = splitByMonth([set('2026-09-30', 1), set('2026-10-01', 1)], [], new Set());
    const seen = { '2026-09': { hash: monthHash(local.get('2026-09')!), at: 5 }, '2026-10': { hash: 'old', at: 5 } };
    expect(monthsToSync(local, { '2026-09': 5, '2026-10': 5, '2026-08': 3 }, seen).sort()).toEqual(['2026-08', '2026-10']);
    expect(monthsToSync(local, { '2026-09': 6 }, seen).sort()).toEqual(['2026-09', '2026-10']);
  });
});
