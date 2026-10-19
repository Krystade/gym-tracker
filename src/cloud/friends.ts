import type { BodyDay } from '../domain/body';
import type { Gym } from '../domain/equipment';
import { monthOf, type CloudMonth, type MetaItems } from '../domain/cloud';
import { itemShort, latestOf, messageOk, thread, toClear, unreadOf, type InboxDoc, type PresetKey, type ThreadItem } from '../domain/messages';
import { cleanStatus } from '../domain/crew';
import { newToken, type Invite } from '../domain/invite';
import type { SetEntry } from '../domain/types';
import { notifyFriend } from '../push/client';
import type { Cloud } from './firebase';

// Friendship is two documents, users/A/friends/B and users/B/friends/A: A's list naming B is what lets B read A's log.
// firestore.rules decides who may write each; these functions only make the writes the rules allow. After a write a friend
// would want to hear about, the push Worker is told (notifyFriend): it checks the write in Firestore itself, and a failure
// there never fails the write.

export interface Friend { uid: string; name: string; /** You muted their pushes (only you know). */ muted?: boolean }
export interface Request { uid: string; name: string }
const WEEK = 7 * 864e5;
const fail = (text: string) => Object.assign(new Error(text), { plain: true });

export async function myUsername({ F, db }: Cloud, uid: string): Promise<string | null> {
  return ((await F.getDoc(F.doc(db, `users/${uid}`))).data()?.username as string | undefined) ?? null;
}
const nameOf = async ({ F, db }: Cloud, uid: string) => ((await F.getDoc(F.doc(db, `users/${uid}`))).data()?.username as string | undefined) ?? 'someone';

/** Claims a username (or changes yours): one transaction, so two people can't take the same name. */
export async function claimUsername({ F, db }: Cloud, uid: string, name: string): Promise<void> {
  await F.runTransaction(db, async (tx) => {
    const ref = F.doc(db, `usernames/${name}`), meRef = F.doc(db, `users/${uid}`);
    const [taken, me] = [await tx.get(ref), await tx.get(meRef)];
    if (taken.exists() && taken.data().uid !== uid) throw fail(`“${name}” is taken. Try another.`);
    const old = me.data()?.username as string | undefined;
    if (!taken.exists()) tx.set(ref, { uid });
    if (old && old !== name) tx.delete(F.doc(db, `usernames/${old}`));
    tx.set(meRef, { username: name, displayName: name });
  });
}

/** Your one live invite: making a new one ends the old. */
export async function makeInvite({ F, db }: Cloud, uid: string, now = Date.now()): Promise<Invite> {
  const token = newToken();
  const b = F.writeBatch(db);
  for (const d of (await F.getDocs(F.collection(db, `users/${uid}/invites`))).docs) b.delete(d.ref);
  b.set(F.doc(db, `users/${uid}/invites/${token}`), { created: F.Timestamp.fromMillis(now), expires: F.Timestamp.fromMillis(now + WEEK) });
  await b.commit();
  return { uid, token };
}
export async function liveInvite({ F, db }: Cloud, uid: string, now = Date.now()): Promise<(Invite & { expires: number }) | null> {
  const live = (await F.getDocs(F.collection(db, `users/${uid}/invites`))).docs
    .map((d) => ({ uid, token: d.id, expires: (d.data().expires as { toMillis(): number }).toMillis() })).filter((x) => x.expires > now);
  return live.sort((a, b) => b.expires - a.expires)[0] ?? null;
}
export async function revokeInvites({ F, db }: Cloud, uid: string): Promise<void> {
  const b = F.writeBatch(db);
  for (const d of (await F.getDocs(F.collection(db, `users/${uid}/invites`))).docs) b.delete(d.ref);
  await b.commit();
}

const GONE = 'That invite has expired, was cancelled or was already used. Ask for a new link.';
async function checkInvite(c: Cloud, me: string, inv: Invite): Promise<void> {
  const { F, db } = c;
  if (inv.uid === me) throw fail('That’s your own invite link. Send it to a friend.');
  if ((await F.getDoc(F.doc(db, `users/${me}/friends/${inv.uid}`))).exists()) throw fail(`You’re already friends with @${await nameOf(c, inv.uid)}.`);
}
/** Who sent an invite, before anything is accepted: the link alone only asks. */
export async function peekInvite(c: Cloud, me: string, inv: Invite, now = Date.now()): Promise<string> {
  await checkInvite(c, me, inv);
  const d = await c.F.getDoc(c.F.doc(c.db, `users/${inv.uid}/invites/${inv.token}`));
  if (!d.exists() || (d.data().expires as { toMillis(): number }).toMillis() <= now) throw fail(GONE);
  return nameOf(c, inv.uid);
}
/** Both sides of the friendship and the invite used up, in one write: the rules let you into their list because you hold their live invite, and only while it goes. */
export async function acceptInvite(c: Cloud, me: string, inv: Invite, now = Date.now()): Promise<string> {
  const { F, db } = c;
  await checkInvite(c, me, inv);
  const b = F.writeBatch(db);
  b.set(F.doc(db, `users/${inv.uid}/friends/${me}`), { since: now, via: inv.token });
  b.set(F.doc(db, `users/${me}/friends/${inv.uid}`), { since: now, via: 'invite' });
  b.delete(F.doc(db, `users/${inv.uid}/invites/${inv.token}`));
  try { await b.commit(); } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') throw fail(GONE);
    throw e;
  }
  notifyFriend('accepted', inv.uid);
  return nameOf(c, inv.uid);
}

/** Asks someone by exact username. If they already asked you, this accepts theirs instead. */
export async function sendRequest(c: Cloud, me: string, myName: string, to: string, now = Date.now()): Promise<'sent' | 'accepted'> {
  const { F, db } = c;
  const them = (await F.getDoc(F.doc(db, `usernames/${to}`))).data()?.uid as string | undefined;
  if (!them) throw fail(`No one goes by “${to}”. Check the spelling.`);
  if (them === me) throw fail('That’s you.');
  if ((await F.getDoc(F.doc(db, `users/${me}/friends/${them}`))).exists()) throw fail(`You’re already friends with @${to}.`);
  if ((await F.getDoc(F.doc(db, `users/${me}/requests/${them}`))).exists()) { await acceptRequest(c, me, them, now); return 'accepted'; }
  const ref = F.doc(db, `users/${them}/requests/${me}`);
  if ((await F.getDoc(ref)).exists()) throw fail(`You’ve already asked @${to}. They’ll see it under Friends.`);
  await F.setDoc(ref, { username: myName, sent: now });
  notifyFriend('request', them);
  return 'sent';
}
export async function listRequests({ F, db }: Cloud, me: string): Promise<Request[]> {
  return (await F.getDocs(F.collection(db, `users/${me}/requests`))).docs.map((d) => ({ uid: d.id, name: (d.data().username as string) ?? 'someone' }));
}
/** Their request is what lets you into their list; it goes in the same write. */
export async function acceptRequest({ F, db }: Cloud, me: string, from: string, now = Date.now()): Promise<void> {
  const b = F.writeBatch(db);
  b.set(F.doc(db, `users/${from}/friends/${me}`), { since: now, via: 'request' });
  b.set(F.doc(db, `users/${me}/friends/${from}`), { since: now, via: 'request' });
  b.delete(F.doc(db, `users/${me}/requests/${from}`));
  await b.commit();
  notifyFriend('accepted', from);
}
export async function declineRequest({ F, db }: Cloud, me: string, from: string): Promise<void> {
  await F.deleteDoc(F.doc(db, `users/${me}/requests/${from}`));
}

export async function listFriends(c: Cloud, me: string): Promise<Friend[]> {
  const docs = (await c.F.getDocs(c.F.collection(c.db, `users/${me}/friends`))).docs;
  const out = await Promise.all(docs.map(async (d) => ({ uid: d.id, name: await nameOf(c, d.id), ...(d.data().muted === true && { muted: true }) })));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
/** Both documents go, so neither of you can read the other's log any more; their pings and messages leave your inbox. */
export async function removeFriend(c: Cloud, me: string, them: string): Promise<void> {
  const { F, db } = c;
  const b = F.writeBatch(db);
  b.delete(F.doc(db, `users/${me}/friends/${them}`));
  b.delete(F.doc(db, `users/${them}/friends/${me}`));
  await b.commit();
  await clearInboxFrom(c, me, them).catch(() => {});
}

/** A friend's whole log and settings, read-only: every month in their index, and their settings document (day plans: the recent ones, cloud/sync PLAN_DAYS). */
export interface FriendData { sets: SetEntry[]; body: BodyDay[]; meta: MetaItems }
export async function readFriend({ F, db }: Cloud, uid: string): Promise<FriendData> {
  const index = ((await F.getDoc(F.doc(db, `users/${uid}/meta/index`))).data()?.months ?? {}) as Record<string, number>;
  const [months, metaDoc] = await Promise.all([
    Promise.all(Object.keys(index).map(async (m) => (await F.getDoc(F.doc(db, `users/${uid}/months/${m}`))).data() as CloudMonth | undefined)),
    F.getDoc(F.doc(db, `users/${uid}/meta/profile`)),
  ]);
  const items = (metaDoc.data()?.items ?? {}) as Record<string, string>;
  return {
    sets: months.flatMap((m) => m?.sets ?? []),
    body: months.flatMap((m) => m?.body ?? []),
    meta: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, JSON.parse(v) as unknown])),
  };
}

/**
 * What Crew needs of a friend: their sets from `from` on, in the months up to `to`'s, and their status phrase. Only the months
 * that window touches are read, never the whole history; nothing else in their settings is kept (and cycle data is never in what
 * a friend can read). A set dated after `to` (a friend a time zone ahead) is kept: Crew shows up to today, and the month it's in
 * may never change again to bring it back.
 */
export interface FriendWindow { sets: SetEntry[]; status: string }
/** The times in a friend's index a window was read at: each month's, and their settings' (both written with what they time). */
export interface WindowBasis { months: Record<string, number>; meta?: number }
/**
 * `prev`: the window the last read kept, with the times it was read at. Their index is read first; only the months whose time
 * moved are read again (several in one query), and their settings only when theirs moved, so a friend with nothing new costs
 * the index alone. An index without a settings time (an account from before it) has the status read every time.
 */
export async function readFriendWindow(c: Cloud, uid: string, from: string, to: string, prev?: { from: string; win: FriendWindow; basis?: WindowBasis }): Promise<FriendWindow & { basis: WindowBasis }> {
  const { F, db } = c;
  const index = (await F.getDoc(F.doc(db, `users/${uid}/meta/index`))).data() ?? {};
  const times = (index.months ?? {}) as Record<string, number>, metaAt = index.meta as number | undefined;
  const want = Object.keys(times).filter((m) => m >= monthOf(from) && m <= monthOf(to)).sort();
  // The kept window holds every set of its months from its own `from` on: enough, unless this one starts earlier.
  const kept = prev?.basis && prev.from <= from ? { ...prev, basis: prev.basis } : null;
  const need = want.filter((m) => kept?.basis.months[m] !== times[m]);
  const [months, status] = await Promise.all([
    readMonths(c, uid, need, want),
    metaAt !== undefined && kept?.basis.meta === metaAt ? kept.win.status : readStatus(c, uid),
  ]);
  const sets = want.flatMap((m) => months.get(m) ?? kept?.win.sets.filter((s) => monthOf(s.date) === m) ?? []).filter((s) => s.date >= from);
  return { sets, status, basis: { months: Object.fromEntries(want.map((m) => [m, times[m]])), ...(metaAt !== undefined && { meta: metaAt }) } };
}
/** Months of a friend's log, by month: one read for one, one query for several (any between them it returns are fresh too). */
async function readMonths({ F, db }: Cloud, uid: string, need: string[], want: string[]): Promise<Map<string, SetEntry[]>> {
  const out = new Map<string, SetEntry[]>(need.map((m) => [m, []]));
  if (need.length === 1) {
    out.set(need[0], ((await F.getDoc(F.doc(db, `users/${uid}/months/${need[0]}`))).data() as CloudMonth | undefined)?.sets ?? []);
  } else if (need.length > 1) {
    const q = F.query(F.collection(db, `users/${uid}/months`), F.where(F.documentId(), '>=', need[0]), F.where(F.documentId(), '<=', need[need.length - 1]));
    for (const d of (await F.getDocs(q)).docs) if (want.includes(d.id)) out.set(d.id, (d.data() as CloudMonth).sets ?? []);
  }
  return out;
}
async function readStatus({ F, db }: Cloud, uid: string): Promise<string> {
  const raw = ((await F.getDoc(F.doc(db, `users/${uid}/meta/profile`))).data()?.items as Record<string, string> | undefined)?.status;
  try { return raw ? cleanStatus(JSON.parse(raw)) : ''; } catch { return ''; } // not a phrase
}

/** A gym a friend sent you, waiting under Friends until you add it or dismiss it. */
export interface SentGym { id: string; from: string; fromName: string; gym: Omit<Gym, 'id'>; sent: number }
export async function sendGym({ F, db }: Cloud, me: string, myName: string, to: string, g: Gym, now = Date.now()): Promise<void> {
  const { id: _id, ...gym } = g;
  const ref = await F.addDoc(F.collection(db, `users/${to}/gymInbox`), { from: me, fromName: myName, gym, sent: now });
  notifyFriend('gym', to, ref.id);
}
export async function listSentGyms({ F, db }: Cloud, me: string): Promise<SentGym[]> {
  return (await F.getDocs(F.collection(db, `users/${me}/gymInbox`))).docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<SentGym, 'id'> & { sent: number }) }))
    .sort((a, b) => a.sent - b.sent).map(({ id, from, fromName, gym, sent }) => ({ id, from, fromName, gym, sent }));
}
export async function clearSentGym({ F, db }: Cloud, me: string, id: string): Promise<void> {
  await F.deleteDoc(F.doc(db, `users/${me}/gymInbox/${id}`));
}

// ---- Pings and messages (users/{to}/inbox), with the sender's counter (users/{me}/sendRate/{to}). ----

const HOUR = 3600_000;
const PER_HOUR = 30;
interface RateDoc { at: { toMillis(): number }; win: { toMillis(): number }; n: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const COULDNT = 'Couldn’t send.';

/**
 * One ping or message: the inbox document and your counter in one write, as firestore.rules require (2 s apart, 30 an
 * hour to one friend). The hour is judged by this phone's clock; near its edge the server may judge otherwise, so a
 * refusal reads the counter again and tries the other way once. Someone who blocked or removed you: "Couldn't send".
 */
async function sendInbox(c: Cloud, me: string, to: string, data: { kind: 'p'; e: PresetKey } | { kind: 'm'; t: string }): Promise<string> {
  const { F, db } = c;
  const rateRef = F.doc(db, `users/${me}/sendRate/${to}`);
  const attempt = async (flip: boolean) => {
    const snap = await F.getDoc(rateRef);
    const r = snap.exists() ? (snap.data() as RateDoc) : null;
    const now = F.serverTimestamp();
    let next: Record<string, unknown> = { at: now, win: now, n: 1 };
    if (r) {
      const newHour = Date.now() - r.win.toMillis() >= HOUR;
      if (newHour === flip) {
        if (r.n >= PER_HOUR) throw fail('That’s 30 this hour. Try again later.');
        next = { at: now, win: r.win, n: r.n + 1 };
      }
      const wait = r.at.toMillis() + 2100 - Date.now();
      if (wait > 0 && wait <= 2100) await sleep(wait);
    }
    const ref = F.doc(F.collection(db, `users/${to}/inbox`));
    const b = F.writeBatch(db);
    b.set(ref, { from: me, ...data, at: now });
    b.set(rateRef, next);
    await b.commit();
    return ref.id;
  };
  const denied = (e: unknown) => (e as { code?: string }).code === 'permission-denied';
  let id: string;
  try { id = await attempt(false); } catch (e) {
    if (!denied(e)) throw e;
    try { id = await attempt(true); } catch (e2) { throw denied(e2) ? fail(COULDNT) : e2; }
  }
  notifyFriend('inbox', to, id);
  return id;
}
export const sendPing = (c: Cloud, me: string, to: string, e: PresetKey) => sendInbox(c, me, to, { kind: 'p', e });
export function sendMessage(c: Cloud, me: string, to: string, text: string) {
  const t = text.trim();
  if (!messageOk(t)) throw fail('Write 1 to 140 characters.');
  return sendInbox(c, me, to, { kind: 'm', t });
}

const inboxDoc = (d: { id: string; data(): Record<string, unknown> }): InboxDoc | null => {
  const x = d.data();
  const at = (x.at as { toMillis?(): number } | null)?.toMillis?.();
  if (typeof x.from !== 'string' || (x.kind !== 'p' && x.kind !== 'm') || at == null) return null;
  return { id: d.id, from: x.from, kind: x.kind, at, ...(typeof x.e === 'string' && { e: x.e }), ...(typeof x.t === 'string' && { t: x.t }) };
};
const docs = (q: { docs: { id: string; data(): Record<string, unknown> }[] }) => q.docs.map(inboxDoc).filter((d): d is InboxDoc => !!d);

/** What you sent one friend that's still in their inbox (you may read only your own there). Only they delete it, and nobody edits it. */
export async function listSent({ F, db }: Cloud, me: string, f: string): Promise<InboxDoc[]> {
  return docs(await F.getDocs(F.query(F.collection(db, `users/${f}/inbox`), F.where('from', '==', me))));
}

/** A thread from its parts: what you sent them, your inbox (theirs are picked from it) and the gyms sent to you (theirs, likewise). */
export function threadOf(mine: InboxDoc[], inbox: InboxDoc[], f: string, sentGyms: SentGym[]): { items: ThreadItem[]; gyms: SentGym[]; mine: InboxDoc[] } {
  const gyms = sentGyms.filter((g) => g.from === f);
  return { items: thread(mine, inbox.filter((d) => d.from === f), gyms.map((g) => ({ id: g.id, sent: g.sent, name: g.gym.name }))), gyms, mine };
}

/** You and one friend, read whole: what you sent them, what they sent you, and gyms from them. */
export async function listThread(c: Cloud, me: string, f: string): Promise<{ items: ThreadItem[]; gyms: SentGym[]; mine: InboxDoc[] }> {
  const { F, db } = c;
  const [mine, theirs, gyms] = await Promise.all([
    listSent(c, me, f),
    F.getDocs(F.query(F.collection(db, `users/${me}/inbox`), F.where('from', '==', f))),
    listSentGyms(c, me),
  ]);
  return threadOf(mine, docs(theirs), f, gyms);
}

/** Opening their thread: everything they sent so far is read. Only on your own list, so no read receipts. */
export async function markRead({ F, db }: Cloud, me: string, f: string): Promise<void> {
  await F.updateDoc(F.doc(db, `users/${me}/friends/${f}`), { readAt: F.serverTimestamp() });
}
/** Their pushes stop ringing on your phones (the Worker hears it through the notification settings). They aren't told. */
export async function setMuted({ F, db }: Cloud, me: string, f: string, muted: boolean): Promise<void> {
  await F.updateDoc(F.doc(db, `users/${me}/friends/${f}`), { muted });
}

async function clearIds({ F, db }: Cloud, me: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 50) {
    const b = F.writeBatch(db);
    for (const id of ids.slice(i, i + 50)) b.delete(F.doc(db, `users/${me}/inbox/${id}`));
    await b.commit();
  }
}
async function clearInboxFrom(c: Cloud, me: string, them: string): Promise<void> {
  const q = await c.F.getDocs(c.F.query(c.F.collection(c.db, `users/${me}/inbox`), c.F.where('from', '==', them)));
  await clearIds(c, me, q.docs.map((d) => d.id));
}

/**
 * Block: both friend documents, any request either way, and your invite links go, and they're written down as blocked,
 * in one write; then their pings and messages leave your inbox. The rules then refuse their requests, invites and pings.
 * Works for someone who only sent a request too.
 */
export async function blockFriend(c: Cloud, me: string, them: string): Promise<void> {
  const { F, db } = c;
  const invites = (await F.getDocs(F.collection(db, `users/${me}/invites`))).docs;
  const b = F.writeBatch(db);
  b.delete(F.doc(db, `users/${me}/friends/${them}`));
  b.delete(F.doc(db, `users/${them}/friends/${me}`));
  b.delete(F.doc(db, `users/${me}/requests/${them}`));
  b.delete(F.doc(db, `users/${them}/requests/${me}`));
  for (const d of invites) b.delete(d.ref);
  b.set(F.doc(db, `users/${me}/blocked/${them}`), { at: F.serverTimestamp() });
  await b.commit();
  await clearInboxFrom(c, me, them).catch(() => {});
}
export async function listBlocked(c: Cloud, me: string): Promise<Friend[]> {
  const ids = (await c.F.getDocs(c.F.collection(c.db, `users/${me}/blocked`))).docs.map((d) => d.id);
  return Promise.all(ids.map(async (uid) => ({ uid, name: await nameOf(c, uid) })));
}
export async function unblock({ F, db }: Cloud, me: string, them: string): Promise<void> {
  await F.deleteDoc(F.doc(db, `users/${me}/blocked/${them}`));
}

/** What's waiting under Friends: requests, gyms, and each friend's unread pings and messages, with the newest. */
export interface FriendNews {
  requests: number; gyms: number; total: number;
  unread: Record<string, number>;
  latest: Record<string, { text: string; at: number }>;
  /** The friend with the newest unread item, for Today's one-line banner. */
  top: { uid: string; name: string; text: string } | null;
  /** Friends you muted, for the notification settings. */
  muted: string[];
}
/** How far before the newest item held a read of what's new starts: two sends moments apart may commit out of order. */
const OVERLAP_MS = 60_000;
/**
 * Your inbox as it now stands: `held` (your inbox as last read) with what came after its newest (OVERLAP_MS before it); without
 * it, the whole inbox. What's held needs no re-read for deletes or edits: nobody edits an inbox document (firestore.rules), and
 * only this phone, or another of yours, deletes in your inbox, and only what `toClear` finds again on every news read.
 */
export async function readInbox({ F, db }: Cloud, me: string, held?: InboxDoc[]): Promise<InboxDoc[]> {
  const all = F.collection(db, `users/${me}/inbox`);
  const has = held?.length ? held : null;
  const since = has && F.query(all, F.where('at', '>', F.Timestamp.fromMillis(Math.max(...has.map((d) => d.at)) - OVERLAP_MS)));
  const byId = new Map((has ?? []).map((d) => [d.id, d]));
  for (const d of docs(await F.getDocs(since ?? all))) byId.set(d.id, d);
  return [...byId.values()];
}
/**
 * `known`: your inbox as the last read left it (state/friendCache keeps it), so only what came after its newest is read, not the
 * whole 30 days each time (readInbox); without it, the whole inbox. Every read hands back the inbox as it now stands, with what's
 * over 30 days old or from someone no longer a friend cleared. `names`: your friends' usernames as kept, for the banner.
 */
export async function friendNews(c: Cloud, me: string, now = Date.now(), known?: { inbox?: InboxDoc[]; names?: Record<string, string> }): Promise<FriendNews & { inbox: InboxDoc[] }> {
  const { F, db } = c;
  const [friendDocs, requests, gyms, inbox] = await Promise.all([
    F.getDocs(F.collection(db, `users/${me}/friends`)), listRequests(c, me), listSentGyms(c, me), readInbox(c, me, known?.inbox),
  ]);
  const friends = new Set(friendDocs.docs.map((d) => d.id));
  const readAt = Object.fromEntries(friendDocs.docs.map((d) => [d.id, (d.data().readAt as { toMillis?(): number } | undefined)?.toMillis?.()]));
  // Spark has no automatic expiry: this phone clears what's over 30 days old, or from someone who's no longer a friend.
  const stale = toClear(inbox, friends, now);
  if (stale.length) void clearIds(c, me, stale).catch(() => {});
  const kept = inbox.filter((d) => !stale.includes(d.id));
  const unread = unreadOf(kept, readAt, friends);
  const latest = Object.fromEntries(Object.entries(latestOf(kept)).map(([uid, d]) => [uid, { text: itemShort(d), at: d.at }]));
  const newest = kept.filter((d) => (unread[d.from] ?? 0) > 0).sort((a, b) => b.at - a.at)[0];
  const top = newest ? { uid: newest.from, name: known?.names?.[newest.from] ?? await nameOf(c, newest.from), text: itemShort(newest) } : null;
  const n = Object.values(unread).reduce((a, b) => a + b, 0);
  return {
    requests: requests.length, gyms: gyms.length, total: requests.length + gyms.length + n, unread, latest, top,
    muted: friendDocs.docs.filter((d) => d.data().muted === true).map((d) => d.id),
    inbox: kept,
  };
}

/** For a thread opened from a notification, by uid alone: their name, whether they're still a friend, whether muted. */
export async function friendState(c: Cloud, me: string, uid: string): Promise<{ name: string; friend: boolean; muted: boolean }> {
  const [name, d] = await Promise.all([nameOf(c, uid), c.F.getDoc(c.F.doc(c.db, `users/${me}/friends/${uid}`))]);
  return { name, friend: d.exists(), muted: d.data()?.muted === true };
}
