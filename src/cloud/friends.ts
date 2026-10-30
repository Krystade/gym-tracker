import type { Gym } from '../domain/equipment';
import { monthOf, type CloudMonth, type MetaItems } from '../domain/cloud';
import { itemShort, latestOf, messageOk, thread, toClear, unreadOf, type InboxDoc, type PresetKey, type ThreadItem } from '../domain/messages';
import { cleanStatus } from '../domain/crew';
import { defaultProfile } from '../domain/profile';
import { isPlaceKey } from '../domain/place';
import { newToken, type Invite } from '../domain/invite';
import { CHANGE_GAP_MS, nextChangeAt } from '../domain/friendNames';
import { cleanDisplayName, displayNameError, displayOf, NAME_GAP_MS, nextNameAt } from '../domain/displayName';
import type { SetEntry } from '../domain/types';
import { notifyFriend } from '../push/client';
import { counted, limitHit, socialNext, whyRefused, withTries } from './limits';
import type { Cloud } from './firebase';

// Friendship is two documents, users/A/friends/B and users/B/friends/A: A's list naming B is what lets B read A's log.
// firestore.rules decides who may write each; these functions only make the writes the rules allow. After a write a friend
// would want to hear about, the push Worker is told (notifyFriend): it checks the write in Firestore itself, and a failure
// there never fails the write.

export interface Friend {
  uid: string; name: string; /** Their display name, when they've set one (domain/displayName): shown beside the @username. */ dn?: string;
  /** You muted their pushes (only you know). */ muted?: boolean;
  /** Their username before their last change, and when that was (ms): "formerly @prev" shows for 30 days (domain/friendNames). */
  prev?: string; changedAt?: number;
  /** When you became friends (ms), where known: Compare gives each friend a colour in this order (domain/compare personColours). */ since?: number;
}
export interface Request { uid: string; name: string; dn?: string }
const WEEK = 7 * 864e5;
const fail = (text: string) => Object.assign(new Error(text), { plain: true });

/**
 * A profile as anyone signed in reads it: the name, what it was before its last change and when; the display name (none: the old
 * shape, the username itself) and when it last changed; when the account first had a profile (none: one from before it).
 */
export interface Profile {
  name: string; prev?: string; changedAt?: number; dn?: string; nameAt?: number; createdAt?: number;
  /** Friend requests by invite link only (firestore.rules refuse a request then); none: from anyone. */ reqs?: 'invite';
}
const millis = (v: unknown) => (v as { toMillis?(): number } | null | undefined)?.toMillis?.();
function profileFrom(d: Record<string, unknown> | undefined): Profile | null {
  if (typeof d?.username !== 'string') return null;
  const changedAt = millis(d.changedAt), nameAt = millis(d.nameAt), createdAt = millis(d.createdAt), dn = displayOf(d.username, d.displayName);
  return {
    name: d.username, ...(typeof d.prev === 'string' && { prev: d.prev }), ...(changedAt != null && { changedAt }),
    ...(dn && { dn }), ...(nameAt != null && { nameAt }), ...(createdAt != null && { createdAt }), ...(d.reqs === 'invite' && { reqs: 'invite' as const }),
  };
}
export async function myProfile({ F, db }: Cloud, uid: string): Promise<Profile | null> {
  return profileFrom((await F.getDoc(F.doc(db, `users/${uid}`))).data());
}
export async function myUsername(c: Cloud, uid: string): Promise<string | null> {
  return (await myProfile(c, uid))?.name ?? null;
}
const nameOf = async (c: Cloud, uid: string) => (await myProfile(c, uid))?.name ?? 'someone';

const ONCE_A_DAY = (at: number) => `You can change your username once a day. Try again after ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`;
/**
 * Claims a username, or changes yours: one transaction, so two people can't take the same name, and the change is whole
 * (firestore.rules hold it to that): the new name claimed, the old one released, and the profile naming the new one with
 * the old one and the server's time beside it, at most once a day. Friends, threads and everything else go by uid.
 */
export async function claimUsername({ F, db }: Cloud, uid: string, name: string): Promise<void> {
  let soonest: number | null = null;
  try {
    await F.runTransaction(db, async (tx) => {
      const ref = F.doc(db, `usernames/${name}`), meRef = F.doc(db, `users/${uid}`);
      const [taken, me] = [await tx.get(ref), await tx.get(meRef)];
      if (taken.exists() && taken.data().uid !== uid) throw fail(`“${name}” is taken. Try another.`);
      const p = profileFrom(me.data());
      if (p?.name === name) return;
      if (p) {
        const next = nextChangeAt(p.changedAt, Date.now());
        if (next != null) throw fail(ONCE_A_DAY(next));
        soonest = (p.changedAt ?? Date.now()) + CHANGE_GAP_MS; // what to say if the server's clock calls it too soon
      }
      if (!taken.exists()) tx.set(ref, { uid });
      if (p) tx.delete(F.doc(db, `usernames/${p.name}`));
      // A change updates the profile in place, so a display name and the times beside it stay; with none set (the old shape, the
      // display name the username itself) it follows the new name.
      if (p) tx.update(meRef, { username: name, prev: p.name, changedAt: F.serverTimestamp(), ...(me.data()?.displayName === p.name && { displayName: name }) });
      else tx.set(meRef, { username: name, displayName: name, createdAt: F.serverTimestamp() });
    });
  } catch (e) {
    // A change the rules refused: the once-a-day rule by the server's clock (the rest the transaction checked itself).
    if (soonest != null && (e as { code?: string }).code === 'permission-denied') throw fail(ONCE_A_DAY(soonest));
    throw e;
  }
}

const NAME_ONCE_A_DAY = (at: number) => `You can change your display name once a day. Try again after ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`;
/**
 * Sets your display name, or clears it ('' : the old shape, the username itself). Cleaned and checked as the form does
 * (domain/displayName); at most once a day by the server's clock (firestore.rules: nameAt is the server's time, a day apart).
 * Returns the name as kept ('' for none). The same name again writes nothing.
 */
export async function setDisplayName(c: Cloud, uid: string, raw: string): Promise<string> {
  const { F, db } = c;
  const dn = cleanDisplayName(raw);
  const bad = displayNameError(dn);
  if (bad) throw fail(bad);
  const p = await myProfile(c, uid);
  if (!p) throw fail('Choose a username first.');
  if ((p.dn ?? '') === dn || (!p.dn && dn === p.name)) return p.dn ?? '';
  const next = nextNameAt(p.nameAt, Date.now());
  if (next != null) throw fail(NAME_ONCE_A_DAY(next));
  try {
    await F.updateDoc(F.doc(db, `users/${uid}`), { displayName: dn || p.name, nameAt: F.serverTimestamp() });
  } catch (e) {
    // The rules refused: by the server's clock it's within the day (the rest was checked here).
    if ((e as { code?: string }).code === 'permission-denied' && p.nameAt != null) throw fail(NAME_ONCE_A_DAY(p.nameAt + NAME_GAP_MS));
    throw e;
  }
  return dn === p.name ? '' : dn;
}
/**
 * A profile from before `createdAt` (social S1) gets one, the server's time now (firestore.rules let it be added once, never
 * moved): the board's day-old gate counts from it. Nothing to do once it's there.
 */
export async function ensureCreatedAt({ F, db }: Cloud, uid: string, p: Profile | null): Promise<void> {
  if (p && p.createdAt == null) await F.updateDoc(F.doc(db, `users/${uid}`), { createdAt: F.serverTimestamp() });
}

/** Who may send you a friend request: anyone with your username, or nobody (invite links only). firestore.rules hold it. */
export async function setRequestsFrom({ F, db }: Cloud, uid: string, reqs: 'any' | 'invite'): Promise<void> {
  await F.updateDoc(F.doc(db, `users/${uid}`), { reqs });
}

/**
 * Who the app's owner has verified (the ✓, social S2): uid → when (ms). One document, `config/verified`, anyone signed in reads and
 * only an owner writes (firestore.rules OWNERS, cloud/owner). Keyed by uid, so a changed username keeps it (owner, 2026-10-22).
 */
export async function readVerified({ F, db }: Cloud): Promise<Record<string, number>> {
  const uids = (await F.getDoc(F.doc(db, 'config/verified'))).data()?.uids;
  if (!uids || typeof uids !== 'object') return {};
  return Object.fromEntries(Object.entries(uids as Record<string, unknown>).map(([k, v]) => [k, millis(v) ?? 0]));
}
/** The owner grants or removes someone's ✓: read and rewritten whole in one transaction, so two changes can't undo each other. */
export async function setVerified({ F, db }: Cloud, uid: string, on: boolean): Promise<void> {
  await F.runTransaction(db, async (tx) => {
    const ref = F.doc(db, 'config/verified');
    const uids = { ...((await tx.get(ref)).data()?.uids as Record<string, unknown> | undefined) };
    if (on === uid in uids) return;
    if (on) uids[uid] = F.serverTimestamp();
    else delete uids[uid];
    tx.set(ref, { uids });
  });
}

/** Your one live invite: making a new one ends the old. Counted (cloud/limits). */
export async function makeInvite(c: Cloud, uid: string, now = Date.now()): Promise<Invite> {
  const { F, db } = c;
  const token = newToken();
  const old = (await F.getDocs(F.collection(db, `users/${uid}/invites`))).docs;
  await counted(c, uid, null, (b) => {
    for (const d of old) b.delete(d.ref);
    b.set(F.doc(db, `users/${uid}/invites/${token}`), { created: F.Timestamp.fromMillis(now), expires: F.Timestamp.fromMillis(now + WEEK) });
  }, now);
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
  try { await counted(c, me, 'requests', (b) => b.set(ref, { username: myName, sent: now }), now); } catch (e) {
    // Refused: they take friends by invite link only (or blocked you, which this mustn't say).
    if ((e as { code?: string }).code === 'permission-denied') throw fail(`@${to} takes new friends by invite link only. Ask them for one.`);
    throw e;
  }
  notifyFriend('request', them);
  return 'sent';
}
/** Each by its sender's name now (read from their profile by uid), not the one the request was sent under. */
export async function listRequests(c: Cloud, me: string): Promise<Request[]> {
  const docs = (await c.F.getDocs(c.F.collection(c.db, `users/${me}/requests`))).docs;
  return Promise.all(docs.map(async (d) => {
    const p = await myProfile(c, d.id);
    return { uid: d.id, name: p?.name ?? (d.data().username as string | undefined) ?? 'someone', ...(p?.dn && { dn: p.dn }) };
  }));
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
  const out = await Promise.all(docs.map(async (d) => {
    const { name, dn, prev, changedAt } = (await myProfile(c, d.id)) ?? { name: 'someone' };
    const since = d.data().since;
    return {
      uid: d.id, name, ...(dn && { dn }), ...(prev && { prev }), ...(changedAt != null && { changedAt }),
      ...(d.data().muted === true && { muted: true }), ...(typeof since === 'number' && { since }),
    };
  }));
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

/**
 * A friend's whole log and settings, read-only: every month in their index, and their settings document (day plans: the recent
 * ones, cloud/sync PLAN_DAYS). Their sets only: the body days their months carry (weight, energy) are dropped as read, since
 * friends never see a friend's body weight (owner, 2026-10-21).
 */
export interface FriendData { sets: SetEntry[]; meta: MetaItems }
export async function readFriend({ F, db }: Cloud, uid: string): Promise<FriendData> {
  const index = ((await F.getDoc(F.doc(db, `users/${uid}/meta/index`))).data()?.months ?? {}) as Record<string, number>;
  const [months, metaDoc] = await Promise.all([
    Promise.all(Object.keys(index).map(async (m) => (await F.getDoc(F.doc(db, `users/${uid}/months/${m}`))).data() as CloudMonth | undefined)),
    F.getDoc(F.doc(db, `users/${uid}/meta/profile`)),
  ]);
  const items = (metaDoc.data()?.items ?? {}) as Record<string, string>;
  return {
    sets: months.flatMap((m) => m?.sets ?? []),
    meta: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, JSON.parse(v) as unknown])),
  };
}

/**
 * What Crew needs of a friend: their sets from `from` on, in the months up to `to`'s, and their status phrase. Only the months
 * that window touches are read, never the whole history; nothing else in their settings is kept (and cycle data is never in what
 * a friend can read). A set dated after `to` (a friend a time zone ahead) is kept: Crew shows up to today, and the month it's in
 * may never change again to bring it back.
 */
export interface FriendWindow {
  sets: SetEntry[]; status: string;
  /** Their sessions-a-week goal, from the settings read that brings the status (none: a window kept by an older version). */
  goal?: number;
  /**
   * The day their achievements count from (their synced `achievements` item), from the same read: Together counts from the
   * later of theirs and yours (domain/together). Null: they haven't started (an older app). None: a window kept by an older version.
   */
  start?: string | null;
  /**
   * Their Location for Together key (their profile's `placeKey`), from the same read: your phone pairs it with yours for the
   * codes your sets carry (domain/place). Null: theirs is off. None: a window kept by an older version.
   */
  loc?: string | null;
  /** Per month, the PR set ids their phone wrote into that month's document (cloud/sync); a month written by an older app isn't here. */
  prs?: Record<string, string[]>;
}
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
  // Their goal, start and key came with the status from a newer version only: a window kept without them reads their settings once more.
  const keptGoal = kept?.win.goal, keptStart = kept?.win.start, keptLoc = kept?.win.loc;
  const [months, bits] = await Promise.all([
    readMonths(c, uid, need, want),
    metaAt !== undefined && kept?.basis.meta === metaAt && keptGoal !== undefined && keptStart !== undefined && keptLoc !== undefined
      ? { status: kept.win.status, goal: keptGoal, start: keptStart, loc: keptLoc } : readSettingsBits(c, uid),
  ]);
  const sets = want.flatMap((m) => months.get(m)?.sets ?? kept?.win.sets.filter((s) => monthOf(s.date) === m) ?? []).filter((s) => s.date >= from);
  const prs: Record<string, string[]> = {};
  for (const m of want) {
    const p = months.has(m) ? months.get(m)!.prs : kept?.win.prs?.[m];
    if (p) prs[m] = p;
  }
  return { sets, status: bits.status, goal: bits.goal, start: bits.start, loc: bits.loc, prs, basis: { months: Object.fromEntries(want.map((m) => [m, times[m]])), ...(metaAt !== undefined && { meta: metaAt }) } };
}
/** A month as a friend's window keeps it: its sets, and the PR ids its document carries (none: an older app wrote it). */
interface MonthRead { sets: SetEntry[]; prs?: string[] }
const monthRead = (d: CloudMonth | undefined): MonthRead => ({ sets: d?.sets ?? [], ...(Array.isArray(d?.prs) && { prs: d.prs.filter((x): x is string => typeof x === 'string') }) });
/** Months of a friend's log, by month: one read for one, one query for several (any between them it returns are fresh too). */
async function readMonths({ F, db }: Cloud, uid: string, need: string[], want: string[]): Promise<Map<string, MonthRead>> {
  const out = new Map<string, MonthRead>(need.map((m) => [m, { sets: [] }]));
  if (need.length === 1) {
    out.set(need[0], monthRead((await F.getDoc(F.doc(db, `users/${uid}/months/${need[0]}`))).data() as CloudMonth | undefined));
  } else if (need.length > 1) {
    const q = F.query(F.collection(db, `users/${uid}/months`), F.where(F.documentId(), '>=', need[0]), F.where(F.documentId(), '<=', need[need.length - 1]));
    for (const d of (await F.getDocs(q)).docs) if (want.includes(d.id)) out.set(d.id, monthRead(d.data() as CloudMonth));
  }
  return out;
}
/**
 * From their settings document, only the status phrase, the sessions-a-week goal (2, the app's default, when unset or odd), the
 * day their achievements count from (null: none, or not a day) and their Location for Together key (null: off, or not a key).
 */
async function readSettingsBits({ F, db }: Cloud, uid: string): Promise<{ status: string; goal: number; start: string | null; loc: string | null }> {
  const items = (await F.getDoc(F.doc(db, `users/${uid}/meta/profile`))).data()?.items as Record<string, string> | undefined;
  let status = '', goal = defaultProfile().weeklyGoal, start: string | null = null, loc: string | null = null;
  try {
    const v = items?.achievements ? JSON.parse(items.achievements) as unknown : null;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) start = v;
  } catch { /* not a day */ }
  try { status = items?.status ? cleanStatus(JSON.parse(items.status)) : ''; } catch { /* not a phrase */ }
  try {
    const p = items?.profile ? JSON.parse(items.profile) as { weeklyGoal?: unknown; placeKey?: unknown } | null : undefined;
    const g = p?.weeklyGoal, k = p?.placeKey;
    if (typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 7) goal = g;
    if (isPlaceKey(k)) loc = k;
  } catch { /* not a profile */ }
  return { status, goal, start, loc };
}

/** A gym a friend sent you, waiting under Friends until you add it or dismiss it. */
export interface SentGym { id: string; from: string; fromName: string; gym: Omit<Gym, 'id'>; sent: number }
export async function sendGym(c: Cloud, me: string, myName: string, to: string, g: Gym, now = Date.now()): Promise<void> {
  const { F, db } = c;
  const { id: _id, ...gym } = g;
  const ref = F.doc(F.collection(db, `users/${to}/gymInbox`));
  await counted(c, me, 'messages', (b) => b.set(ref, { from: me, fromName: myName, gym, sent: now }), now);
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
  const attempt = async (flip: boolean, off: number) => {
    const snap = await F.getDoc(rateRef);
    const r = snap.exists() ? (snap.data() as RateDoc) : null;
    const now = F.serverTimestamp();
    let next: Record<string, unknown> = { at: now, win: now, n: 1 };
    if (r) {
      const newHour = Date.now() - r.win.toMillis() >= HOUR;
      if (newHour === flip) {
        if (r.n >= PER_HOUR) { limitHit('send', to); throw fail('That’s 30 this hour. Try again later.'); }
        next = { at: now, win: r.win, n: r.n + 1 };
      }
      const wait = r.at.toMillis() + 2100 - Date.now();
      if (wait > 0 && wait <= 2100) await sleep(wait);
    }
    const ref = F.doc(F.collection(db, `users/${to}/inbox`));
    const counters = await socialNext(c, me, Date.now(), false, off);
    const b = F.writeBatch(db);
    b.set(ref, { from: me, ...data, at: now });
    b.set(rateRef, next);
    counters(b);
    await b.commit();
    return ref.id;
  };
  const id = await withTries(attempt, async () => (await whyRefused(c, 'messages')) ?? fail(COULDNT));
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

/** For a thread opened from a notification, by uid alone: their name (and display name), whether they're still a friend, whether muted. */
export async function friendState(c: Cloud, me: string, uid: string): Promise<{ name: string; dn?: string; friend: boolean; muted: boolean }> {
  const [p, d] = await Promise.all([myProfile(c, uid), c.F.getDoc(c.F.doc(c.db, `users/${me}/friends/${uid}`))]);
  return { name: p?.name ?? 'someone', ...(p?.dn && { dn: p.dn }), friend: d.exists(), muted: d.data()?.muted === true };
}
