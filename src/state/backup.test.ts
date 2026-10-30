import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, resetDbForTests, type ProfileDb } from '../db/db';
import { exportBackup, restoreBackup } from './useBackup';
import { backupDue, parseBackup, unbackedPhotos } from '../domain/backup';
import { readBuddyMeta } from '../cloud/meta';
import { BUDDIES } from '../domain/buddies/roster';
import { starter } from '../domain/buddies/gacha';
import { changeLift } from '../domain/dayEdit';
import type { SetEntry } from '../domain/types';
import type { PhotoMeta } from '../domain/photos';

// The backup file through the database: what one phone exports an empty one restores whole, and restoring it again changes
// nothing. Synthetic sets, bytes and buddies only.

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

const AT = new Date('2026-10-29T12:00:00Z'), NOW = AT.getTime();
const S = (n: number, x: Partial<SetEntry> = {}): SetEntry => ({ id: `app|2026-10-0${n}|bench press|1`, date: `2026-10-0${n}`, seq: NOW - 9e6 + n, exercise: 'Bench Press',
  setNo: 1, weight: 135 + n, reps: 8, flags: [], source: 'app', ...x });
/** Every byte value, over more than one 32 KB chunk of the base64 encoder. */
const bytes = (seed: number) => Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31 + seed) % 256);
const photo = (date: string, pose: 'front' | 'side', variant: 'relaxed' | 'flexed' = 'relaxed'): PhotoMeta =>
  ({ id: `${date}:${pose}:${variant}`, date, pose, variant, width: 3, height: 4, addedAt: `${date}T08:00:00.000Z` });
const [B0] = BUDDIES.filter((b) => b.rarity === 0).map((b) => b.id);

async function aPhone(db: ProfileDb) {
  await db.putMany([S(1), S(2), S(3, { id: 'notes|2026-10-03|cable row|1', exercise: 'Cable Row', source: 'notes', seq: 4 })]);
  // A lift fixed in History keeps its id under its new name (domain/dayEdit): the restore must know it by that id still.
  await db.putSet({ ...changeLift([S(4)], 'Bench Press', 'Incline Bench Press')[0], editedAt: NOW - 3000 });
  await db.deleteSetWithTombstone(S(2).id, NOW - 2000);
  await db.putBodyMany([{ date: '2026-10-01', weight: 180.4, at: { weight: NOW - 5000 } }, { date: '2026-10-02', calories: 2400, protein: 160, energy: 4 }]);
  await db.putBuddyPrefs(B0, { name: 'Rex' }, 5);
  await db.putBuddyLead(B0, 7);
  await db.startBuddies('2026-10-01');
  await db.addSpend(starter(B0, 1000, '2026-10-01', 's1'));
  await db.putPhoto(photo('2026-10-01', 'front'), new Blob([bytes(1)], { type: 'image/jpeg' }), new Blob([bytes(2)], { type: 'image/jpeg' }));
  await db.putPhoto(photo('2026-10-08', 'side', 'flexed'), new Blob([bytes(3)], { type: 'image/jpeg' }), new Blob([bytes(4)], { type: 'image/jpeg' }));
}

/** Everything a backup carries, as the database has it, the images as base64 of their bytes. */
async function contents(db: ProfileDb) {
  const metas = (await db.getPhotoMetas()).sort((a, b) => a.id.localeCompare(b.id));
  const images = await Promise.all(metas.flatMap((m) => (['full', 'thumb'] as const).map(async (k) => Buffer.from(await (await db.getPhotoBlob(m.id, k))!.arrayBuffer()).toString('base64'))));
  return { sets: (await db.getAllSets()).sort((a, b) => a.id.localeCompare(b.id)), body: await db.getBody(), buddies: await readBuddyMeta(db), metas, images };
}

async function fileOf(db: ProfileDb) {
  const r = parseBackup(JSON.stringify(await exportBackup(db, 'Me', AT)));
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('the backup file', () => {
  it('restores a phone whole onto an empty one; a second restore, or one onto the phone it came from, adds nothing', async () => {
    const mine = boundDb('main'), empty = boundDb('p2');
    await aPhone(mine);
    const { backup, skipped } = await fileOf(mine);
    expect(skipped).toBe(0);
    expect(Object.keys(backup.deleted)).toEqual([S(2).id]);

    expect(await restoreBackup(empty, backup, 0, NOW)).toMatchObject({ sets: 3, body: 2, buddies: 4, photos: 2, removed: 0, held: 0, skipped: 0 });
    const want = await contents(mine);
    expect(want.sets).toHaveLength(3);
    expect(want.images).toHaveLength(4);
    expect(await contents(empty)).toEqual(want);
    expect(await empty.getBackupMark()).toEqual({ at: AT.toISOString(), photos: 2 });

    const none = { sets: 0, body: 0, buddies: 0, photos: 0, removed: 0, held: 0 };
    expect(await restoreBackup(empty, backup, 0, NOW)).toMatchObject(none);
    expect(await contents(empty)).toEqual(want);
    expect(await restoreBackup(mine, backup, 0, NOW)).toMatchObject(none);
    expect(await contents(mine)).toEqual(want);
  });

  it('a newer edit wins either way and this phone a tie; a delete made here since stays, one made where the backup was made goes', async () => {
    const db = boundDb('main');
    await db.putMany([S(1), S(2), S(3), S(4), S(5)]);
    const { backup } = await fileOf(db);
    await db.putSet({ ...S(1), weight: 200, editedAt: NOW + 1 }); // edited here since
    await db.deleteSetWithTombstone(S(2).id, NOW + 2); // deleted here since
    const file = {
      ...backup, deleted: { [S(4).id]: NOW + 4 },
      // S(3) edited there after; S(1) and S(5) changed there with no edit time, which loses to this phone's edit and ties with its log.
      sets: backup.sets.map((s) => (s.id === S(3).id ? { ...s, reps: 5, editedAt: NOW + 3 } : s.id === S(1).id || s.id === S(5).id ? { ...s, reps: 6 } : s)),
    };
    expect(await restoreBackup(db, file, 0, NOW + 10)).toMatchObject({ sets: 1, removed: 1 });
    expect((await db.getAllSets()).map((s) => `${s.id} ${s.weight}×${s.reps}`).sort()).toEqual([`${S(1).id} 200×8`, `${S(3).id} 138×5`, `${S(5).id} 140×8`]);
    // This phone's copies of what the file replaced or deleted, kept first.
    expect((await db.getReplaced()).length).toBe(2);
  });

  it('reads only what it should: another app’s JSON is refused, a set that doesn’t read is skipped and counted', () => {
    expect(parseBackup('{"items":{}}')).toEqual({ error: 'That isn’t a backup file.' });
    const r = parseBackup(JSON.stringify({ kind: 'gym-tracker-backup', v: 1, at: AT.toISOString(), person: 'Me', sets: [S(1), { ...S(2), flags: ['nope'] }], deleted: {}, body: [], buddies: {}, photos: [] }));
    expect('backup' in r && [r.backup.sets.length, r.skipped]).toEqual([1, 1]);
  });

  it('a file from before variants restores its photos as relaxed; a photo whose id isn’t its date, pose and variant is skipped', async () => {
    const db = boundDb('main');
    const b64 = (n: number) => Buffer.from(bytes(n)).toString('base64');
    const old = { meta: { id: '2026-10-01:front', date: '2026-10-01', pose: 'front', width: 3, height: 4, addedAt: 'x' }, type: 'image/jpeg', full: b64(1), thumb: b64(2) };
    const wrong = { ...old, meta: { ...photo('2026-10-02', 'side', 'flexed'), id: '2026-10-02:side:relaxed' } };
    const r = parseBackup(JSON.stringify({ kind: 'gym-tracker-backup', v: 1, at: AT.toISOString(), person: 'Me', sets: [], deleted: {}, body: [], buddies: {}, photos: [old, wrong] }));
    if ('error' in r) throw new Error(r.error);
    expect(r.skipped).toBe(1);
    expect(await restoreBackup(db, r.backup, r.skipped, NOW)).toMatchObject({ photos: 1, skipped: 1 });
    expect(await db.getPhotoMetas()).toEqual([{ ...old.meta, id: '2026-10-01:front:relaxed', variant: 'relaxed' }]);
    expect(Buffer.from(await (await db.getPhotoBlob('2026-10-01:front:relaxed', 'full'))!.arrayBuffer()).toString('base64')).toBe(b64(1));
  });

  it('nudges at 3 photos added since the last backup (or ever, with none), and again 3 after Not now', () => {
    const metas = [20, 21, 22, 23].map((d) => photo(`2026-10-${d}`, 'front'));
    expect(backupDue(metas.slice(0, 2), null)).toBe(false);
    expect(backupDue(metas.slice(0, 3), null)).toBe(true);
    const mark = { at: '2026-10-21T12:00:00.000Z', photos: 2 };
    expect(unbackedPhotos(metas, mark)).toBe(2);
    expect(backupDue(metas, mark)).toBe(false);
    const more = [...metas, photo('2026-10-24', 'side')];
    expect(backupDue(more, mark)).toBe(true);
    expect(backupDue(more, { ...mark, snoozed: '2026-10-23T12:00:00.000Z' })).toBe(false);
  });
});
