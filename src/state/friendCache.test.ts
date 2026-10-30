import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbForTests } from '../db/db';
import { listThread, type FriendNews } from '../cloud/friends';
import {
  flushFriendCache, forgetFriendCaches, hydrateFriendCache, crewRange, FULL_INBOX_MS, notePing, patchFriendCache, peekFriendCache, prefetchFriends, pruneTo, readLocally, refreshChangedThreads, refreshNews, refreshThread, refreshWindow,
  refreshSummaries, resetFriendCacheForTests, sameNews, STALE_MS, staleSummaries, staleWindow, threadsBehind, type FriendCache,
} from './friendCache';
import { fakeFirestore, ts } from '../cloud/fakeFirestore';

// The background read loads Firebase itself: here it gets the test's stand-in.
const cloudBox = vi.hoisted(() => ({ c: null as unknown }));
vi.mock('../cloud/firebase', () => ({ loadCloud: async () => cloudBox.c }));

const NOW = Date.parse('2026-10-17T18:00:00Z');
const empty = (uid = 'me'): FriendCache => ({ uid, windows: {}, threads: {} });
const news = (over: Partial<FriendNews> = {}): FriendNews & { at: number } => ({
  at: NOW, requests: 0, gyms: 0, total: 0, unread: {}, latest: {}, top: null, muted: [], ...over,
});

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); resetFriendCacheForTests(); });

describe('friend cache: what counts as stale', () => {
  it('reads a friend’s Crew line again when it’s missing, 5 minutes old, or for another span of days', () => {
    const { from, to } = crewRange('2026-10-17');
    expect([from, to]).toEqual(['2026-08-23', '2026-10-17']); // 56 days, today included
    const w = { at: NOW - 60_000, from, to, win: { sets: [], status: '' } };
    expect(staleWindow(undefined, from, to, NOW)).toBe(true);
    expect(staleWindow(w, from, to, NOW)).toBe(false);
    expect(staleWindow({ ...w, at: NOW - STALE_MS - 1 }, from, to, NOW)).toBe(true);
    expect(staleWindow(w, crewRange('2026-10-18').from, '2026-10-18', NOW)).toBe(true); // a new day
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

describe('friend cache: a reaction sent from a card', () => {
  it('goes into their kept thread with no read, once; a thread never read is left to be read whole', async () => {
    const ping = { id: 'p1', from: 'me', kind: 'p' as const, e: 'fire', at: NOW };
    await patchFriendCache('me', () => ({ ...empty(), threads: { ana: { at: NOW, items: [], gyms: [], mine: [] } } }));
    await notePing('me', 'ana', ping);
    await notePing('me', 'ana', ping);
    const t = peekFriendCache('me')!.threads.ana;
    expect(t.mine).toEqual([ping]);
    expect(t.items.map((i) => [i.mine, i.text])).toEqual([[true, '🔥']]);
    await notePing('me', 'sam', ping);
    expect(peekFriendCache('me')!.threads.sam).toBeUndefined();
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

describe('friend cache: the news the app shows', () => {
  it('counts the same news read again as the same, and anything it says differently as new', () => {
    expect(sameNews(news(), { ...news(), at: NOW + 60_000 })).toBe(true);
    expect(sameNews(news(), news({ requests: 1, total: 1 }))).toBe(false);
    expect(sameNews(news(), news({ unread: { f: 1 } }))).toBe(false);
    expect(sameNews(news(), news({ top: { uid: 'f', name: 'sam', text: 'hi' } }))).toBe(false);
    expect(sameNews(news(), null)).toBe(false);
    expect(sameNews(null, null)).toBe(true);
  });
});

describe('friend cache: the news read from Firestore (refreshNews)', () => {
  const T = Date.now(), H = 3600_000;
  const world = () => fakeFirestore({
    'users/jake': { username: 'jake' },
    'users/me/friends/jake': { since: 1 },
    'users/me/inbox/j1': { from: 'jake', kind: 'p', e: 'strong', at: ts(T - 2 * H) },
    'users/me/inbox/j2': { from: 'jake', kind: 'p', e: 'fire', at: ts(T - H) },
  });
  const inboxReads = (w: ReturnType<typeof world>) => w.log.filter((l) => l.path === 'users/me/inbox');

  it('reads the whole inbox once, keeps it, then only what came since; a day on, the whole inbox again', async () => {
    const w = world();
    await refreshNews(w.cloud, 'me');
    expect(inboxReads(w)).toEqual([{ path: 'users/me/inbox', n: 2 }]);
    expect(peekFriendCache('me')?.inbox?.items.map((d) => d.id).sort()).toEqual(['j1', 'j2']);
    w.take();
    w.docs['users/me/inbox/j3'] = { from: 'jake', kind: 'm', t: 'up?', at: ts(T) };
    const n = await refreshNews(w.cloud, 'me');
    expect(inboxReads(w)).toEqual([{ path: 'users/me/inbox', n: 2, filters: `at>${T - H - 60_000}` }]);
    expect(n.unread).toEqual({ jake: 3 });
    expect(n.latest.jake.text).toBe('up?');
    expect(peekFriendCache('me')?.inbox?.items).toHaveLength(3);
    // Kept on the phone: after the app is closed and opened again, still only what's new.
    await flushFriendCache();
    resetFriendCacheForTests();
    w.take();
    await refreshNews(w.cloud, 'me');
    expect(inboxReads(w)[0].filters).toBeDefined();
    // A day after the last whole read: whole again.
    await patchFriendCache('me', (c) => ({ ...c, inbox: { ...c.inbox!, full: Date.now() - FULL_INBOX_MS - 1 } }));
    w.take();
    await refreshNews(w.cloud, 'me');
    expect(inboxReads(w)).toEqual([{ path: 'users/me/inbox', n: 3 }]);
  });

  it('the banner’s name comes from the friends kept, with no read for it', async () => {
    const w = world();
    await patchFriendCache('me', (c) => ({ ...c, lists: { at: T, me: 'me', friends: [{ uid: 'jake', name: 'jake' }], requests: [], invite: null, sentGyms: [], blocked: [] } }));
    const n = await refreshNews(w.cloud, 'me');
    expect(n.top).toEqual({ uid: 'jake', name: 'jake', text: '🔥' });
    expect(w.log.some((l) => l.path === 'users/jake')).toBe(false);
  });

  it('signing out forgets the inbox with the rest', async () => {
    const w = world();
    await refreshNews(w.cloud, 'me');
    await flushFriendCache();
    await forgetFriendCaches();
    resetFriendCacheForTests();
    expect((await hydrateFriendCache('me')).inbox).toBeUndefined();
  });
});

describe('friend cache: the background read (prefetchFriends)', () => {
  const T = Date.now(), H = 3600_000, today = '2026-10-18';
  const world = () => fakeFirestore({
    'users/jake': { username: 'jake' }, 'users/ana': { username: 'ana' },
    'users/me/friends/jake': { since: 1 }, 'users/me/friends/ana': { since: 1 },
    'users/me/inbox/j1': { from: 'jake', kind: 'p', e: 'strong', at: ts(T - 2 * H) },
    'users/jake/inbox/m1': { from: 'me', kind: 'p', e: 'clap', at: ts(T - H) },
  });
  /** Which friends' threads a read asked for (cloud/friends listThread). */
  const threadsRead = (w: ReturnType<typeof world>) => [...new Set(w.log.flatMap((l) =>
    l.filters === 'from==me' ? [l.path.split('/')[1]] : l.path === 'users/me/inbox' && l.filters?.startsWith('from==') ? [l.filters.slice(6)] : []))].sort();
  /** Everything kept, as if read 6 minutes ago. */
  const age = () => patchFriendCache('me', (c) => ({
    ...c, threads: Object.fromEntries(Object.entries(c.threads).map(([k, t]) => [k, { ...t, at: t.at - 6 * 60_000 }])),
    windows: Object.fromEntries(Object.entries(c.windows).map(([k, x]) => [k, { ...x, at: x.at - 6 * 60_000 }])),
  }));

  /** Reads of what you sent a friend (their inbox, yours only), and of your inbox by sender: a thread's halves read whole. */
  const sentRead = (w: ReturnType<typeof world>) => [...new Set(w.log.filter((l) => l.filters === 'from==me').map((l) => l.path.split('/')[1]))].sort();
  const theirsRead = (w: ReturnType<typeof world>) => w.log.filter((l) => l.path === 'users/me/inbox' && l.filters?.startsWith('from=='));

  it('reads a thread when it was never read or its friend sent something since, not every 5 minutes', async () => {
    const w = world();
    cloudBox.c = w.cloud;
    await prefetchFriends('me', today);
    expect(threadsRead(w)).toEqual(['ana', 'jake']); // never read
    await age();
    w.take();
    await prefetchFriends('me', today);
    expect(threadsRead(w)).toEqual([]); // nothing new from either
    w.docs['users/me/inbox/j2'] = { from: 'jake', kind: 'm', t: 'up?', at: ts(T) };
    await age();
    w.take();
    await prefetchFriends('me', today);
    // Built again from the inbox the news just read and what you sent as kept: no read of either half.
    expect(threadsRead(w)).toEqual([]);
    expect(peekFriendCache('me')?.threads.jake.items.map((i) => i.text)).toEqual(['💪', '👏', 'up?']);
    // Asked for (force): every thread again.
    w.take();
    await prefetchFriends('me', today, true);
    expect(sentRead(w)).toEqual(['ana', 'jake']);
  });

  it('a thread never read: only what you sent is read; their side and the gyms come from the news and lists just read', async () => {
    const w = world();
    cloudBox.c = w.cloud;
    await prefetchFriends('me', today);
    expect(sentRead(w)).toEqual(['ana', 'jake']);
    expect(theirsRead(w)).toEqual([]);
    expect(w.log.filter((l) => l.path === 'users/me/gymInbox')).toHaveLength(2); // the lists and the news, none for a thread
    expect(w.log.filter((l) => l.path === 'users/me/inbox')).toHaveLength(1); // the news
    expect(peekFriendCache('me')?.threads.jake.items.map((i) => i.text)).toEqual(['💪', '👏']);
  });

  it('a friend’s new message costs no read beyond the news’, even after the app restarts; an old copy without what you sent reads it once', async () => {
    const w = world();
    cloudBox.c = w.cloud;
    await prefetchFriends('me', today);
    await flushFriendCache();
    resetFriendCacheForTests();
    w.docs['users/me/inbox/j2'] = { from: 'jake', kind: 'm', t: 'up?', at: ts(T) };
    w.take();
    await refreshNews(w.cloud, 'me');
    w.take();
    await refreshChangedThreads(w.cloud, 'me');
    expect(w.take()).toBe(0);
    expect(peekFriendCache('me')?.threads.jake.items.map((i) => i.text)).toEqual(['💪', '👏', 'up?']);
    // A copy kept by an older version holds no `mine`: what you sent is read, their side still isn't.
    await patchFriendCache('me', (c) => ({ ...c, threads: { ...c.threads, jake: { at: c.threads.jake.at, items: c.threads.jake.items, gyms: [] } } }));
    w.docs['users/me/inbox/j3'] = { from: 'jake', kind: 'm', t: 'now?', at: ts(T + 1000) };
    await refreshNews(w.cloud, 'me');
    w.take();
    await refreshChangedThreads(w.cloud, 'me');
    expect(sentRead(w)).toEqual(['jake']);
    expect(theirsRead(w)).toEqual([]);
    expect(peekFriendCache('me')?.threads.jake.items.map((i) => i.text)).toEqual(['💪', '👏', 'up?', 'now?']);
  });

  it('a thread opened reads what you sent whole (another phone, their deletes) and only what’s new in your inbox', async () => {
    const w = world();
    cloudBox.c = w.cloud;
    await prefetchFriends('me', today);
    // Since: you sent one from another phone, jake's phone cleared your old ping, and jake wrote.
    w.docs['users/jake/inbox/m2'] = { from: 'me', kind: 'm', t: 'from my iPad', at: ts(T - 30 * 60_000) };
    delete w.docs['users/jake/inbox/m1'];
    w.docs['users/me/inbox/j2'] = { from: 'jake', kind: 'm', t: 'up?', at: ts(T) };
    w.take();
    await refreshThread(w.cloud, 'me', 'jake');
    expect(sentRead(w)).toEqual(['jake']);
    expect(theirsRead(w)).toEqual([]);
    expect(w.log.find((l) => l.path === 'users/me/inbox')?.filters).toBe(`at>${T - 2 * H - 60_000}`);
    expect(peekFriendCache('me')?.threads.jake.items.map((i) => i.text)).toEqual(['💪', 'from my iPad', 'up?']);
    // What it read of your inbox is kept for the news: its next read starts after it.
    expect(peekFriendCache('me')?.inbox?.items.map((d) => d.id).sort()).toEqual(['j1', 'j2']);
    w.take();
    await refreshNews(w.cloud, 'me');
    expect(w.log.find((l) => l.path === 'users/me/inbox')?.filters).toBe(`at>${T - 60_000}`);
  });

  it('a thread opened while the news clears something keeps it cleared', async () => {
    const w = world();
    cloudBox.c = w.cloud;
    await prefetchFriends('me', today);
    w.docs['users/me/inbox/j2'] = { from: 'jake', kind: 'm', t: 'up?', at: ts(T) };
    const opened = refreshThread(w.cloud, 'me', 'jake');
    await patchFriendCache('me', (c) => ({ ...c, inbox: { ...c.inbox!, items: c.inbox!.items.filter((d) => d.id !== 'j1') } }));
    await opened;
    expect(peekFriendCache('me')?.inbox?.items.map((d) => d.id).sort()).toEqual(['j2']);
  });

  it('with no inbox kept (a first open), a thread opened reads both halves whole', async () => {
    const w = world();
    await refreshThread(w.cloud, 'me', 'jake');
    expect(sentRead(w)).toEqual(['jake']);
    expect(theirsRead(w)).toEqual([{ path: 'users/me/inbox', n: 1, filters: 'from==jake' }]);
    expect(peekFriendCache('me')?.threads.jake.items.map((i) => i.text)).toEqual(['💪', '👏']);
  });

  it('a thread built from what’s kept says what reading it whole says, as messages come and go', async () => {
    const w = world();
    cloudBox.c = w.cloud;
    const D = 864e5;
    w.docs['users/me/inbox/old'] = { from: 'jake', kind: 'm', t: 'last month', at: ts(T - 29 * D) };
    for (let i = 0; i < 25; i++) w.docs[`users/jake/inbox/s${i}`] = { from: 'me', kind: 'm', t: `mine ${i}`, at: ts(T - 2 * D + i * 60_000) };
    await prefetchFriends('me', today);
    const whole = async () => (await listThread(w.cloud, 'me', 'jake')).items;
    expect(peekFriendCache('me')?.threads.jake.items).toEqual(await whole());
    for (let i = 0; i < 6; i++) {
      w.docs[`users/me/inbox/n${i}`] = { from: 'jake', kind: i % 2 ? 'p' : 'm', e: 'fire', t: `theirs ${i}`, at: ts(T + i * 60_000) };
      await age();
      await prefetchFriends('me', today);
      expect(peekFriendCache('me')?.threads.jake.items).toEqual(await whole());
    }
    // Their message goes past 30 days: the news clears it from your inbox, and the thread built again drops it.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T + 1.5 * D);
      w.docs['users/me/inbox/n9'] = { from: 'jake', kind: 'm', t: 'still there?', at: ts(T + 1.5 * D) };
      await prefetchFriends('me', today);
      expect(w.docs['users/me/inbox/old']).toBeUndefined();
      const items = peekFriendCache('me')!.threads.jake.items;
      expect(items.map((i) => i.text)).toContain('still there?');
      expect(items.map((i) => i.text)).not.toContain('last month');
      expect(items).toEqual(await whole());
    } finally { vi.useRealTimers(); }
  });

  it('a gym a friend sent, or one dismissed since, reads their thread again', async () => {
    const w = world();
    cloudBox.c = w.cloud;
    await prefetchFriends('me', today);
    w.docs['users/me/gymInbox/g1'] = { from: 'ana', fromName: 'ana', gym: { name: 'Iron Den', equipment: [] }, sent: T };
    await age();
    w.take();
    await prefetchFriends('me', today);
    // Built again from the gyms the lists just read: no read of the thread.
    expect(threadsRead(w)).toEqual([]);
    expect(peekFriendCache('me')?.threads.ana.gyms.map((g) => g.id)).toEqual(['g1']);
    expect(peekFriendCache('me')?.threads.ana.items.map((i) => i.text)).toEqual(['Iron Den']);
    // Only ana's: jake's thread, opened or built from what's kept, holds none of it.
    await refreshThread(w.cloud, 'me', 'jake');
    expect(peekFriendCache('me')?.threads.jake.gyms).toEqual([]);
    await refreshThread(w.cloud, 'me', 'jake', false, true);
    expect(peekFriendCache('me')?.threads.jake.items.map((i) => i.text)).toEqual(['💪', '👏']);
    delete w.docs['users/me/gymInbox/g1'];
    await age();
    w.take();
    await prefetchFriends('me', today);
    expect(threadsRead(w)).toEqual([]);
    expect(peekFriendCache('me')?.threads.ana.gyms).toEqual([]);
    expect(peekFriendCache('me')?.threads.ana.items).toEqual([]);
  });

  it('the pure rule: a kept thread whose gyms aren’t the ones lists read after it hold from that friend is behind', () => {
    const g = (id: string, from: string) => ({ id, from, fromName: from, gym: { name: id }, sent: 1 }) as never;
    const t = (gyms: never[], at = NOW - 1) => ({ at, items: [], gyms });
    const c: FriendCache = {
      ...empty(), lists: { at: NOW, me: 'me', friends: [], requests: [], invite: null, sentGyms: [g('g1', 'ana'), g('g2', 'sam'), g('g3', 'kim')], blocked: [] },
      threads: { ana: t([g('g1', 'ana')]), sam: t([]), jake: t([g('g9', 'jake')]), lee: t([g('g4', 'lee')], NOW + 1) },
    };
    // kim: never read; lee: read after the lists (dismissed in the thread since), so the thread is the newer word.
    expect(threadsBehind(c).sort()).toEqual(['jake', 'kim', 'sam']);
    expect(threadsBehind({ ...c, lists: undefined })).toEqual([]);
  });
});

describe('friend cache: a Crew line read from Firestore (refreshWindow)', () => {
  const s = (date: string) => ({ id: `app|${date}|squat|1`, date, seq: 1, exercise: 'Squat', setNo: 1, weight: 100, reps: 5, flags: [], source: 'app' });
  it('reads their months and status once; after that, while nothing changed, only their index, even after the app restarts', async () => {
    const w = fakeFirestore({
      'users/jake/meta/index': { months: { '2026-09': 3, '2026-10': 4 }, meta: 5 },
      'users/jake/months/2026-09': { sets: [s('2026-09-20')] }, 'users/jake/months/2026-10': { sets: [s('2026-10-15')] },
      'users/jake/meta/profile': { items: { status: JSON.stringify('cutting') } },
    });
    const { from, to } = crewRange('2026-10-17');
    expect(await refreshWindow(w.cloud, 'me', 'jake', from, to)).toEqual({ sets: [s('2026-09-20'), s('2026-10-15')], status: 'cutting', goal: 2, start: null, loc: null, prs: {} });
    expect(w.take()).toBe(4); // index, two months in one query, profile
    await flushFriendCache();
    resetFriendCacheForTests();
    expect(await refreshWindow(w.cloud, 'me', 'jake', from, to)).toEqual({ sets: [s('2026-09-20'), s('2026-10-15')], status: 'cutting', goal: 2, start: null, loc: null, prs: {} });
    expect(w.log).toEqual([{ path: 'users/jake/meta/index', n: 1 }]);
    expect(peekFriendCache('me')?.windows.jake.basis).toEqual({ months: { '2026-09': 3, '2026-10': 4 }, meta: 5 });
  });
});

describe('friend cache: Compare summaries (refreshSummaries)', () => {
  const doc = (streak: number) => {
    const pts = Array.from({ length: 13 }, () => 0);
    const r = (w: number) => ({ met: '1'.repeat(w), vol: [], prs: pts, lifts: [] });
    return { v: 1, day: '2026-10-17', goal: 3, streak, r: { '4w': r(4), '12w': r(12), '1y': r(52) }, firsts: [], at: ts(5) };
  };
  const world = () => fakeFirestore({ 'users/jake/summary/compare': doc(4), 'users/jake/months/2026-10': { sets: [] }, 'users/ana/meta/index': { months: {} } });

  it('one read a friend, of their summary and nothing else; none written yet is kept as none', async () => {
    const w = world();
    await refreshSummaries(w.cloud, 'me', ['jake', 'ana']);
    expect(w.log.map((l) => l.path).sort()).toEqual(['users/ana/summary/compare', 'users/jake/summary/compare']);
    expect(w.reads()).toBe(2);
    const c = peekFriendCache('me')!;
    expect(c.summaries?.jake.doc).toMatchObject({ streak: 4, at: 5 });
    expect(c.summaries?.ana.doc).toBeNull();
    expect(staleSummaries(c, ['jake', 'ana', 'sam'], Date.now())).toEqual(['sam']);
    expect(staleSummaries(c, ['jake'], Date.now() + STALE_MS + 1)).toEqual(['jake']);
  });
  it('a refused read is kept as none; an offline one leaves what was kept', async () => {
    const w = world();
    await refreshSummaries(w.cloud, 'me', ['jake']);
    const F = w.cloud.F as unknown as { getDoc: (r: { path: string }) => Promise<unknown> };
    const get = F.getDoc;
    F.getDoc = async (r) => { if (r.path.startsWith('users/jake/')) throw Object.assign(new Error('offline'), { code: 'unavailable' }); return get(r); };
    await refreshSummaries(w.cloud, 'me', ['jake']);
    expect(peekFriendCache('me')!.summaries?.jake.doc).toMatchObject({ streak: 4 });
    F.getDoc = async (r) => { if (r.path.startsWith('users/jake/')) throw Object.assign(new Error('refused'), { code: 'permission-denied' }); return get(r); };
    await refreshSummaries(w.cloud, 'me', ['jake']);
    expect(peekFriendCache('me')!.summaries?.jake.doc).toBeNull();
  });
  it('nothing kept of someone no longer a friend, nor brought back by a read that was out', async () => {
    const w = world();
    await patchFriendCache('me', (c) => ({ ...c, lists: { at: 1, me: 'me', friends: [{ uid: 'ana', name: 'ana' }], requests: [], invite: null, sentGyms: [], blocked: [] } }));
    await refreshSummaries(w.cloud, 'me', ['jake', 'ana']);
    expect(Object.keys(peekFriendCache('me')!.summaries ?? {})).toEqual(['ana']);
    const c = pruneTo({ ...empty(), summaries: { jake: { at: 1, doc: null }, gone: { at: 1, doc: null } } }, ['jake']);
    expect(Object.keys(c.summaries!)).toEqual(['jake']);
  });
});
