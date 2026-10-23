import {
  OVERLAP_MS, PAGE, POST_DAYS_MS, isReason, nextPostAt, postOf, rateNext, REPORTS_A_DAY,
  type Post, type Rate, type Reason, type Review,
} from '../domain/board';
import { notifyFriend } from '../push/client';
import type { Cloud } from './firebase';
import { countDay, counted, limitHit, whyRefused, withTries } from './limits';
import { OWNERS } from './owner';

// The board's reads and writes (social S3, S4). firestore.rules decides who may do each; these make only the writes it allows,
// in the shape it wants. Every read here is one the cost table in the plan counts: a page is 20 reads, what's new since the
// newest post kept is what it returns (1 when nothing), your own gate document and moderation notice are 1 each.

const fail = (text: string) => Object.assign(new Error(text), { plain: true });
const millis = (v: unknown) => (v as { toMillis?(): number } | null | undefined)?.toMillis?.();
const denied = (e: unknown) => (e as { code?: string }).code === 'permission-denied';
const posts = (q: { docs: { id: string; data(): Record<string, unknown> }[] }) =>
  q.docs.map((d) => postOf(d.id, d.data(), millis(d.data().at))).filter((p): p is Post => !!p);

/** Newest first: the 20 after `after` (ms: the last post of the page before), none older than 30 days. */
export async function readPage({ F, db }: Cloud, now: number, after?: number): Promise<{ posts: Post[]; end: boolean }> {
  const q = F.query(F.collection(db, 'board'), F.where('at', '>', F.Timestamp.fromMillis(now - POST_DAYS_MS)), F.orderBy('at', 'desc'),
    ...(after != null ? [F.startAfter(F.Timestamp.fromMillis(after))] : []), F.limit(PAGE));
  const got = await F.getDocs(q);
  return { posts: posts(got), end: got.docs.length < PAGE };
}

/**
 * What's new since `newest` (ms: the newest post kept), from OVERLAP_MS before it, newest first, at most a page. A full page back
 * means there may be more between it and what's kept: the caller keeps this as the first page and drops the rest.
 */
export async function readNewer({ F, db }: Cloud, newest: number): Promise<{ posts: Post[]; gap: boolean }> {
  const q = F.query(F.collection(db, 'board'), F.where('at', '>', F.Timestamp.fromMillis(newest - OVERLAP_MS)), F.orderBy('at', 'desc'), F.limit(PAGE));
  const got = await F.getDocs(q);
  return { posts: posts(got), gap: got.docs.length >= PAGE };
}

/** Your own board settings: the gate's acceptance, the posts you hid, the people you muted (users/{you}/private/board). */
export interface Mine { ok: boolean; hidden: string[]; muted: string[] }
const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
export const minePath = (uid: string) => `users/${uid}/private/board`;
export async function readMine({ F, db }: Cloud, uid: string): Promise<Mine> {
  const d = (await F.getDoc(F.doc(db, minePath(uid)))).data();
  return { ok: d?.ok === true, hidden: strings(d?.hidden), muted: strings(d?.muted) };
}
/** "16 or older, and the board's rules": accepted once, kept on your account (firestore.rules reads it for every post). */
export async function acceptBoard({ F, db }: Cloud, uid: string): Promise<void> {
  await F.setDoc(F.doc(db, minePath(uid)), { ok: true, at: F.serverTimestamp() }, { merge: true });
}
/** Your hidden posts or muted people, written whole (only your own phones write it). */
export async function saveList({ F, db }: Cloud, uid: string, key: 'hidden' | 'muted', list: string[]): Promise<void> {
  await F.setDoc(F.doc(db, minePath(uid)), { [key]: list }, { merge: true });
}

/** What the owner's moderation told you: posts of yours removed (a count), and whether you're banned. */
export interface Notice { removed: number; banned: boolean }
export async function readNotice({ F, db }: Cloud, uid: string): Promise<Notice | null> {
  const d = (await F.getDoc(F.doc(db, `notices/${uid}`))).data();
  return d ? { removed: typeof d.removed === 'number' ? d.removed : 0, banned: d.banned === true } : null;
}

const rateOf = (d: Record<string, unknown> | undefined): Rate | null => {
  const at = millis(d?.at), win = millis(d?.win);
  return at != null && win != null && typeof d?.n === 'number' ? { at, win, n: d.n } : null;
};
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * A post: the post and your counter in one write, as firestore.rules want (60 s apart, 5 a day). Its name and @username are
 * your profile's as they are now (read here, as the rules compare them). The day is judged by this phone's clock; near its edge
 * the server may judge otherwise, so a refusal reads the counter again and tries the other way once.
 */
export async function createPost(c: Cloud, uid: string, text: string, now = Date.now()): Promise<Post> {
  const { F, db } = c;
  const p = (await F.getDoc(F.doc(db, `users/${uid}`))).data();
  const user = p?.username;
  if (typeof user !== 'string') throw fail('Choose a username first.');
  const name = typeof p?.displayName === 'string' ? p.displayName : user;
  const rateRef = F.doc(db, `boardRate/${uid}`);
  const attempt = async (flip: boolean, off: number) => {
    const r = rateOf((await F.getDoc(rateRef)).data());
    const wait = flip ? null : nextPostAt(r, now);
    if (wait?.why === 'day') { limitHit('board'); throw fail(`That’s 5 posts today. You can post again ${when(wait.at)}.`); }
    if (wait?.why === 'gap') throw fail(`One post a minute. Try again in ${Math.max(1, Math.ceil((wait.at - now) / 1000))} s.`);
    const next = rateNext(r, now, flip), ts = F.serverTimestamp();
    const ref = F.doc(F.collection(db, 'board'));
    const b = F.writeBatch(db);
    b.set(ref, { uid, name, user, t: text, at: ts, reports: 0, likes: 0 });
    b.set(rateRef, { at: ts, win: next.keep && r ? F.Timestamp.fromMillis(r.win) : ts, n: next.n });
    countDay(c, b, now + off * DAY_MS);
    await b.commit();
    return { id: ref.id, uid, name, user, t: text, at: now, reports: 0, likes: 0 };
  };
  return withTries(attempt, async () => (await whyRefused(c, 'board', now)) ?? fail('The board refused that post. Try again in a minute.'));
}
const DAY_MS = 86_400_000;

/** Your own post, gone (its likes and reports stay with nobody to read them but the owner, who clears them). */
export async function deletePost({ F, db }: Cloud, id: string): Promise<void> {
  await F.deleteDoc(F.doc(db, `board/${id}`));
}

/** A 💪 given or taken back: your like document and the post's count, in one write, with your counters (cloud/limits). */
export async function setLike(c: Cloud, uid: string, id: string, on: boolean): Promise<void> {
  const { F, db } = c;
  const ref = F.doc(db, `board/${id}/likes/${uid}`);
  await counted(c, uid, 'board', (b) => {
    if (on) b.set(ref, {}); else b.delete(ref);
    b.update(F.doc(db, `board/${id}`), { likes: F.increment(on ? 1 : -1) });
  });
}

/**
 * A report: yours, the post's count up one, your report counter (20 a day) and the post hidden for you, in one write. Then the
 * push Worker is told, so the owner hears of new reports (at most once a day; it checks your report with your token).
 */
export async function reportPost(c: Cloud, uid: string, id: string, why: Reason, hidden: string[], now = Date.now()): Promise<void> {
  const { F, db } = c;
  if (!isReason(why)) throw fail('Pick a reason.');
  const rateRef = F.doc(db, `reportRate/${uid}`);
  const attempt = async (flip: boolean) => {
    const r = rateOf((await F.getDoc(rateRef)).data());
    const next = rateNext(r, now, flip);
    if (next.n > REPORTS_A_DAY) { limitHit('report'); throw fail('That’s 20 reports today. The owner will get to them.'); }
    const ts = F.serverTimestamp(), b = F.writeBatch(db);
    b.set(F.doc(db, `board/${id}/reports/${uid}`), { why, at: ts });
    b.update(F.doc(db, `board/${id}`), { reports: F.increment(1) });
    b.set(rateRef, { at: ts, win: next.keep && r ? F.Timestamp.fromMillis(r.win) : ts, n: next.n });
    b.set(F.doc(db, minePath(uid)), { hidden }, { merge: true });
    await b.commit();
  };
  try { await attempt(false); } catch (e) {
    if (!denied(e)) throw e;
    try { await attempt(true); } catch (e2) { throw denied(e2) ? fail('Couldn’t report it: you may have reported it already.') : e2; }
  }
  if (!OWNERS.includes(uid)) notifyFriend('report', OWNERS[0], id);
}

// ---- The owner's (firestore.rules OWNERS(); the app shows these only to cloud/owner isOwner) ----

/** Every post with a report the owner hasn't reviewed, with its reasons tallied (the reports read: one each). */
export async function listReported({ F, db }: Cloud): Promise<Review[]> {
  const got = posts(await F.getDocs(F.query(F.collection(db, 'board'), F.where('reports', '>', 0))));
  const open = got.filter((p) => p.reports > (p.kept ?? 0));
  return Promise.all(open.map(async (post) => {
    const why: Review['why'] = {};
    for (const d of (await F.getDocs(F.collection(db, `board/${post.id}/reports`))).docs) {
      const w = d.data().why;
      if (isReason(w)) why[w] = (why[w] ?? 0) + 1;
    }
    return { post, why };
  }));
}
/** Kept: the reports so far reviewed, so it shows again for everyone (new reports start counting from here). */
export async function keepPost({ F, db }: Cloud, p: Post): Promise<void> {
  await F.updateDoc(F.doc(db, `board/${p.id}`), { kept: p.reports });
}

type Batch = ReturnType<Cloud['F']['writeBatch']>;
/** A post with its likes and reports, into a write (the owner may list both). */
async function dropPost({ F, db }: Cloud, b: Batch, id: string): Promise<void> {
  const [likes, reports] = await Promise.all([F.getDocs(F.collection(db, `board/${id}/likes`)), F.getDocs(F.collection(db, `board/${id}/reports`))]);
  for (const d of [...likes.docs, ...reports.docs]) b.delete(d.ref);
  b.delete(F.doc(db, `board/${id}`));
}
/** The author's notice, moved on: `removed` more posts removed, and banned or not (unchanged when not given). */
async function tell({ F, db }: Cloud, b: Batch, uid: string, removed: number, banned?: boolean): Promise<void> {
  const ref = F.doc(db, `notices/${uid}`);
  const d = (await F.getDoc(ref)).data();
  const was = { removed: typeof d?.removed === 'number' ? d.removed : 0, banned: d?.banned === true };
  b.set(ref, { removed: was.removed + removed, banned: banned ?? was.banned, at: F.serverTimestamp() });
}
/** Removed for breaking the rules: gone with its likes and reports, and its author told on their next board open (no push). */
export async function removePost(c: Cloud, p: Pick<Post, 'id' | 'uid'>): Promise<void> {
  const b = c.F.writeBatch(c.db);
  await dropPost(c, b, p.id);
  await tell(c, b, p.uid, 1);
  await b.commit();
}
/** Banned: they can't post, give a 💪 or report (firestore.rules), their live posts go, and they're told on their next open. */
export async function banUser(c: Cloud, uid: string): Promise<number> {
  const { F, db } = c;
  const theirs = (await F.getDocs(F.query(F.collection(db, 'board'), F.where('uid', '==', uid)))).docs.map((d) => d.id);
  const b = F.writeBatch(db);
  for (const id of theirs) await dropPost(c, b, id);
  b.set(F.doc(db, `banned/${uid}`), { at: F.serverTimestamp() });
  await tell(c, b, uid, theirs.length, true);
  await b.commit();
  return theirs.length;
}
export async function unbanUser(c: Cloud, uid: string): Promise<void> {
  const b = c.F.writeBatch(c.db);
  b.delete(c.F.doc(c.db, `banned/${uid}`));
  await tell(c, b, uid, 0, false);
  await b.commit();
}
/** Everyone banned, with their @username now (a read each), for the owner to lift a ban. */
export async function listBanned({ F, db }: Cloud): Promise<{ uid: string; user: string }[]> {
  const ids = (await F.getDocs(F.collection(db, 'banned'))).docs.map((d) => d.id);
  return Promise.all(ids.map(async (uid) => {
    const u = (await F.getDoc(F.doc(db, `users/${uid}`))).data()?.username;
    return { uid, user: typeof u === 'string' ? u : 'a deleted account' };
  }));
}
export async function isBanned({ F, db }: Cloud, uid: string): Promise<boolean> {
  return (await F.getDoc(F.doc(db, `banned/${uid}`))).exists();
}
/** Posts over 30 days old, with their likes and reports: the owner's phone clears them when Review opens (Spark has no expiry). */
export async function sweepExpired(c: Cloud, now = Date.now()): Promise<number> {
  const { F, db } = c;
  const old = (await F.getDocs(F.query(F.collection(db, 'board'), F.where('at', '<=', F.Timestamp.fromMillis(now - POST_DAYS_MS)), F.limit(100)))).docs.map((d) => d.id);
  if (!old.length) return 0;
  const b = F.writeBatch(db);
  for (const id of old) await dropPost(c, b, id);
  await b.commit();
  return old.length;
}
