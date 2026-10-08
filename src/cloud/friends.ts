import type { BodyDay } from '../domain/body';
import type { CloudMonth, MetaItems } from '../domain/cloud';
import { newToken, type Invite } from '../domain/invite';
import type { SetEntry } from '../domain/types';
import type { Cloud } from './firebase';

// Friendship is two documents, users/A/friends/B and users/B/friends/A: A's list naming B is what lets B read A's log.
// firestore.rules decides who may write each; these functions only make the writes the rules allow.

export interface Friend { uid: string; name: string }
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

/** Both sides of the friendship in one write; the rules let you into their list because you hold their live invite. */
export async function acceptInvite(c: Cloud, me: string, inv: Invite, now = Date.now()): Promise<string> {
  const { F, db } = c;
  if (inv.uid === me) throw fail('That’s your own invite link. Send it to a friend.');
  if ((await F.getDoc(F.doc(db, `users/${me}/friends/${inv.uid}`))).exists()) throw fail(`You’re already friends with ${await nameOf(c, inv.uid)}.`);
  const b = F.writeBatch(db);
  b.set(F.doc(db, `users/${inv.uid}/friends/${me}`), { since: now, via: inv.token });
  b.set(F.doc(db, `users/${me}/friends/${inv.uid}`), { since: now, via: 'invite' });
  try { await b.commit(); } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') throw fail('That invite has expired or was cancelled. Ask for a new link.');
    throw e;
  }
  return nameOf(c, inv.uid);
}

/** Asks someone by exact username. If they already asked you, this accepts theirs instead. */
export async function sendRequest(c: Cloud, me: string, myName: string, to: string, now = Date.now()): Promise<'sent' | 'accepted'> {
  const { F, db } = c;
  const them = (await F.getDoc(F.doc(db, `usernames/${to}`))).data()?.uid as string | undefined;
  if (!them) throw fail(`No one goes by “${to}”. Check the spelling.`);
  if (them === me) throw fail('That’s you.');
  if ((await F.getDoc(F.doc(db, `users/${me}/friends/${them}`))).exists()) throw fail(`You’re already friends with ${to}.`);
  if ((await F.getDoc(F.doc(db, `users/${me}/requests/${them}`))).exists()) { await acceptRequest(c, me, them, now); return 'accepted'; }
  const ref = F.doc(db, `users/${them}/requests/${me}`);
  if ((await F.getDoc(ref)).exists()) throw fail(`You’ve already asked ${to}. They’ll see it under Friends.`);
  await F.setDoc(ref, { username: myName, sent: now });
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
}
export async function declineRequest({ F, db }: Cloud, me: string, from: string): Promise<void> {
  await F.deleteDoc(F.doc(db, `users/${me}/requests/${from}`));
}

export async function listFriends(c: Cloud, me: string): Promise<Friend[]> {
  const ids = (await c.F.getDocs(c.F.collection(c.db, `users/${me}/friends`))).docs.map((d) => d.id);
  const out = await Promise.all(ids.map(async (uid) => ({ uid, name: await nameOf(c, uid) })));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
/** Both documents go, so neither of you can read the other's log any more. */
export async function removeFriend({ F, db }: Cloud, me: string, them: string): Promise<void> {
  const b = F.writeBatch(db);
  b.delete(F.doc(db, `users/${me}/friends/${them}`));
  b.delete(F.doc(db, `users/${them}/friends/${me}`));
  await b.commit();
}

/** A friend's whole log and settings, read-only: every month in their index, and their settings document. */
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
