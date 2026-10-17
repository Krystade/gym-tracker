import { acceptedNote, gymNote, messageNote, pingNote, requestNote, type FriendKind, type Route } from '../../src/push/payload';
import type { Env } from './env';
import { getDoc, type Doc } from './firestore';

// POST /notify: the sender says what they just wrote to Firestore, and the Worker checks it there, as the sender, before the
// recipient's Durable Object hears of it. Nothing in the push comes from the request: the name is the sender's profile,
// the text is the Worker's own (or the stored document's). See docs/superpowers/plans/2026-10-16-push-and-messages.md.

export class Refused extends Error {}

/** A document written within the last minute, by Firestore's clock. */
export const FRESH_MS = 60_000;
const SKEW_MS = 60_000;

export interface Claim { kind: 'request' | 'accepted' | 'gym' | 'inbox'; to: string; id?: string }

/** What the recipient's Durable Object is asked to deliver. */
export interface FriendPush {
  kind: FriendKind;
  from: string;
  /** The same claim twice (a replayed /notify) has the same key and sends nothing the second time. */
  key: string;
  note: { title: string; body: string };
  route: Route;
  /** Something that waits in the app until it's seen (a request, a gym, a ping or message): it counts on the icon's badge. */
  unread: boolean;
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

/** `to` counts the sender as a friend: only their friends may read `users/{to}/meta/*`, so an absent one answers 404, not 403. */
async function friendOf(env: Env4, token: string, to: string): Promise<void> {
  if ((await getDoc(env, token, ['users', to, 'meta', '__probe'])) === 'denied') throw new Refused('not friends');
}

/**
 * Checks a claim against Firestore with the sender's token. Returns the push for the recipient, or throws Refused.
 *
 * - request: their request to `to` exists (the rules let its sender read it) and was made in the last minute.
 * - accepted: `to` counts the sender as a friend. Reading `users/{to}/meta/__probe` is allowed only to `to`'s friends, so
 *   404 proves it and 403 disproves it. The sender's own list naming `to` must be new too; anyone can add anyone to
 *   their own list, which is why that alone proves nothing.
 * - gym: the gym in `to`'s inbox is from the sender (the sender may read only their own) and new, and they're still friends.
 * - inbox: likewise for a ping or message; its words are the stored ping's or the stored text, never the request's.
 */
export async function check(env: Env4, token: string, me: string, c: Claim, now: number): Promise<FriendPush> {
  if (c.to === me) throw new Refused('self');
  switch (c.kind) {
    case 'request': {
      const d = await getDoc(env, token, ['users', c.to, 'requests', me]);
      if (!exists(d) || !fresh(d, now)) throw new Refused('request');
      return { kind: 'request', from: me, key: `request:${me}:${d.createTime}`, note: requestNote(await nameOf(env, token, me)), route: 'friends', unread: true, daily: `request:${me}` };
    }
    case 'accepted': {
      await friendOf(env, token, c.to);
      const mine = await getDoc(env, token, ['users', me, 'friends', c.to]);
      if (!exists(mine) || !fresh(mine, now)) throw new Refused('accepted');
      return { kind: 'accepted', from: me, key: `accepted:${me}:${mine.createTime}`, note: acceptedNote(await nameOf(env, token, me)), route: `friend.${me}`, unread: false };
    }
    case 'gym': {
      const d = await getDoc(env, token, ['users', c.to, 'gymInbox', c.id!]);
      if (!exists(d) || d.fields.from !== me || !fresh(d, now)) throw new Refused('gym');
      await friendOf(env, token, c.to);
      const gym = d.fields.gym as { name?: unknown } | undefined;
      return { kind: 'gym', from: me, key: `gym:${c.id}`, note: gymNote(await nameOf(env, token, me), typeof gym?.name === 'string' ? gym.name : ''), route: `friend.${me}`, unread: true };
    }
    case 'inbox': {
      const d = await getDoc(env, token, ['users', c.to, 'inbox', c.id!]);
      if (!exists(d) || d.fields.from !== me || !fresh(d, now)) throw new Refused('inbox');
      await friendOf(env, token, c.to);
      const name = await nameOf(env, token, me), base = { from: me, key: `inbox:${c.id}`, route: `friend.${me}` as const, unread: true };
      if (d.fields.kind === 'p') return { ...base, kind: 'ping', note: pingNote(name, d.fields.e) };
      if (d.fields.kind === 'm' && typeof d.fields.t === 'string' && d.fields.t) return { ...base, kind: 'message', note: messageNote(name, d.fields.t) };
      throw new Refused('inbox');
    }
  }
}
