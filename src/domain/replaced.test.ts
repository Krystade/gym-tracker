import { describe, expect, it } from 'vitest';
import { mergeMonth, type CloudMonth } from './cloud';
import { combine, expired, KEEP_MS, replacements, sameSet, sides, stillTaken, type Replaced } from './replaced';
import type { SetEntry } from './types';

// Synthetic sets only.
const NOW = Date.parse('2026-10-07T12:00:00Z');
const x: SetEntry = { id: 'app|2026-10-01|bench press|1', date: '2026-10-01', seq: Date.parse('2026-10-01T18:00:00Z'), exercise: 'Bench Press', setNo: 1, weight: 185, reps: 8, flags: [], source: 'app' };
const remote = (over: Partial<CloudMonth> = {}): CloudMonth => ({ sets: [], body: [], deleted: {}, updatedAt: 1, ...over });
/** What a sync of this month would keep of this phone's: the merge, then the copies it replaced. */
const syncOf = (local: { sets: SetEntry[]; body?: CloudMonth['body']; tombstones?: Set<string> }, cloud: CloudMonth | null) => {
  const here = { sets: local.sets, body: local.body ?? [], tombstones: local.tombstones ?? new Set<string>() };
  return replacements(here, mergeMonth(here, cloud, NOW), NOW);
};

describe('replacements: what a sync took off this phone', () => {
  it('a newer edit from the other phone replacing this phone’s copy', () => {
    const theirs = { ...x, reps: 10, editedAt: NOW - 1000 };
    expect(syncOf({ sets: [x] }, remote({ sets: [theirs] }))).toEqual([
      { key: expect.any(String), kind: 'set', at: NOW, date: x.date, exercise: 'Bench Press', mine: x, theirs },
    ]);
  });

  it('the cloud copy winning a tie: two copies with no edit time between them', () => {
    const theirs = { ...x, reps: 10 };
    const r = syncOf({ sets: [x] }, remote({ sets: [theirs] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'set', mine: x, theirs });
  });

  it('the cloud copy winning a tie of equal edit times', () => {
    const mine = { ...x, editedAt: NOW - 50 }, theirs = { ...x, reps: 10, editedAt: NOW - 50 };
    expect(syncOf({ sets: [mine] }, remote({ sets: [theirs] }))[0]).toMatchObject({ kind: 'set', mine, theirs });
  });

  it('a delete from the other phone beating the set here', () => {
    const r = syncOf({ sets: [x] }, remote({ deleted: { [x.id]: NOW - 1000 } }));
    expect(r).toEqual([{ key: expect.any(String), kind: 'set', at: NOW, date: x.date, exercise: 'Bench Press', mine: x, theirs: null }]);
  });

  it('a body field the cloud won, by a newer entry or a tie; only the fields it replaced', () => {
    const r = syncOf({ sets: [], body: [{ date: '2026-10-01', weight: 180, energy: 3, protein: 150 }] },
      remote({ body: [{ date: '2026-10-01', weight: 182, energy: 4, protein: 150, calories: 2400, at: { energy: NOW - 10 } }] }));
    expect(r).toEqual([{ key: expect.any(String), kind: 'body', at: NOW, date: '2026-10-01', mine: { weight: 180, energy: 3 }, theirs: { weight: 182, energy: 4 } }]);
  });

  it('nothing when the values are the same: stamps, place in the day and the suggestion don’t count', () => {
    const theirs = { ...x, seq: x.seq + 5, editedAt: NOW - 1000, restoredAt: NOW - 2000, target: { weight: 180, reps: 8, sets: 3 }, enteredAt: '2026-10-02T09:00:00Z', note: undefined };
    expect(syncOf({ sets: [x] }, remote({ sets: [theirs] }))).toEqual([]);
    // Tags and flags in another order are the same set.
    const tagged = { ...x, tags: ['a', 'b'], flags: ['pain', 'unsure'] as SetEntry['flags'] };
    expect(syncOf({ sets: [tagged] }, remote({ sets: [{ ...tagged, tags: ['b', 'a'], flags: ['unsure', 'pain'], editedAt: NOW - 10 }] }))).toEqual([]);
    // Logged seconds apart (the same set on two phones): the same minute, as the time shows and is edited.
    expect(sameSet({ ...x, loggedAt: '2026-10-01T18:00:01.250Z' }, { ...x, loggedAt: '2026-10-01T18:00:42.000Z' })).toBe(true);
    expect(sameSet({ ...x, loggedAt: '2026-10-01T18:00:01.250Z' }, { ...x, loggedAt: '2026-10-01T18:01:00.000Z' })).toBe(false);
    // An empty note or tag list is no note or tags.
    expect(sameSet({ ...x, note: '', tags: [] }, x)).toBe(true);
    // The same body value with a newer time.
    expect(syncOf({ sets: [], body: [{ date: '2026-10-01', weight: 180 }] }, remote({ body: [{ date: '2026-10-01', weight: 180, at: { weight: NOW - 10 } }] }))).toEqual([]);
  });

  it('nothing for what only fills in: a set or a body field this phone never had', () => {
    expect(syncOf({ sets: [], body: [{ date: '2026-10-01', weight: 180 }] }, remote({ sets: [x], body: [{ date: '2026-10-01', protein: 150 }] }))).toEqual([]);
  });

  it('nothing when this phone’s copy wins', () => {
    expect(syncOf({ sets: [{ ...x, reps: 9, editedAt: NOW - 10 }] }, remote({ sets: [x] }))).toEqual([]);
  });

  it('one key per set and copy of it, so a sync redone after a failed save keeps one record, not two', () => {
    const a = syncOf({ sets: [x] }, remote({ sets: [{ ...x, reps: 10 }] }));
    const b = syncOf({ sets: [x] }, remote({ sets: [{ ...x, reps: 12 }] }));
    const c = syncOf({ sets: [{ ...x, reps: 7 }] }, remote({ sets: [{ ...x, reps: 12 }] }));
    expect(a[0].key).toBe(b[0].key);
    expect(c[0].key).not.toBe(a[0].key);
  });
});

describe('combine', () => {
  it('takes the synced copy and adds what only this phone had: a note, tags, RIR, a pain flag with its place', () => {
    const mine: SetEntry = { ...x, reps: 8, note: 'felt easy', tags: ['paused'], rir: 2, flags: ['pain'], painRegion: 'elbow', painSeverity: 1 };
    const theirs: SetEntry = { ...x, reps: 10, tags: ['belt'], editedAt: NOW - 10 };
    expect(combine(mine, theirs)).toEqual({ ...theirs, note: 'felt easy', tags: ['belt', 'paused'], rir: 2, flags: ['pain'], painRegion: 'elbow', painSeverity: 1 });
  });

  it('keeps the synced copy’s value where both have one', () => {
    const c = combine({ ...x, reps: 8, note: 'mine', rir: 1, tags: ['paused'] }, { ...x, reps: 10, note: 'theirs', rir: 3 });
    expect(c).toMatchObject({ reps: 10, note: 'theirs', rir: 3, tags: ['paused'] });
  });

  it('isn’t offered when this phone added nothing the synced copy lacks', () => {
    expect(combine({ ...x, reps: 8 }, { ...x, reps: 10, note: 'theirs' })).toBeNull();
  });

  it('isn’t offered when it would only give back this phone’s copy (Keep does that)', () => {
    expect(combine({ ...x, note: 'mine' }, x)).toBeNull();
  });

  it('never adds a flag that changes what the numbers mean', () => {
    expect(combine({ ...x, reps: null, flags: ['partial'] }, { ...x, reps: 10 })).toBeNull();
  });
});

describe('sides', () => {
  it('a set: the lift, then each copy with what differs', () => {
    const r: Replaced = { key: 'k', kind: 'set', at: NOW, date: x.date, exercise: 'Bench Press', mine: { ...x, note: 'felt easy' }, theirs: { ...x, reps: 10 } };
    expect(sides(r)).toEqual({ what: 'Bench Press', mine: '185 × 8 · “felt easy”', theirs: '185 × 10' });
  });
  it('the time only where the two copies’ minutes differ', () => {
    const at = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const r = (a: string, b: string): Replaced => ({ key: 'k', kind: 'set', at: NOW, date: x.date, exercise: 'Bench Press', mine: { ...x, loggedAt: a }, theirs: { ...x, reps: 10, loggedAt: b } });
    expect(sides(r('2026-10-01T18:00:01Z', '2026-10-01T18:00:40Z'))).toMatchObject({ mine: '185 × 8', theirs: '185 × 10' });
    expect(sides(r('2026-10-01T18:00:01Z', '2026-10-01T18:05:00Z'))).toMatchObject({ mine: `185 × 8 · ${at('2026-10-01T18:00:01Z')}`, theirs: `185 × 10 · ${at('2026-10-01T18:05:00Z')}` });
  });
  it('a set deleted on the other phone', () => {
    expect(sides({ key: 'k', kind: 'set', at: NOW, date: x.date, exercise: 'Bench Press', mine: x, theirs: null })).toEqual({ what: 'Bench Press', mine: '185 × 8', theirs: 'Deleted' });
  });
  it('a body day', () => {
    expect(sides({ key: 'k', kind: 'body', at: NOW, date: x.date, mine: { weight: 180.2, energy: 3 }, theirs: { weight: 182, energy: 4 } }))
      .toEqual({ what: 'Weight, energy', mine: '180.2 lb · energy 3', theirs: '182 lb · energy 4' });
  });
});

describe('expired', () => {
  it('a copy is kept for 30 days', () => {
    const r = (at: number): Replaced => ({ key: 'k', kind: 'body', at, date: x.date, mine: { weight: 1 }, theirs: { weight: 2 } });
    expect(KEEP_MS).toBe(30 * 24 * 3600 * 1000);
    expect(expired(r(NOW - KEEP_MS + 1), NOW)).toBe(false);
    expect(expired(r(NOW - KEEP_MS - 1), NOW)).toBe(true);
  });
});

describe('stillTaken: a sync lands only on what the phone hasn’t changed since it read it', () => {
  const y = { ...x, id: 'app|2026-10-01|bench press|2', setNo: 2 }, z = { ...x, id: 'app|2026-10-01|bench press|3', setNo: 3 };
  const day = { date: '2026-10-01', weight: 180, protein: 140, at: { weight: 50, protein: 50 } };
  const taken = { importSets: [{ ...x, reps: 10, editedAt: 100 }, { ...z, weight: 95 }], deleteIds: [y.id], importBody: [{ date: '2026-10-01', weight: 181, protein: 150, at: { weight: 100, protein: 100 } }] };
  const base = { sets: [x, y], body: [day] };
  const now = (sets: (SetEntry | undefined)[], d: typeof day | undefined) => ({ sets: new Map([[x.id, sets[0]], [y.id, sets[1]], [z.id, sets[2]]]), body: new Map([[day.date, d]]) });

  it('takes it all when nothing changed', () => {
    expect(stillTaken(base, now([x, y, undefined], day), taken)).toEqual({ taken, skipped: 0 });
  });
  it('leaves a set edited, one deleted, one logged under the same id, and one put back by Undo', () => {
    const r = stillTaken(base, now([undefined, { ...y, editedAt: 200 }, { ...z, weight: 100 }], day), taken);
    expect(r).toEqual({ taken: { importSets: [], deleteIds: [], importBody: taken.importBody }, skipped: 3 });
    const undone = stillTaken({ sets: [], body: [] }, { sets: new Map([[x.id, { ...x, restoredAt: 200 }]]), body: new Map() }, { importSets: [{ ...x, reps: 10, editedAt: 100 }], deleteIds: [], importBody: [] });
    expect(undone).toEqual({ taken: { importSets: [], deleteIds: [], importBody: [] }, skipped: 1 });
  });
  it('leaves a set changed in any way, even only its edit time', () => {
    expect(stillTaken(base, now([{ ...x, editedAt: 1 }, y, undefined], day), taken).taken.importSets.map((s) => s.id)).toEqual([z.id]);
  });
  it('leaves a body field entered meanwhile, the same value entered again included, and takes the day’s others', () => {
    for (const d of [{ ...day, weight: 182, at: { ...day.at, weight: 200 } }, { ...day, at: { ...day.at, weight: 200 } }]) {
      expect(stillTaken(base, now([x, y, undefined], d), taken)).toEqual({
        taken: { ...taken, importBody: [{ date: '2026-10-01', protein: 150, at: { protein: 100 } }] }, skipped: 1 });
    }
  });
  it('leaves a field the phone first entered meanwhile, and drops a day left with nothing', () => {
    const r = stillTaken({ sets: [], body: [] }, { sets: new Map(), body: new Map([[day.date, { date: day.date, weight: 179, at: { weight: 200 } }]]) },
      { importSets: [], deleteIds: [], importBody: [{ date: day.date, weight: 181, at: { weight: 100 } }] });
    expect(r).toEqual({ taken: { importSets: [], deleteIds: [], importBody: [] }, skipped: 1 });
  });
});
