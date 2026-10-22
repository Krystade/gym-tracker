import { describe, expect, it } from 'vitest';
import { mergeMeta, mergeMonth, metaHash, monthHash, monthOf, monthsToSync, splitByMonth, type CloudMonth } from './cloud';
import type { SetEntry } from './types';
import { mergeBody, type BodyDay } from './body';

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

  it('takes sets from the other phone; where both have a set and no edit tells them apart, the cloud\'s copy', () => {
    const mine = set('2026-10-01', 1, { reps: 9 });
    const r = mergeMonth({ sets: [mine], body: [], tombstones: new Set() }, remote({ sets: [set('2026-10-01', 1, { reps: 12 }), set('2026-10-02', 1)] }), NOW);
    expect(r.importSets.map((s) => s.id)).toEqual(['app|2026-10-01|bench press|1', 'app|2026-10-02|bench press|1']);
    expect(r.doc.sets.find((s) => s.id === mine.id)!.reps).toBe(12);
    expect(r.doc.sets).toHaveLength(2);
    expect(r.changed).toBe(false);
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

  // The delete stays in the cloud beside the newer set: a phone still holding the old tombstone then reads the set as newer than
  // the delete it knows, and takes it, instead of deleting it again.
  it('a set logged again under a deleted id after the delete stays, beside the delete it beat', () => {
    const relogged = set('2026-10-01', 2, { seq: NOW - 10 });
    const r = mergeMonth({ sets: [relogged], body: [], tombstones: new Set([relogged.id]) }, remote({ deleted: { [relogged.id]: NOW - 5000 } }), NOW);
    expect(r.deleteIds).toEqual([]);
    expect(r.doc.sets.map((s) => s.id)).toEqual([relogged.id]);
    expect(r.doc.deleted).toEqual({ [relogged.id]: NOW - 5000 });
  });

  it('a set put back by Undo after its delete synced stays, beside the delete it beat', () => {
    const back = set('2026-10-01', 2, { restoredAt: NOW - 10 }); // logged long before the delete; Undo after it
    const r = mergeMonth({ sets: [back], body: [], tombstones: new Set() }, remote({ deleted: { [back.id]: NOW - 5000 } }), NOW);
    expect(r.deleteIds).toEqual([]);
    expect(r.doc.sets.map((s) => s.id)).toEqual([back.id]);
    expect(r.doc.deleted).toEqual({ [back.id]: NOW - 5000 });
    expect(r.doc.sets[0].seq).toBe(back.seq); // the day keeps its order
  });

  it('the other phone, holding the tombstone of that delete, takes the set back instead of deleting it again', () => {
    const back = set('2026-10-01', 2, { restoredAt: NOW - 10 });
    // A tombstone from before this round carries no time: the cloud's delete stands in for it.
    const r = mergeMonth({ sets: [], body: [], tombstones: new Set([back.id]) }, remote({ sets: [back], deleted: { [back.id]: NOW - 5000 } }), NOW);
    expect(r.importSets).toEqual([back]);
    expect(r.doc.sets).toEqual([back]);
    expect(r.doc.deleted).toEqual({ [back.id]: NOW - 5000 });
    expect(r.changed).toBe(false);
  });

  it('a delete after an Undo still wins', () => {
    const back = set('2026-10-01', 2, { restoredAt: NOW - 5000 });
    const r = mergeMonth({ sets: [back], body: [], tombstones: new Set() }, remote({ deleted: { [back.id]: NOW - 10 } }), NOW);
    expect(r.deleteIds).toEqual([back.id]);
  });

  it('body days fill each other in; a field both have with no edit time on either side goes to the cloud\'s', () => {
    const r = mergeMonth({ sets: [], body: [{ date: '2026-10-01', weight: 180 }], tombstones: new Set() },
      remote({ body: [{ date: '2026-10-01', weight: 175, protein: 150 }, { date: '2026-10-02', calories: 2400 }] }), NOW);
    expect(r.doc.body).toEqual([{ date: '2026-10-01', weight: 175, protein: 150 }, { date: '2026-10-02', calories: 2400 }]);
    expect(r.importBody).toEqual([{ date: '2026-10-01', weight: 175, protein: 150 }, { date: '2026-10-02', calories: 2400 }]);
    expect(r.changed).toBe(false);
  });

  it('nothing to push, and nothing to take, when the cloud already has what the phone has', () => {
    const s = set('2026-10-01', 1, { note: undefined });
    const r = mergeMonth({ sets: [s], body: [{ date: '2026-10-01', weight: 180 }], tombstones: new Set() },
      remote({ sets: [{ ...set('2026-10-01', 1) }], body: [{ date: '2026-10-01', weight: 180 }] }), NOW);
    expect(r).toMatchObject({ changed: false, importSets: [], importBody: [] });
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

describe('mergeMeta', () => {
  const program = { key: 'program', perSession: 5 }, bench = { key: 'bench press', repMin: 6, repMax: 10 };
  it('a first sync uploads all of the phone\'s settings, and a fresh phone takes the cloud\'s', () => {
    const up = mergeMeta({ program, 'settings:bench press': bench }, null, {});
    expect(up.changed).toBe(true);
    expect(up.items).toEqual({ program, 'settings:bench press': bench });
    expect(up.pull).toEqual({});
    const down = mergeMeta({}, up.items, {});
    expect(down.changed).toBe(false);
    expect(down.pull).toEqual({ program, 'settings:bench press': bench });
    expect(down.seen).toEqual(up.seen);
  });
  it('takes the union, the phone winning what it changed and the cloud winning what only it changed', () => {
    const first = mergeMeta({ program, 'alias:pushdowns': 'Cable Pushdown' }, null, {});
    const edited = { ...program, perSession: 6 }, cloudBench = { ...bench, repMax: 12 };
    const r = mergeMeta({ program: edited, 'alias:pushdowns': 'Cable Pushdown' },
      { program: { ...program, perSession: 4 }, 'alias:pushdowns': 'Rope Pushdown', 'settings:bench press': cloudBench }, first.seen);
    expect(r.items).toEqual({ program: edited, 'alias:pushdowns': 'Rope Pushdown', 'settings:bench press': cloudBench });
    expect(r.pull).toEqual({ 'alias:pushdowns': 'Rope Pushdown', 'settings:bench press': cloudBench });
    expect(r.changed).toBe(true);
  });
  it('a phone that already has its own settings keeps them on its first sync', () => {
    const r = mergeMeta({ program }, { program: { ...program, perSession: 4 } }, {});
    expect(r.items.program).toEqual(program);
    expect(r.pull).toEqual({});
  });
  it('the day achievements count from: the earliest either phone kept, whichever changed it', () => {
    // A new phone's first sync: its own day would win by the usual rule; the earlier one the account has wins.
    const a = mergeMeta({ achievements: '2026-10-25' }, { achievements: '2026-10-22' }, {});
    expect(a.items.achievements).toBe('2026-10-22');
    expect(a.pull).toEqual({ achievements: '2026-10-22' });
    const b = mergeMeta({ achievements: '2026-10-22' }, { achievements: '2026-10-25' }, {});
    expect(b.items.achievements).toBe('2026-10-22');
    expect(b).toMatchObject({ changed: true, pull: {} });
    // Unchanged here since the last sync (the cloud would win by the usual rule): still the earliest.
    const c = mergeMeta({ achievements: '2026-10-22' }, { achievements: '2026-10-30' }, { achievements: metaHash('2026-10-22') });
    expect(c.items.achievements).toBe('2026-10-22');
    // Only one side has it: that one.
    expect(mergeMeta({}, { achievements: '2026-10-30' }, {}).pull).toEqual({ achievements: '2026-10-30' });
  });
  it('nothing changed on either side is a no-op', () => {
    const first = mergeMeta({ program }, null, {});
    const again = mergeMeta({ program: { perSession: 5, key: 'program' } }, first.items, first.seen);
    expect(again).toMatchObject({ changed: false, pull: {} });
    expect(mergeMeta({ program }, {}, first.seen).items).toEqual({ program }); // the cloud lost it: the phone puts it back
    expect(metaHash({ a: 1, b: { c: 2, d: 3 } })).toBe(metaHash({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

// Round 10: two phones on one account. Each phone is modelled the way cloud/sync applies a merge: the merge goes up when it
// changed, and the phone takes the sets and body fields it was handed, and drops the deletes (as tombstones without a time).
interface Phone { sets: SetEntry[]; body: BodyDay[]; tombstones: Set<string>; tombAt: Record<string, number> }
const phone = (sets: SetEntry[] = [], body: BodyDay[] = []): Phone => ({ sets: [...sets], body: [...body], tombstones: new Set(), tombAt: {} });
const cloudOf = (doc: CloudMonth | null = null) => ({ doc, writes: 0 });
function sync(p: Phone, cloud: { doc: CloudMonth | null; writes: number }, now: number) {
  const r = mergeMonth({ sets: p.sets, body: p.body, tombstones: p.tombstones, tombAt: p.tombAt }, cloud.doc, now);
  if (r.changed) { cloud.doc = r.doc; cloud.writes++; }
  const taken = new Set([...r.importSets.map((s) => s.id), ...r.deleteIds]);
  p.sets = [...p.sets.filter((s) => !taken.has(s.id)), ...r.importSets];
  for (const id of r.deleteIds) p.tombstones.add(id);
  p.body = mergeBody(p.body, r.importBody);
  return r;
}
const edit = (p: Phone, id: string, over: Partial<SetEntry>, at: number) => { p.sets = p.sets.map((s) => (s.id === id ? { ...s, ...over, editedAt: at } : s)); };
const del = (p: Phone, id: string, at: number) => { p.sets = p.sets.filter((s) => s.id !== id); p.tombstones.add(id); p.tombAt[id] = at; };
const weightOf = (sets: SetEntry[] | undefined, id: string) => sets?.find((s) => s.id === id)?.weight;

describe('two phones editing the same set (round 10)', () => {
  const x = set('2026-10-01', 1, { weight: 185 });
  const start = () => ({ a: phone([x]), b: phone([x]), c: cloudOf(remote({ sets: [x] })) });

  it('both edit it: the newest edit wins on both phones and in the cloud, whichever syncs first', () => {
    for (const order of [['a', 'b'], ['b', 'a']] as const) {
      const { a, b, c } = start();
      edit(a, x.id, { weight: 190 }, NOW - 60_000);
      edit(b, x.id, { weight: 195 }, NOW - 30_000); // later
      const ps = { a, b };
      for (let round = 0; round < 3; round++) for (const k of order) sync(ps[k], c, NOW + round);
      expect([weightOf(a.sets, x.id), weightOf(b.sets, x.id), weightOf(c.doc?.sets, x.id)]).toEqual([195, 195, 195]);
    }
  });

  it('an edit on one phone reaches the other, and the cloud stops changing: no write back and forth on every poll', () => {
    const { a, b, c } = start();
    edit(a, x.id, { weight: 190 }, NOW - 60_000);
    for (let poll = 0; poll < 4; poll++) { sync(a, c, NOW + poll * 120_000); sync(b, c, NOW + poll * 120_000 + 1); }
    expect(c.writes).toBe(1); // A's edit going up; nothing after it
    expect([weightOf(a.sets, x.id), weightOf(b.sets, x.id), weightOf(c.doc?.sets, x.id)]).toEqual([190, 190, 190]);
  });

  it('the cloud copy that wins goes onto the phone as an import', () => {
    const newer = { ...x, weight: 190, editedAt: NOW - 10 };
    const r = mergeMonth({ sets: [x], body: [], tombstones: new Set() }, remote({ sets: [newer] }), NOW);
    expect(r.importSets).toEqual([newer]);
    expect(r.doc.sets).toEqual([newer]);
    expect(r.changed).toBe(false);
  });

  it('two copies from before this round, with no edit time on either side: the cloud\'s wins, and goes onto the phone', () => {
    const r = mergeMonth({ sets: [{ ...x, weight: 190 }], body: [], tombstones: new Set() }, remote({ sets: [x] }), NOW);
    expect(weightOf(r.doc.sets, x.id)).toBe(185);
    expect(r.importSets).toEqual([x]);
    expect(r.changed).toBe(false);
  });

  it('an equal edit time goes to the cloud\'s copy; an unstamped cloud copy never beats an edited one on the phone', () => {
    const mine = { ...x, weight: 190, editedAt: NOW - 10 };
    expect(weightOf(mergeMonth({ sets: [mine], body: [], tombstones: new Set() }, remote({ sets: [{ ...x, weight: 200, editedAt: NOW - 10 }] }), NOW).doc.sets, x.id)).toBe(200);
    expect(weightOf(mergeMonth({ sets: [mine], body: [], tombstones: new Set() }, remote({ sets: [x] }), NOW).doc.sets, x.id)).toBe(190);
  });

  it('two phones holding different copies from before edit times settle on the cloud\'s, and the cloud stops changing', () => {
    for (const first of ['a', 'b'] as const) {
      const ps = { a: phone([x]), b: phone([{ ...x, weight: 190 }]) }, c = cloudOf();
      const order = first === 'a' ? (['a', 'b'] as const) : (['b', 'a'] as const);
      for (let poll = 0; poll < 4; poll++) for (const k of order) sync(ps[k], c, NOW + poll * 120_000);
      const want = first === 'a' ? 185 : 190; // whichever copy reached the cloud first
      expect([weightOf(ps.a.sets, x.id), weightOf(ps.b.sets, x.id), weightOf(c.doc?.sets, x.id)]).toEqual([want, want, want]);
      expect(c.writes).toBe(1);
    }
  });

  it('this phone\'s replaced copy, put back as a new edit, wins on the next sync and reaches the other phone', () => {
    const a = phone([x]), b = phone([{ ...x, weight: 190 }]), c = cloudOf();
    sync(a, c, NOW); sync(b, c, NOW + 1);
    expect(weightOf(b.sets, x.id)).toBe(185);
    edit(b, x.id, { weight: 190 }, NOW + 60_000); // Keep this phone's: the copy it had, stamped now
    for (let poll = 0; poll < 3; poll++) { sync(b, c, NOW + 120_000 * (poll + 1)); sync(a, c, NOW + 120_000 * (poll + 1) + 1); }
    expect([weightOf(a.sets, x.id), weightOf(b.sets, x.id), weightOf(c.doc?.sets, x.id)]).toEqual([190, 190, 190]);
  });
});

describe('an edit against a delete (round 10)', () => {
  const x = set('2026-10-01', 1, { weight: 185 });
  const start = () => ({ a: phone([x]), b: phone([x]), c: cloudOf(remote({ sets: [x] })) });

  it('an edit on the other phone after the delete beats it, and both phones keep the edited set', () => {
    const { a, b, c } = start();
    del(a, x.id, NOW - 60_000);
    sync(a, c, NOW - 50_000);
    edit(b, x.id, { weight: 190 }, NOW - 40_000); // B hadn't synced: it still has the set, and edits it after A's delete
    for (let round = 0; round < 3; round++) { sync(b, c, NOW + round); sync(a, c, NOW + round); }
    expect([weightOf(a.sets, x.id), weightOf(b.sets, x.id), weightOf(c.doc?.sets, x.id)]).toEqual([190, 190, 190]);
  });

  it('a delete after the other phone’s edit wins on both', () => {
    const { a, b, c } = start();
    edit(b, x.id, { weight: 190 }, NOW - 60_000);
    sync(b, c, NOW - 50_000);
    del(a, x.id, NOW - 40_000); // A deletes before it has seen B's edit, but after it
    for (let round = 0; round < 3; round++) { sync(a, c, NOW + round); sync(b, c, NOW + round); }
    expect([a.sets, b.sets, c.doc?.sets]).toEqual([[], [], []]);
  });

  it('deleting the set again after the edit brought it back sticks', () => {
    const { a, b, c } = start();
    del(a, x.id, NOW - 60_000);
    sync(a, c, NOW - 50_000);
    edit(b, x.id, { weight: 190 }, NOW - 40_000);
    sync(b, c, NOW - 30_000);
    sync(a, c, NOW - 20_000);
    expect(weightOf(a.sets, x.id)).toBe(190);
    del(a, x.id, NOW - 10_000);
    for (let round = 0; round < 3; round++) { sync(a, c, NOW + round); sync(b, c, NOW + round); }
    expect([a.sets, b.sets, c.doc?.sets]).toEqual([[], [], []]);
  });

  it('a delete on this phone carries its own time to the cloud', () => {
    const r = mergeMonth({ sets: [], body: [], tombstones: new Set([x.id]), tombAt: { [x.id]: NOW - 777 } }, remote({ sets: [x] }), NOW);
    expect(r.doc.deleted).toEqual({ [x.id]: NOW - 777 });
    expect(r.doc.sets).toEqual([]);
  });
});

describe('two phones editing the same body day (round 10)', () => {
  const day: BodyDay = { date: '2026-10-01', weight: 180, energy: 3 };
  it('the newest weigh-in wins; weight changed on one phone and energy on the other both survive', () => {
    const a = phone([], [day]), b = phone([], [day]), c = cloudOf(remote({ body: [day] }));
    a.body = mergeBody(a.body, [{ date: day.date, weight: 181, at: { weight: NOW - 60_000 } }]);
    b.body = mergeBody(b.body, [{ date: day.date, weight: 182, at: { weight: NOW - 30_000 } }]);
    b.body = mergeBody(b.body, [{ date: day.date, energy: 5, at: { energy: NOW - 20_000 } }]);
    a.body = mergeBody(a.body, [{ date: day.date, energy: 1, at: { energy: NOW - 90_000 } }]); // older than B's
    for (let round = 0; round < 3; round++) { sync(a, c, NOW + round); sync(b, c, NOW + round); }
    const want = { date: day.date, weight: 182, energy: 5, at: { weight: NOW - 30_000, energy: NOW - 20_000 } };
    for (const d of [a.body[0], b.body[0], c.doc!.body[0]]) expect(d).toEqual(want);
    expect(c.writes).toBe(2); // A's merge, then B's; then nothing
  });
  it('a field with no edit time on either side (from before this round) goes to the cloud\'s copy; one side\'s alone fills in', () => {
    const r = mergeMonth({ sets: [], body: [{ date: day.date, weight: 181, calories: 2000 }], tombstones: new Set() }, remote({ body: [{ date: day.date, weight: 175, protein: 150 }] }), NOW);
    expect(r.doc.body).toEqual([{ date: day.date, weight: 175, calories: 2000, protein: 150 }]);
  });
  it('an equal edit time on a field goes to the cloud\'s copy; an unstamped cloud field never beats an entered one', () => {
    const at = { weight: NOW - 10 };
    expect(mergeMonth({ sets: [], body: [{ date: day.date, weight: 181, at }], tombstones: new Set() }, remote({ body: [{ date: day.date, weight: 175, at }] }), NOW).doc.body[0].weight).toBe(175);
    expect(mergeMonth({ sets: [], body: [{ date: day.date, weight: 181, at }], tombstones: new Set() }, remote({ body: [{ date: day.date, weight: 175 }] }), NOW).doc.body[0].weight).toBe(181);
  });
  it('two phones with different unstamped weigh-ins for a day settle on the cloud\'s', () => {
    const a = phone([], [{ date: day.date, weight: 180 }]), b = phone([], [{ date: day.date, weight: 182 }]), c = cloudOf();
    for (let poll = 0; poll < 3; poll++) { sync(a, c, NOW + poll); sync(b, c, NOW + poll); }
    expect([a.body[0].weight, b.body[0].weight, c.doc!.body[0].weight]).toEqual([180, 180, 180]);
    expect(c.writes).toBe(1);
  });
});

describe('meta deletes (round 10)', () => {
  const old = { key: 'bench press', repMin: 6, repMax: 10 }, renamed = { key: 'flat bench', repMin: 6, repMax: 10 };
  it('a lift renamed on one phone: its old settings leave the cloud and the other phone, and never come back', () => {
    const first = mergeMeta({ 'settings:bench press': old }, null, {});
    // A renames: the old key goes, the new one comes.
    const a1 = mergeMeta({ 'settings:flat bench': renamed }, first.items, first.seen);
    expect(a1.items).toEqual({ 'settings:flat bench': renamed });
    expect(a1).toMatchObject({ pull: {}, remove: [], changed: true });
    // B still has the old settings, unchanged since its last sync: they go there too.
    const b1 = mergeMeta({ 'settings:bench press': old }, a1.items, first.seen);
    expect(b1).toMatchObject({ items: { 'settings:flat bench': renamed }, pull: { 'settings:flat bench': renamed }, remove: ['settings:bench press'], changed: false });
    // Further syncs on both phones change nothing.
    const a2 = mergeMeta({ 'settings:flat bench': renamed }, a1.items, a1.seen), b2 = mergeMeta({ 'settings:flat bench': renamed }, a1.items, b1.seen);
    for (const r of [a2, b2]) expect(r).toMatchObject({ items: { 'settings:flat bench': renamed }, pull: {}, remove: [], changed: false });
  });
  it('an edit on the other phone beats a delete, both ways round', () => {
    const first = mergeMeta({ 'settings:bench press': old }, null, {});
    const edited = { ...old, repMax: 12 };
    // Deleted here, edited in the cloud since: it comes back, edited.
    expect(mergeMeta({}, { 'settings:bench press': edited }, first.seen))
      .toMatchObject({ items: { 'settings:bench press': edited }, pull: { 'settings:bench press': edited }, remove: [] });
    // Edited here, deleted in the cloud since: it goes back up.
    expect(mergeMeta({ 'settings:bench press': edited }, {}, first.seen))
      .toMatchObject({ items: { 'settings:bench press': edited }, pull: {}, remove: [], changed: true });
  });
  it('a first sync never deletes: it takes the union', () => {
    expect(mergeMeta({}, { 'settings:bench press': old }, {})).toMatchObject({ pull: { 'settings:bench press': old }, remove: [] });
    expect(mergeMeta({ 'settings:bench press': old }, {}, {})).toMatchObject({ items: { 'settings:bench press': old }, remove: [] });
  });
  it('day plans, name mappings and gyms delete the same way; the program and profile, which have no delete, never do', () => {
    const items = { 'day:2026-10-01': { key: 'day:2026-10-01', skips: [] }, 'alias:pushdowns': 'Cable Pushdown', gyms: { gyms: [{ id: 'g1' }] }, program: { key: 'program' }, profile: { key: 'profile' } };
    const first = mergeMeta(items, null, {});
    const r = mergeMeta(items, {}, first.seen); // all gone from the cloud
    expect(r.remove.sort()).toEqual(['alias:pushdowns', 'day:2026-10-01', 'gyms']);
    expect(Object.keys(r.items).sort()).toEqual(['profile', 'program']);
  });
});
