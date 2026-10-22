import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbForTests } from '../db/db';
import { fakeFirestore, ts } from '../cloud/fakeFirestore';
import { CACHE_MS, FULL_MS, PAGE, POST_DAYS_MS } from '../domain/board';
import { morePosts, noteLike, notePost, openBoard, resetBoardForTests } from './board';
import { patchFriendCache, peekFriendCache, resetFriendCacheForTests } from './friendCache';

// What the board costs in reads (plan §2's table): a cold open is a page of 20, your gate document and your notice (22; 23 when
// the ✓s weren't read yet); within a minute nothing; after it, with nothing new, one query and the notice (2).

vi.mock('../cloud/firebase', () => ({ loadCloud: async () => { throw new Error('not here'); } }));

const NOW = Date.parse('2026-10-22T18:00:00Z');
const post = (i: number, at: number, over: Record<string, unknown> = {}) => ({ uid: `u${i % 3}`, name: `U${i % 3}`, user: `u${i % 3}`, t: `post ${i}`, at: ts(at), reports: 0, likes: 0, ...over });
/** `n` posts, the newest 10 minutes ago, one an hour before each other. */
function world(n = 25) {
  const docs: Record<string, Record<string, unknown>> = {
    'users/me/private/board': { ok: true, hidden: [], muted: [] },
    'config/verified': { uids: { u1: ts(1) } },
  };
  for (let i = 0; i < n; i++) docs[`board/p${String(i).padStart(3, '0')}`] = post(i, NOW - 10 * 60_000 - i * 3600_000);
  return fakeFirestore(docs);
}

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); resetFriendCacheForTests(); resetBoardForTests(); });

describe('the board’s reads', () => {
  it('cold: a page, your gate document, your notice and the ✓s (23); 22 when the Friends lists already read the ✓s', async () => {
    const w = world();
    const b = await openBoard(w.cloud, 'me', { now: NOW });
    expect(w.take()).toBe(PAGE + 3);
    expect(b.posts).toHaveLength(PAGE);
    expect(b.posts[0].t).toBe('post 0');
    expect(b.end).toBe(false);
    expect(b.mine?.ok).toBe(true);
    expect(b.verified).toEqual({ u1: 1 });

    resetFriendCacheForTests(); resetBoardForTests(); globalThis.indexedDB = new IDBFactory(); resetDbForTests();
    await patchFriendCache('me', (c) => ({ ...c, lists: { at: NOW, me: 'me', verified: { u1: 1 }, friends: [], requests: [], invite: null, sentGyms: [], blocked: [] } }));
    await openBoard(w.cloud, 'me', { now: NOW });
    expect(w.take()).toBe(PAGE + 2);
  });

  it('within a minute: nothing read; after it with nothing new: one query and the notice (2); a new post: one more', async () => {
    const w = world();
    await openBoard(w.cloud, 'me', { now: NOW });
    w.take();
    await openBoard(w.cloud, 'me', { now: NOW + CACHE_MS - 1 });
    expect(w.take()).toBe(0);
    const b = await openBoard(w.cloud, 'me', { now: NOW + CACHE_MS });
    expect(w.take()).toBe(2);
    expect(b.posts).toHaveLength(PAGE);
    w.docs['board/new'] = post(99, NOW + 2 * CACHE_MS, { t: 'fresh' });
    const c = await openBoard(w.cloud, 'me', { now: NOW + 3 * CACHE_MS });
    // The new post, the newest kept (read again from a minute before it: a post the server timed a little earlier isn't missed), the notice.
    expect(w.take()).toBe(3);
    expect(c.posts.map((p) => p.t).slice(0, 2)).toEqual(['fresh', 'post 0']);
    expect(c.posts).toHaveLength(PAGE + 1);
  });

  it('over 15 minutes old, or pulled: the first page whole again (with the gate document only when pulled)', async () => {
    const w = world();
    await openBoard(w.cloud, 'me', { now: NOW });
    w.take();
    await openBoard(w.cloud, 'me', { now: NOW + FULL_MS });
    expect(w.take()).toBe(PAGE + 1);
    await openBoard(w.cloud, 'me', { now: NOW + FULL_MS + 1, force: true });
    expect(w.take()).toBe(PAGE + 3);
  });

  it('a page or more new since: kept as the first page, what was kept after it dropped (no hole in the middle)', async () => {
    const w = world(5);
    await openBoard(w.cloud, 'me', { now: NOW });
    for (let i = 0; i < PAGE; i++) w.docs[`board/n${String(i).padStart(3, '0')}`] = post(i, NOW + 60_000 + i * 1000, { t: `new ${i}` });
    const b = await openBoard(w.cloud, 'me', { now: NOW + 2 * CACHE_MS });
    expect(b.posts).toHaveLength(PAGE);
    expect(b.posts.every((p) => p.t.startsWith('new'))).toBe(true);
    expect(b.end).toBe(false);
  });

  it('older posts: the next page after the oldest kept, and the end once a page comes back short', async () => {
    const w = world(25);
    await openBoard(w.cloud, 'me', { now: NOW });
    w.take();
    const b = await morePosts(w.cloud, 'me', NOW);
    expect(w.take()).toBe(5);
    expect(b.posts).toHaveLength(25);
    expect(b.end).toBe(true);
    await morePosts(w.cloud, 'me', NOW);
    expect(w.take()).toBe(0);
  });

  it('nothing over 30 days old is read; your own posts that old are deleted by id, with no read', async () => {
    const w = world(0);
    w.docs['board/old'] = post(1, NOW - POST_DAYS_MS - 1000, { uid: 'me', user: 'me' });
    w.docs['board/ok'] = post(2, NOW - 1000);
    await notePost('me', { id: 'old', uid: 'me', name: 'me', user: 'me', t: 'x', at: NOW - POST_DAYS_MS - 1000, reports: 0, likes: 0 });
    const b = await openBoard(w.cloud, 'me', { now: NOW, force: true });
    expect(b.posts.map((p) => p.id)).toEqual(['ok']);
    await new Promise((r) => setTimeout(r, 0));
    expect(w.docs['board/old']).toBeUndefined();
    expect(peekFriendCache('me')?.board?.own).toEqual([]);
  });

  it('a 💪 counts once from this phone, and taking it back takes one off', async () => {
    const w = world(1);
    await openBoard(w.cloud, 'me', { now: NOW });
    await noteLike('me', 'p000', true);
    await noteLike('me', 'p000', true);
    expect(peekFriendCache('me')?.board?.posts[0].likes).toBe(1);
    await noteLike('me', 'p000', false);
    expect(peekFriendCache('me')?.board?.posts[0].likes).toBe(0);
    expect(peekFriendCache('me')?.board?.liked).toEqual([]);
  });
});
