import { describe, expect, it, vi } from 'vitest';
vi.mock('../push/client', () => ({ notifyFriend: () => {} }));
import { claimUsername, ensureCreatedAt, friendState, listFriends, listRequests, myProfile, readVerified, setDisplayName, setVerified } from './friends';
import { readTags, saveTag } from './tags';
import { deleteCloudData } from './sync';
import { fakeFirestore, ts } from './fakeFirestore';

const DAY = 864e5;

describe('claimUsername', () => {
  it('a first name: the name and the profile, no previous name, and when it was made (the server’s time)', async () => {
    const w = fakeFirestore();
    await claimUsername(w.cloud, 'a', 'alice');
    expect(w.docs['usernames/alice']).toEqual({ uid: 'a' });
    const { createdAt, ...rest } = w.docs['users/a'];
    expect(rest).toEqual({ username: 'alice', displayName: 'alice' });
    expect((createdAt as { toMillis(): number }).toMillis()).toBeGreaterThan(Date.now() - 5000);
  });
  it('a change keeps a display name and everything beside it; with none (the old shape) it follows the name', async () => {
    const [t1, t2, t5] = [ts(1), ts(2), ts(5)];
    const w = fakeFirestore({
      'usernames/alice': { uid: 'a' }, 'users/a': { username: 'alice', displayName: 'Alice K.', nameAt: t5, createdAt: t1 },
      'usernames/bob': { uid: 'b' }, 'users/b': { username: 'bob', displayName: 'bob', createdAt: t2 },
    });
    await claimUsername(w.cloud, 'a', 'alice_k');
    expect(w.docs['users/a']).toMatchObject({ username: 'alice_k', displayName: 'Alice K.', prev: 'alice', nameAt: t5, createdAt: t1 });
    await claimUsername(w.cloud, 'b', 'bobby');
    expect(w.docs['users/b']).toMatchObject({ username: 'bobby', displayName: 'bobby', prev: 'bob', createdAt: t2 });
  });
  it('a change: the new name claimed, the old one released, the profile with what it was and when, in one go', async () => {
    const w = fakeFirestore({ 'usernames/alice': { uid: 'a' }, 'users/a': { username: 'alice', displayName: 'alice' } });
    await claimUsername(w.cloud, 'a', 'alice_k');
    expect(w.docs['usernames/alice_k']).toEqual({ uid: 'a' });
    expect(w.docs['usernames/alice']).toBeUndefined();
    expect(w.docs['users/a']).toMatchObject({ username: 'alice_k', displayName: 'alice_k', prev: 'alice' });
    expect((w.docs['users/a'].changedAt as { toMillis(): number }).toMillis()).toBeGreaterThan(Date.now() - 5000);
  });
  it('a name someone else holds is refused, and nothing changes', async () => {
    const w = fakeFirestore({ 'usernames/alice': { uid: 'a' }, 'users/a': { username: 'alice', displayName: 'alice' }, 'usernames/bob': { uid: 'b' } });
    await expect(claimUsername(w.cloud, 'a', 'bob')).rejects.toThrow('“bob” is taken');
    expect(w.docs['usernames/alice']).toEqual({ uid: 'a' });
    expect(w.docs['users/a'].username).toBe('alice');
  });
  it('the same name again: nothing to do', async () => {
    const w = fakeFirestore({ 'usernames/alice': { uid: 'a' }, 'users/a': { username: 'alice', displayName: 'alice' } });
    await claimUsername(w.cloud, 'a', 'alice');
    expect(w.docs['users/a']).toEqual({ username: 'alice', displayName: 'alice' });
  });
  it('within a day of the last change: says when it can change again, and writes nothing', async () => {
    const at = Date.now() - 3600_000;
    const w = fakeFirestore({ 'usernames/alice_k': { uid: 'a' }, 'users/a': { username: 'alice_k', displayName: 'alice_k', prev: 'alice', changedAt: ts(at) } });
    await expect(claimUsername(w.cloud, 'a', 'alice_z')).rejects.toThrow(/once a day/);
    expect(w.docs['usernames/alice_z']).toBeUndefined();
    expect(w.docs['users/a'].username).toBe('alice_k');
    // A day on, it goes.
    w.docs['users/a'].changedAt = ts(Date.now() - DAY - 1000);
    await claimUsername(w.cloud, 'a', 'alice_z');
    expect(w.docs['users/a']).toMatchObject({ username: 'alice_z', prev: 'alice_k' });
  });
  it('the server refusing a change (its clock said too soon) reads as the once-a-day rule', async () => {
    const w = fakeFirestore({ 'usernames/alice': { uid: 'a' }, 'users/a': { username: 'alice', displayName: 'alice' } });
    const run = w.cloud.F.runTransaction;
    // The transaction runs as written, and the commit is refused.
    (w.cloud.F as { runTransaction: unknown }).runTransaction = async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      await fn({ get: async (r: { path: string }) => ({ exists: () => r.path in w.docs, data: () => w.docs[r.path] }), set: () => {}, update: () => {}, delete: () => {} });
      throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    };
    await expect(claimUsername(w.cloud, 'a', 'alice_k')).rejects.toThrow(/once a day/);
    (w.cloud.F as { runTransaction: unknown }).runTransaction = run;
    expect(w.docs['users/a'].username).toBe('alice');
  });
});

describe('names follow the uid, never the name', () => {
  const world = () => fakeFirestore({
    'users/me': { username: 'me', displayName: 'me' },
    'users/b': { username: 'bobby', displayName: 'bobby', prev: 'bob', changedAt: ts(Date.now() - DAY) },
    'users/c': { username: 'carl', displayName: 'carl' },
    'users/me/friends/b': { since: 1 },
    'users/me/requests/c': { username: 'carl_old', sent: 1 },
  });
  it('a friend shows by their name now, with what it was and when it changed', async () => {
    const [f] = await listFriends(world().cloud, 'me');
    expect(f).toMatchObject({ uid: 'b', name: 'bobby', prev: 'bob' });
    expect(f.changedAt).toBeGreaterThan(Date.now() - DAY - 5000);
  });
  it('a request shows its sender’s name now, not the one it was sent under', async () => {
    expect(await listRequests(world().cloud, 'me')).toEqual([{ uid: 'c', name: 'carl' }]);
  });
  it('a request from a profile since deleted keeps the name it was sent under', async () => {
    const w = world();
    delete w.docs['users/c'];
    expect(await listRequests(w.cloud, 'me')).toEqual([{ uid: 'c', name: 'carl_old' }]);
  });
  it('your own profile: name, and when it last changed', async () => {
    const w = world();
    expect(await myProfile(w.cloud, 'me')).toEqual({ name: 'me' });
    expect(await myProfile(w.cloud, 'b')).toMatchObject({ name: 'bobby', prev: 'bob' });
    expect(await myProfile(w.cloud, 'nobody')).toBeNull();
  });
});

describe('display names', () => {
  const now = () => fakeFirestore({ 'users/a': { username: 'alice', displayName: 'alice' }, 'users/me/friends/a': { since: 1 }, 'users/me/requests/a': { username: 'alice', sent: 1 } });
  it('set, cleaned as typed, with the server’s time; friends, requests and a thread see it beside the name', async () => {
    const w = now();
    expect(await setDisplayName(w.cloud, 'a', '  Alice   K. ')).toBe('Alice K.');
    expect(w.docs['users/a']).toMatchObject({ username: 'alice', displayName: 'Alice K.' });
    expect((w.docs['users/a'].nameAt as { toMillis(): number }).toMillis()).toBeGreaterThan(Date.now() - 5000);
    expect(await myProfile(w.cloud, 'a')).toMatchObject({ name: 'alice', dn: 'Alice K.' });
    expect((await listFriends(w.cloud, 'me'))[0]).toMatchObject({ uid: 'a', name: 'alice', dn: 'Alice K.' });
    expect(await listRequests(w.cloud, 'me')).toEqual([{ uid: 'a', name: 'alice', dn: 'Alice K.' }]);
    expect(await friendState(w.cloud, 'me', 'a')).toEqual({ name: 'alice', dn: 'Alice K.', friend: true, muted: false });
  });
  it('none shows none: the old shape, or the username itself', async () => {
    const w = now();
    expect(await myProfile(w.cloud, 'a')).toEqual({ name: 'alice' });
    expect((await listFriends(w.cloud, 'me'))[0]).toEqual({ uid: 'a', name: 'alice', since: 1 });
  });
  it('refused as the form refuses it, and nothing is written', async () => {
    const w = now();
    for (const bad of ['Alice @alice', 'Alice ✓', 'Admin', 'www.x.com', 'x'.repeat(31)]) await expect(setDisplayName(w.cloud, 'a', bad), bad).rejects.toThrow();
    expect(w.docs['users/a']).toEqual({ username: 'alice', displayName: 'alice' });
  });
  it('once a day: says when, and writes nothing; clearing counts as a change; the same name again writes nothing', async () => {
    const w = now();
    await setDisplayName(w.cloud, 'a', 'Alice K.');
    const at = w.docs['users/a'].nameAt;
    expect(await setDisplayName(w.cloud, 'a', 'Alice K.')).toBe('Alice K.');
    await expect(setDisplayName(w.cloud, 'a', 'Al')).rejects.toThrow(/display name once a day/);
    await expect(setDisplayName(w.cloud, 'a', '')).rejects.toThrow(/once a day/);
    expect(w.docs['users/a']).toMatchObject({ displayName: 'Alice K.', nameAt: at });
    w.docs['users/a'].nameAt = ts(Date.now() - DAY - 1000);
    expect(await setDisplayName(w.cloud, 'a', '')).toBe('');
    expect(w.docs['users/a'].displayName).toBe('alice'); // cleared: the old shape
    expect((await myProfile(w.cloud, 'a'))?.dn).toBeUndefined();
  });
  it('the server refusing (its clock said too soon) reads as the once-a-day rule', async () => {
    const w = now();
    w.docs['users/a'].nameAt = ts(Date.now() - DAY - 1000);
    (w.cloud.F as { updateDoc: unknown }).updateDoc = async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); };
    await expect(setDisplayName(w.cloud, 'a', 'Alice K.')).rejects.toThrow(/display name once a day/);
  });
  it('no username yet: nothing to name', async () => {
    await expect(setDisplayName(fakeFirestore().cloud, 'a', 'Alice')).rejects.toThrow(/username first/);
  });
});

describe('createdAt backfill', () => {
  it('a profile from before it gets the server’s time now; one that has it is left alone; none, nothing', async () => {
    const t7 = ts(7);
    const w = fakeFirestore({ 'users/a': { username: 'alice', displayName: 'alice' }, 'users/b': { username: 'bob', displayName: 'bob', createdAt: t7 } });
    await ensureCreatedAt(w.cloud, 'a', await myProfile(w.cloud, 'a'));
    expect((w.docs['users/a'].createdAt as { toMillis(): number }).toMillis()).toBeGreaterThan(Date.now() - 5000);
    await ensureCreatedAt(w.cloud, 'b', await myProfile(w.cloud, 'b'));
    expect(w.docs['users/b'].createdAt).toBe(t7);
    await ensureCreatedAt(w.cloud, 'c', null);
    expect(w.docs['users/c']).toBeUndefined();
  });
});

describe('the ✓ (config/verified)', () => {
  it('read as uid → when; none yet reads as none', async () => {
    expect(await readVerified(fakeFirestore().cloud)).toEqual({});
    expect(await readVerified(fakeFirestore({ 'config/verified': { uids: { a: ts(9), b: 'junk' } } }).cloud)).toEqual({ a: 9, b: 0 });
  });
  it('granted and removed, the rest kept; the same again writes nothing', async () => {
    const w = fakeFirestore({ 'config/verified': { uids: { b: ts(3) } } });
    await setVerified(w.cloud, 'a', true);
    expect(Object.keys(await readVerified(w.cloud)).sort()).toEqual(['a', 'b']);
    const before = w.docs['config/verified'];
    await setVerified(w.cloud, 'a', true);
    expect(w.docs['config/verified']).toBe(before);
    await setVerified(w.cloud, 'a', false);
    expect(await readVerified(w.cloud)).toEqual({ b: 3 });
    await setVerified(w.cloud, 'z', false);
    expect(await readVerified(w.cloud)).toEqual({ b: 3 });
  });
});

describe('tags (users/{me}/private/tags)', () => {
  it('kept by uid, read back, cleaned; an empty tag removes it', async () => {
    const w = fakeFirestore();
    expect(await readTags(w.cloud, 'me')).toEqual({});
    await saveTag(w.cloud, 'me', 'b', '  Bob   (gym) ');
    await saveTag(w.cloud, 'me', 'c', 'Carl');
    expect(await readTags(w.cloud, 'me')).toEqual({ b: 'Bob (gym)', c: 'Carl' });
    expect(Object.keys(w.docs)).toEqual(['users/me/private/tags']);
    await saveTag(w.cloud, 'me', 'b', '   ');
    expect(await readTags(w.cloud, 'me')).toEqual({ c: 'Carl' });
  });
  it('ignores anything in the document that isn’t a uid’s tag', async () => {
    const w = fakeFirestore({ 'users/me/private/tags': { tags: { b: 'Bob', c: 5, d: '' }, updatedAt: 1 } });
    expect(await readTags(w.cloud, 'me')).toEqual({ b: 'Bob' });
  });
});

describe('deleting the account', () => {
  it('releases the name in the same write as the profile (the rules release a name only as its profile stops going by it)', async () => {
    const w = fakeFirestore({ 'users/a': { username: 'alice', displayName: 'alice' }, 'usernames/alice': { uid: 'a' }, 'users/a/meta/profile': { items: {} } });
    const batches: string[][] = [];
    const real = w.cloud.F.writeBatch;
    (w.cloud.F as { writeBatch: unknown }).writeBatch = (db: unknown) => {
      const b = (real as (db: unknown) => { delete(r: { path: string }): unknown; commit(): Promise<void> })(db), mine: string[] = [];
      batches.push(mine);
      return { delete: (r: { path: string }) => { mine.push(r.path); b.delete(r); }, commit: () => b.commit() };
    };
    await deleteCloudData(w.cloud, 'a');
    expect(batches.find((b) => b.includes('usernames/alice'))).toContain('users/a');
    expect(w.docs).toEqual({});
  });
});
