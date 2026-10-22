import type { Cloud } from '../cloud/firebase';
import { deletePost, readMine, readNewer, readNotice, readPage, type Mine } from '../cloud/board';
import { readVerified } from '../cloud/friends';
import { CACHE_MS, FULL_MS, mergePosts, POST_DAYS_MS, type Post } from '../domain/board';
import { flushFriendCache, hydrateFriendCache, patchFriendCache, useFriendCacheSelect, type BoardCache, type FriendCache } from './friendCache';

// The board as this phone keeps it (inside the account's friend cache, so signing out forgets it): shown at once, and read
// again only when it's over a minute old. Then only what's new since the newest post kept is read (one read when nothing is),
// with your moderation notice; the first page is read whole when pulled down, or when what's kept is over 15 minutes old. Your
// own board settings (the gate, hides, mutes) are read once and then kept as this phone writes them.

const EMPTY: BoardCache = { at: 0, full: 0, posts: [], end: false };
const once = new Map<string, Promise<BoardCache>>();

/**
 * The board, fresh enough: as kept when read under a minute ago (no reads), else what's new (or the first page whole: `force`,
 * nothing kept, or kept over 15 minutes). One read at a time per account; a forced read waits for one already out.
 */
export function openBoard(c: Cloud, uid: string, opts: { force?: boolean; now?: number } = {}): Promise<BoardCache> {
  const key = uid, out = once.get(key);
  if (out && !opts.force) return out;
  const run = (out ? out.catch(() => EMPTY) : Promise.resolve(EMPTY)).then(() => readBoard(c, uid, opts.force ?? false, opts.now ?? Date.now()));
  const p = run.finally(() => { if (once.get(key) === p) once.delete(key); });
  once.set(key, p);
  return p;
}

async function readBoard(c: Cloud, uid: string, force: boolean, now: number): Promise<BoardCache> {
  const x = await hydrateFriendCache(uid);
  const b = x.board;
  if (!force && b && b.at <= now && now - b.at < CACHE_MS) return b;
  const whole = force || !b?.posts.length || now - b.full >= FULL_MS;
  const [read, mine, notice, verified] = await Promise.all([
    whole ? readPage(c, now).then((r) => ({ ...r, gap: true })) : readNewer(c, b!.posts[0].at).then((r) => ({ ...r, end: false })),
    b?.mine && !force ? b.mine : readMine(c, uid),
    readNotice(c, uid),
    force || !(x.lists?.verified ?? b?.verified) ? readVerified(c).catch(() => undefined) : undefined,
  ]);
  // Your own posts from this phone over 30 days old: deleted by id, with no read (the owner's phone sweeps the rest).
  const own = b?.own ?? [];
  const old = own.filter((p) => p.at <= now - POST_DAYS_MS);
  for (const p of old) void deletePost(c, p.id).catch(() => {});
  const next = await patchFriendCache(uid, (y) => {
    const kept = y.board ?? b;
    const posts = whole || read.gap ? read.posts : mergePosts(kept?.posts ?? [], read.posts);
    const v = verified ?? kept?.verified;
    return {
      ...withVerified(y, verified),
      board: {
        ...kept, at: now, full: whole || read.gap ? now : kept?.full ?? now, posts, end: whole || read.gap ? read.end : kept?.end ?? false,
        mine, notice, own: own.filter((p) => !old.includes(p)), ...(v && { verified: v }),
      },
    };
  });
  return next.board!;
}
/** The ✓s just read, for the Friends lists too when they're kept. */
const withVerified = (y: FriendCache, v: Record<string, number> | undefined): FriendCache => (v && y.lists ? { ...y, lists: { ...y.lists, verified: v } } : y);

/** The next page, after the oldest post kept. */
export async function morePosts(c: Cloud, uid: string, now = Date.now()): Promise<BoardCache> {
  const b = (await hydrateFriendCache(uid)).board;
  if (!b?.posts.length || b.end) return b ?? EMPTY;
  const r = await readPage(c, now, b.posts[b.posts.length - 1].at);
  const next = await patchFriendCache(uid, (y) => (y.board ? { ...y, board: { ...y.board, posts: mergePosts(y.board.posts, r.posts), end: r.end } } : y));
  return next.board ?? EMPTY;
}

/** Changes the board as kept (nothing read): a post, a like, your settings, what you've seen. */
export function patchBoard(uid: string, fn: (b: BoardCache) => BoardCache): Promise<FriendCache> {
  return patchFriendCache(uid, (y) => ({ ...y, board: fn(y.board ?? EMPTY) }));
}
export const notePost = (uid: string, p: Post) => patchBoard(uid, (b) => ({ ...b, posts: mergePosts(b.posts, [p]), own: [...(b.own ?? []), { id: p.id, at: p.at }].slice(-200) }));
export const noteGone = (uid: string, id: string) => patchBoard(uid, (b) => ({ ...b, posts: b.posts.filter((p) => p.id !== id), own: b.own?.filter((p) => p.id !== id) }));
export const noteLike = (uid: string, id: string, on: boolean) => patchBoard(uid, (b) => {
  const liked = new Set(b.liked ?? []);
  const was = liked.has(id);
  if (on) liked.add(id); else liked.delete(id);
  const by = was === on ? 0 : on ? 1 : -1;
  return { ...b, liked: [...liked].slice(-500), posts: b.posts.map((p) => (p.id === id ? { ...p, likes: Math.max(0, p.likes + by) } : p)) };
});
export const noteMine = (uid: string, mine: Mine) => patchBoard(uid, (b) => ({ ...b, mine }));
/** The removal notice seen: saved at once, so it never shows again (not even after a reload a moment later). */
export async function noteSeen(uid: string, removed: number): Promise<FriendCache> {
  const next = await patchBoard(uid, (b) => ({ ...b, seenRemoved: removed }));
  await flushFriendCache();
  return next;
}

const pickBoard = (c: FriendCache | undefined) => c?.board;
/** The board as kept, live. */
export const useBoard = (uid: string | null | undefined) => useFriendCacheSelect(uid, pickBoard);

export function resetBoardForTests() { once.clear(); }
