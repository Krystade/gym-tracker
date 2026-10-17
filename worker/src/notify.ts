import { acceptedNote, gymNote, requestNote, type FriendKind, type Route } from '../../src/push/payload';
import type { Env } from './env';
import { getDoc, type Doc } from './firestore';

// POST /notify: the sender says what they just wrote to Firestore, and the Worker checks it there, as the sender, before the
// recipient's Durable Object hears of it. Nothing in the push comes from the request: the name is the sender's profile,
// the text is the Worker's own (or the stored document's). See docs/superpowers/plans/2026-10-16-push-and-messages.md.

export class Refused extends Error {}

/** A document written within the last minute, by Firestore's clock. */
export const FRESH_MS = 60_000;
const SKEW_MS = 60_000;

export interface Claim { kind: 'request' | 'accepted' | 'gym'; to: string; id?: string }

/** What the recipient's Durable Object is asked to deliver. */
export interface FriendPush {
  kind: FriendKind;
  from: string;
  /** The same claim twice (a replayed /notify) has the same key and sends nothing the second time. */
  key: string;
  note: { title: string; body: string };
  route: Route;
  /** At most one push a day with this key (a friend request: asking again and again doesn't ring again and again). */
  daily?: string;
}

type Env4 = Pick<Env, 'AUTH_EMULATOR' | 'FIREBASE_PROJECT' | 'FIRESTORE_EMULATOR'>;

const fresh = (d: Doc, now: number) => d.createTime > now - FRESH_MS && d.createTime < now + SKEW_MS;
const exists = (d: Doc | null | 'denied'): d is Doc => d != null && d !== 'denied';

/** The sender's username from their own profile; any signed-in person may read a profile's name. */
async function nameOf(env: Env4, token: string, uid: string): Promise<string> {
  const d = await getDoc(env, token, ['users', uid]);
  const n = exists(d) ? d.fields.username : null;
  return typeof n === 'string' && /^[a-z0-9_]{3,20}$/.test(n) ? n : 'A friend';
}

/**
 * Checks a claim against Firestore with the sender's token. Returns the push for the recipient, or throws Refused.
 *
 * - request: their request to `to` exists (the rules let its sender read it) and was made in the last minute.
 * - accepted: `to` counts the sender as a friend. Reading `users/{to}/meta/__probe` is allowed only to `to`'s friends, so
 *   404 proves it and 403 disproves it. The sender's own list naming `to` must be new too; anyone can add anyone to
 *   their own list, which is why that alone proves nothing.
 * - gym: the gym in `to`'s inbox is from the sender (the sender may read only their own) and new.
 */
export async function check(env: Env4, token: string, me: string, c: Claim, now: number): Promise<FriendPush> {
  if (c.to === me) throw new Refused('self');
  switch (c.kind) {
    case 'request': {
      const d = await getDoc(env, token, ['users', c.to, 'requests', me]);
      if (!exists(d) || !fresh(d, now)) throw new Refused('request');
      return { kind: 'request', from: me, key: `request:${me}:${d.createTime}`, note: requestNote(await nameOf(env, token, me)), route: 'friends', daily: `request:${me}` };
    }
    case 'accepted': {
      const probe = await getDoc(env, token, ['users', c.to, 'meta', '__probe']);
      if (probe === 'denied') throw new Refused('not friends');
      const mine = await getDoc(env, token, ['users', me, 'friends', c.to]);
      if (!exists(mine) || !fresh(mine, now)) throw new Refused('accepted');
      return { kind: 'accepted', from: me, key: `accepted:${me}:${mine.createTime}`, note: acceptedNote(await nameOf(env, token, me)), route: `friend.${me}` };
    }
    case 'gym': {
      const d = await getDoc(env, token, ['users', c.to, 'gymInbox', c.id!]);
      if (!exists(d) || d.fields.from !== me || !fresh(d, now)) throw new Refused('gym');
      const gym = d.fields.gym as { name?: unknown } | undefined;
      return { kind: 'gym', from: me, key: `gym:${c.id}`, note: gymNote(await nameOf(env, token, me), typeof gym?.name === 'string' ? gym.name : ''), route: `friend.${me}` };
    }
  }
}
