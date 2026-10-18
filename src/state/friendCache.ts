import { useEffect, useSyncExternalStore } from 'react';
import { deleteFriendCaches, getFriendCache, putFriendCache } from '../db/db';
import { loadCloud, type Cloud } from '../cloud/firebase';
import {
  friendNews, listBlocked, listFriends, listRequests, listSentGyms, listThread, liveInvite, myUsername, readFriendWindow,
  type Friend, type FriendNews, type FriendWindow, type Request, type SentGym,
} from '../cloud/friends';
import { addDays } from '../domain/analytics';
import type { Invite } from '../domain/invite';
import type { ThreadItem } from '../domain/messages';

// Friends as last read, for one account, kept on the phone: Friends, Crew, the threads and the Friends tab's dot show
// it at once and read Firestore again quietly behind it (stale-while-revalidate). It's read in the background after the
// app's first sync, again when the app comes back after 5 minutes, and a friend's thread after a push about them.
// Friends opened, pulled down or acted on reads again whatever the age.

/** How long a friend's Crew line, a thread, or the whole background read counts as fresh. */
export const STALE_MS = 5 * 60_000;
/** Crew's span: eight weeks back, today included. */
export const CREW_SPAN = 56;
export const crewRange = (today: string) => ({ from: addDays(today, -(CREW_SPAN - 1)), to: today });

export interface Lists {
  at: number;
  /** Your username; null: none chosen yet. */ me: string | null;
  friends: Friend[]; requests: Request[]; invite: (Invite & { expires: number }) | null; sentGyms: SentGym[]; blocked: Friend[];
}
export interface CachedWindow { at: number; from: string; to: string; win: FriendWindow }
export interface CachedThread { at: number; items: ThreadItem[]; gyms: SentGym[] }
export interface FriendCache {
  uid: string;
  lists?: Lists;
  news?: FriendNews & { at: number };
  /** Per friend's uid. */ windows: Record<string, CachedWindow>;
  /** Per friend's uid. */ threads: Record<string, CachedThread>;
}

// ---- Pure rules ----

export const staleWindow = (w: CachedWindow | undefined, from: string, to: string, now: number) => !w || w.from !== from || w.to !== to || now - w.at > STALE_MS;

/** Friends who sent something newer than the newest of theirs in the thread kept here (or whose thread was never read). */
export function threadsBehind(c: FriendCache): string[] {
  return Object.entries(c.news?.latest ?? {}).filter(([uid, l]) => {
    const t = c.threads[uid];
    const theirs = t ? Math.max(0, ...t.items.filter((i) => !i.mine && i.kind !== 'gym').map((i) => i.at)) : -1;
    return l.at > theirs;
  }).map(([uid]) => uid);
}

/** Nothing kept of someone who's no longer a friend: their log is theirs again. */
export function pruneTo(c: FriendCache, friends: string[]): FriendCache {
  const keep = <T,>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([k]) => friends.includes(k)));
  return { ...c, windows: keep(c.windows), threads: keep(c.threads) };
}

/** Their thread was opened: their unread go at once (and Today's banner if it was theirs), before the news is read again. */
export function readLocally(c: FriendCache, f: string): FriendCache {
  const n = c.news, k = n?.unread[f] ?? 0;
  if (!n || (!k && n.top?.uid !== f)) return c;
  const { [f]: _gone, ...unread } = n.unread;
  return { ...c, news: { ...n, unread, total: Math.max(0, n.total - k), top: n.top?.uid === f ? null : n.top } };
}

// ---- The store: in memory, read from and written to IndexedDB ----

const mem = new Map<string, FriendCache>();
const reading = new Map<string, Promise<FriendCache>>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
let gen = 0; // forgetting bumps it, so a read or write already under way can't bring anything back

const fresh = (uid: string): FriendCache => ({ uid, windows: {}, threads: {} });
const asCache = (uid: string, x: Partial<FriendCache> | undefined): FriendCache => ({
  ...fresh(uid), ...x, uid,
  windows: x?.windows && typeof x.windows === 'object' ? x.windows : {},
  threads: x?.threads && typeof x.threads === 'object' ? x.threads : {},
});

export const peekFriendCache = (uid: string | null | undefined) => (uid ? mem.get(uid) : undefined);

/** This account's saved copy, read from the phone once. */
export function hydrateFriendCache(uid: string): Promise<FriendCache> {
  const m = mem.get(uid);
  if (m) return Promise.resolve(m);
  let p = reading.get(uid);
  if (!p) {
    const g = gen;
    p = getFriendCache<Partial<FriendCache>>(uid).catch(() => undefined).then((stored) => {
      reading.delete(uid);
      if (g !== gen) return fresh(uid);
      const c = mem.get(uid) ?? asCache(uid, stored);
      mem.set(uid, c);
      emit();
      return c;
    });
    reading.set(uid, p);
  }
  return p;
}

const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();
/** Writes what changed, a moment after the last change (a burst of reads saves once). */
export function flushFriendCache(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  const uids = [...dirty];
  dirty.clear();
  const g = gen;
  writing = writing.then(() => Promise.all(uids.map((u) => {
    const c = mem.get(u);
    return c && g === gen ? putFriendCache(u, c).catch(() => {}) : undefined;
  }))).then(() => {});
  return writing;
}

/** Changes this account's copy (read from the phone first), tells every screen showing it, and saves it shortly. */
export async function patchFriendCache(uid: string, fn: (c: FriendCache) => FriendCache): Promise<FriendCache> {
  const g = gen;
  const base = await hydrateFriendCache(uid);
  if (g !== gen) return base;
  const next = fn(mem.get(uid) ?? base);
  mem.set(uid, next);
  emit();
  dirty.add(uid);
  timer ??= setTimeout(() => void flushFriendCache(), 250);
  return next;
}

/** Signed out or the account deleted: no friend's anything stays on the phone. */
export async function forgetFriendCaches(): Promise<void> {
  gen++;
  if (timer) { clearTimeout(timer); timer = null; }
  dirty.clear(); mem.clear(); reading.clear(); lastRun.clear();
  emit();
  await writing.catch(() => {});
  await deleteFriendCaches().catch(() => {});
}

export function resetFriendCacheForTests() {
  gen++;
  if (timer) { clearTimeout(timer); timer = null; }
  dirty.clear(); mem.clear(); reading.clear(); lastRun.clear(); inflight.clear();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** This account's friends as kept here, live: undefined only while the phone's copy is first read (a few ms). */
export function useFriendCache(uid: string | null | undefined): FriendCache | undefined {
  const c = useSyncExternalStore(subscribe, () => peekFriendCache(uid));
  useEffect(() => { if (uid) void hydrateFriendCache(uid); }, [uid]);
  return c;
}

// ---- Reading Firestore into it ----

const inflight = new Map<string, Promise<unknown>>();
/**
 * One read of a kind at a time. A read asked for after a change (a send, an accept, a thread opened) waits for one already
 * out, then reads again, so what it saves is never from before the change; the background read (`join`) shares one out.
 */
function once<T>(key: string, f: () => Promise<T>, join: boolean): Promise<T> {
  const p = inflight.get(key) as Promise<T> | undefined;
  if (p && join) return p;
  const q: Promise<T> = (p ? p.catch(() => {}).then(f) : f()).finally(() => { if (inflight.get(key) === q) inflight.delete(key); });
  inflight.set(key, q);
  return q;
}

/** Your username, friends, requests, invite link, gyms sent to you and who you blocked. */
export function refreshLists(c: Cloud, uid: string, join = false): Promise<Lists> {
  return once(`lists:${uid}`, async () => {
    const [me, friends, requests, invite, sentGyms, blocked] = await Promise.all([
      myUsername(c, uid), listFriends(c, uid), listRequests(c, uid), liveInvite(c, uid), listSentGyms(c, uid), listBlocked(c, uid).catch(() => []),
    ]);
    const lists: Lists = { at: Date.now(), me, friends, requests, invite, sentGyms, blocked };
    await patchFriendCache(uid, (x) => ({ ...pruneTo(x, friends.map((f) => f.uid)), lists }));
    return lists;
  }, join);
}

/** Requests, gyms and each friend's unread, with the newest: the Friends tab's dot, the badge and Today's banner. */
export function refreshNews(c: Cloud, uid: string, join = false): Promise<FriendNews> {
  return once(`news:${uid}`, async () => {
    const n = await friendNews(c, uid);
    await patchFriendCache(uid, (x) => ({ ...x, news: { ...n, at: Date.now() } }));
    return n;
  }, join);
}

/** One friend's Crew line: their sets over Crew's span, and their status. */
export function refreshWindow(c: Cloud, uid: string, f: string, from: string, to: string, join = false): Promise<FriendWindow> {
  return once(`window:${uid}:${f}:${from}`, async () => {
    const win = await readFriendWindow(c, f, from, to);
    await patchFriendCache(uid, (x) => ({ ...x, windows: { ...x.windows, [f]: { at: Date.now(), from, to, win } } }));
    return win;
  }, join);
}

/** You and one friend: both halves of the thread and the gyms they sent. */
export function refreshThread(c: Cloud, uid: string, f: string, join = false): Promise<CachedThread> {
  return once(`thread:${uid}:${f}`, async () => {
    const t = { at: Date.now(), ...(await listThread(c, uid, f)) };
    await patchFriendCache(uid, (x) => ({ ...x, threads: { ...x.threads, [f]: t } }));
    return t;
  }, join);
}

/** The threads whose friend sent something since they were read (after the news is read again). */
export async function refreshChangedThreads(c: Cloud, uid: string): Promise<void> {
  const cache = peekFriendCache(uid);
  if (!cache?.lists) return;
  const friends = new Set(cache.lists.friends.map((f) => f.uid));
  await Promise.all(threadsBehind(cache).filter((f) => friends.has(f)).map((f) => refreshThread(c, uid, f, true).catch(() => {})));
}

/** Everything Friends shows, read again: lists and news always; Crew lines and threads when stale (or `force`). */
export async function prefetchFriends(uid: string, today: string, force = false): Promise<void> {
  const c = await loadCloud();
  const [lists] = await Promise.all([refreshLists(c, uid, !force), refreshNews(c, uid, !force)]);
  const { from, to } = crewRange(today), now = Date.now(), cache = peekFriendCache(uid);
  await Promise.all(lists.friends.flatMap((f) => [
    force || staleWindow(cache?.windows[f.uid], from, to, now) ? refreshWindow(c, uid, f.uid, from, to, !force).catch(() => {}) : null,
    force || !cache?.threads[f.uid] || now - cache.threads[f.uid].at > STALE_MS ? refreshThread(c, uid, f.uid, !force).catch(() => {}) : null,
  ]));
  await refreshChangedThreads(c, uid);
}

const lastRun = new Map<string, number>();
const idle = (f: () => void) => {
  const w = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 3000 }); else setTimeout(f, 500);
};
/**
 * After a sync: the background read, when the phone is idle, at most once in 5 minutes (the app syncs after every set). So it
 * runs after the app's first sync, and again on the first sync after coming back to the app 5 minutes later.
 */
export function prefetchSoon(uid: string, today: string): void {
  const now = Date.now();
  if (now - (lastRun.get(uid) ?? 0) < STALE_MS) return;
  lastRun.set(uid, now);
  idle(() => { void prefetchFriends(uid, today).catch(() => lastRun.delete(uid)); });
}

/** A push came in while the app was open: the thread it's about (and the lists, for a request, a new friend or a gym). */
export async function readAfterPush(uid: string, kind: string | null | undefined, route: string | null | undefined): Promise<void> {
  const c = await loadCloud();
  const f = route?.startsWith('friend.') ? route.slice('friend.'.length) : null;
  await Promise.all([
    f ? refreshThread(c, uid, f) : null,
    kind === 'request' || kind === 'accepted' || kind === 'gym' ? refreshLists(c, uid) : null,
  ]);
}
