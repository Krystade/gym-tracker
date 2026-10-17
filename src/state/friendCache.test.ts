import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbForTests } from '../db/db';
import type { FriendNews } from '../cloud/friends';
import {
  flushFriendCache, forgetFriendCaches, hydrateFriendCache, orbitRange, patchFriendCache, peekFriendCache, pruneTo, readLocally, resetFriendCacheForTests,
  STALE_MS, staleWindow, threadsBehind, type FriendCache,
} from './friendCache';

const NOW = Date.parse('2026-10-17T18:00:00Z');
const empty = (uid = 'me'): FriendCache => ({ uid, windows: {}, threads: {} });
const news = (over: Partial<FriendNews> = {}): FriendNews & { at: number } => ({
  at: NOW, requests: 0, gyms: 0, total: 0, unread: {}, latest: {}, top: null, muted: [], ...over,
});

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); resetFriendCacheForTests(); });

describe('friend cache: what counts as stale', () => {
  it('reads a friend’s Orbit line again when it’s missing, 5 minutes old, or for another span of days', () => {
    const { from, to } = orbitRange('2026-10-17');
    expect([from, to]).toEqual(['2026-08-23', '2026-10-17']); // 56 days, today included
    const w = { at: NOW - 60_000, from, to, win: { sets: [], status: '' } };
    expect(staleWindow(undefined, from, to, NOW)).toBe(true);
    expect(staleWindow(w, from, to, NOW)).toBe(false);
    expect(staleWindow({ ...w, at: NOW - STALE_MS - 1 }, from, to, NOW)).toBe(true);
    expect(staleWindow(w, orbitRange('2026-10-18').from, '2026-10-18', NOW)).toBe(true); // a new day
  });

  it('reads a thread again when its friend sent something newer than the newest of theirs it holds', () => {
    const item = (id: string, mine: boolean, at: number) => ({ id, mine, at, kind: 'm' as const, text: id });
    const c: FriendCache = {
      ...empty(),
      news: news({ latest: { jake: { text: 'yo', at: 300 }, ana: { text: '💪', at: 100 }, sam: { text: 'hi', at: 50 } } }),
      threads: {
        jake: { at: NOW, items: [item('a', false, 200), item('b', true, 400)], gyms: [] }, // mine at 400 doesn't count: theirs is 200 < 300
        ana: { at: NOW, items: [item('c', false, 100)], gyms: [] }, // up to date
        // sam: never read
      },
    };
    expect(threadsBehind(c).sort()).toEqual(['jake', 'sam']);
    expect(threadsBehind(empty())).toEqual([]);
  });
});

describe('friend cache: changes', () => {
  it('drops the lines and threads of anyone no longer a friend', () => {
    const w = { at: NOW, from: 'a', to: 'b', win: { sets: [], status: 'x' } };
    const t = { at: NOW, items: [], gyms: [] };
    const c = pruneTo({ ...empty(), windows: { jake: w, gone: w }, threads: { jake: t, gone: t } }, ['jake']);
    expect(Object.keys(c.windows)).toEqual(['jake']);
    expect(Object.keys(c.threads)).toEqual(['jake']);
  });

  it('opening a thread clears that friend’s unread at once (and the banner, if it was theirs), before news is read again', () => {
    const c = { ...empty(), news: news({ requests: 1, total: 4, unread: { jake: 2, ana: 1 }, top: { uid: 'jake', name: 'jake', text: 'yo' } }) };
    const r = readLocally(c, 'jake');
    expect(r.news).toMatchObject({ total: 2, unread: { ana: 1 }, top: null, requests: 1 });
    expect(readLocally(c, 'ana').news).toMatchObject({ total: 3, unread: { jake: 2 }, top: { uid: 'jake' } });
    expect(readLocally(empty(), 'jake')).toEqual(empty());
  });
});

describe('friend cache: kept on the phone', () => {
  it('a change is saved, and a fresh start reads it back before anything is fetched', async () => {
    expect(await hydrateFriendCache('me')).toEqual(empty());
    await patchFriendCache('me', (c) => ({ ...c, news: news({ total: 3 }), windows: { jake: { at: NOW, from: 'a', to: 'b', win: { sets: [], status: 'Deload' } } } }));
    expect(peekFriendCache('me')?.news?.total).toBe(3);
    await flushFriendCache();
    resetFriendCacheForTests(); // the app closed: nothing in memory
    expect(peekFriendCache('me')).toBeUndefined();
    const back = await hydrateFriendCache('me');
    expect(back.news?.total).toBe(3);
    expect(back.windows.jake.win.status).toBe('Deload');
    expect(back).not.toHaveProperty('key');
    // Another account on the same phone starts empty.
    expect(await hydrateFriendCache('other')).toEqual(empty('other'));
  });

  it('a change made while the saved copy is still being read lands on top of it', async () => {
    await patchFriendCache('me', (c) => ({ ...c, news: news({ total: 1 }) }));
    await flushFriendCache();
    resetFriendCacheForTests();
    await patchFriendCache('me', (c) => ({ ...c, threads: { jake: { at: NOW, items: [], gyms: [] } } }));
    const c = peekFriendCache('me')!;
    expect(c.news?.total).toBe(1);
    expect(Object.keys(c.threads)).toEqual(['jake']);
  });

  it('signing out forgets every account’s friends, in memory and on the phone', async () => {
    await patchFriendCache('me', (c) => ({ ...c, news: news({ total: 1 }) }));
    await flushFriendCache();
    await forgetFriendCaches();
    expect(peekFriendCache('me')).toBeUndefined();
    resetFriendCacheForTests();
    expect(await hydrateFriendCache('me')).toEqual(empty());
  });
});
