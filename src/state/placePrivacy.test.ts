import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, resetDbForTests } from '../db/db';
import { phoneApply, syncCloud } from '../cloud/sync';
import { readMeta } from '../cloud/meta';
import { fakeFirestore } from '../cloud/fakeFirestore';
import { geohash, neighbours } from '../domain/place';
import { defaultProfile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { placeFor } from './usePlace';

// Location for Together: no point or cell ever leaves the phone (owner 2026-10-29). A visit's fix, taken as the app takes it,
// saved as the app saves it, then synced: the account gets the codes and nothing that says where. Synthetic point and keys.

const NOW = Date.parse('2026-11-02T18:30:00Z');
const AT = { latitude: 40.748441, longitude: -73.985664 };
const MINE = 'minemineminemineminem1', THEIRS = ['theirstheirstheirsthe2', 'otherotherotherothero3'];
const S: SetEntry = { id: 'app|2026-11-02|bench press|1', date: '2026-11-02', seq: NOW - 60_000, loggedAt: new Date(NOW - 60_000).toISOString(), exercise: 'Bench Press', setNo: 1, weight: 135, reps: 8, flags: [], source: 'app', gym: 'Iron Den' };
/** The phone's location, as a page gets it: a full-precision point. */
const geo = { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { ...AT, accuracy: 35 }, timestamp: NOW } as GeolocationPosition) } as unknown as Geolocation;

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

describe('Location for Together: the point stays on the phone', () => {
  it('what the sync writes holds the codes and none of the point, its cell or the cells around it; nor does the phone', async () => {
    const db = boundDb('main');
    await db.putProfile({ ...defaultProfile(), placeKey: MINE });
    await db.putSet(S);
    const loc = await placeFor(S, MINE, THEIRS, geo);
    expect(loc).toMatch(/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{128}$/);
    await db.putSet({ ...S, loc: loc!, editedAt: NOW });
    const f = fakeFirestore();
    await syncCloud(f.cloud, 'u1', { ...(await db.getSyncSnapshot()), seen: {}, meta: await readMeta(db), metaSeen: { items: {}, at: 0 } }, phoneApply(db), NOW);
    const sent = JSON.stringify(f.docs), kept = JSON.stringify(await db.getAllSets());
    // The check reads what went up: the month with the set and its codes, and the profile with its key.
    expect(f.docs['users/u1/months/2026-11']).toBeDefined();
    expect(sent).toContain(loc);
    expect(sent).toContain(MINE);
    const cell = geohash(AT.latitude, AT.longitude);
    const where = [String(AT.latitude), String(AT.longitude), '40.74', '73.98', '4074', '7398', cell, ...neighbours(cell)].flatMap((c) => [c, c.slice(0, 5)]);
    for (const x of where) {
      expect(sent, x).not.toContain(x);
      expect(kept, x).not.toContain(x);
    }
  });
  it('no friend with it on: no fix is asked for at all', async () => {
    let asked = 0;
    const counting = { getCurrentPosition: (ok: PositionCallback) => { asked++; ok({ coords: AT } as GeolocationPosition); } } as unknown as Geolocation;
    expect(await placeFor(S, MINE, [], counting)).toBeNull();
    expect(asked).toBe(0);
  });
  it('a fix refused or not to be had: no codes', async () => {
    const refused = { getCurrentPosition: (_: PositionCallback, no: PositionErrorCallback) => no({ code: 1 } as GeolocationPositionError) } as unknown as Geolocation;
    expect(await placeFor(S, MINE, THEIRS, refused)).toBeNull();
  });
});
