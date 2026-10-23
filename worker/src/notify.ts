import { acceptedNote, gymNote, limitNote, messageNote, pingNote, reportNote, requestNote, type FriendKind, type ModKind, type Route } from '../../src/push/payload';
import { dayId, GLOBAL_PER_DAY, SOCIAL_PER_DAY, type LimitId } from '../../src/domain/limits';
import { displayOf } from '../../src/domain/displayName';
import { OWNERS } from '../../src/cloud/owner';
import type { Env } from './env';
import { getDoc, type Doc } from './firestore';

// POST /notify: the sender says what they just wrote to Firestore, and the Worker checks it there, as the sender, before the
// recipient's Durable Object hears of it. Nothing in the push comes from the request: the name is the sender's profile,
// the text is the Worker's own (or the stored document's). See docs/superpowers/plans/2026-10-16-push-and-messages.md.

export class Refused extends Error {}

/** A document written within the last minute, by Firestore's clock. */
export const FRESH_MS = 60_000;
const SKEW_MS = 60_000;

export interface Claim { kind: 'request' | 'accepted' | 'gym' | 'inbox' | 'report' | 'limit'; to: string; id?: string }

/** What the recipient's Durable Object is asked to deliver. */
export interface FriendPush {
  kind: FriendKind | ModKind;
  from: string;
  /** The same claim twice (a replayed /notify) has the same key and sends nothing the second time. */
  key: string;
  note: { title: string; body: string };
  route: Route;
  /** Something that waits in the app until it's seen (a request, a gym, a ping or message): it counts on the icon's badge. */
  unread: boolean;
  /** At most one push a day with this key (a friend request: asking again and again doesn't ring again and again). */
  daily?: string;
  /** The sender's username, when their profile has a proper one: the phone puts its own tag for them beside it. */
  name?: string;
  /** Their display name, when they set one the app allows (social S1): the phone leads with it, the username beside it. */
  dn?: string;
}

type Env4 = Pick<Env, 'AUTH_EMULATOR' | 'FIREBASE_PROJECT' | 'FIRESTORE_EMULATOR'>;

const fresh = (d: Doc, now: number) => d.createTime > now - FRESH_MS && d.createTime < now + SKEW_MS;
const exists = (d: Doc | null | 'denied'): d is Doc => d != null && d !== 'denied';

/**
 * The sender's username from their own profile (any signed-in person may read a profile's name), and their display name when
 * it's one the app allows (domain/displayName displayOf: one written round the app is dropped); null without a proper username.
 */
async function profileOf(env: Env4, token: string, uid: string): Promise<{ name: string; dn?: string } | null> {
  const d = await getDoc(env, token, ['users', uid]);
  const n = exists(d) ? d.fields.username : null;
  if (!exists(d) || typeof n !== 'string' || !/^[a-z0-9_]{3,20}$/.test(n)) return null;
  const dn = displayOf(n, d.fields.displayName);
  return { name: n, ...(dn && { dn }) };
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
 * - report (social S4): the sender's report on board post `id` exists (only its reporter, or an owner, may read it) and was
 *   made in the last minute. It rings the app's owners alone, whoever `to` names (`recipients`), and says nothing of who
 *   reported what. An owner's own reports ring nobody.
 */
export async function check(env: Env4, token: string, me: string, c: Claim, now: number): Promise<FriendPush> {
  if (c.kind === 'limit') return limitCheck(env, token, me, c.id as LimitId, c.to, now);
  if (c.to === me) throw new Refused('self');
  if (c.kind === 'report') {
    if (OWNERS.includes(me)) throw new Refused('self');
    const d = await getDoc(env, token, ['board', c.id!, 'reports', me]);
    if (!exists(d) || !fresh(d, now)) throw new Refused('report');
    return { kind: 'report', from: me, key: `report:${c.id}:${me}`, note: reportNote(), route: 'review', unread: false, daily: 'report' };
  }
  /**
   * The sender's username for the words ("A friend" without a proper one), and carried as `name` only when it is one, with their
   * display name as `dn`: the words stay the username's, and the phone puts the display name (or your tag) before it (sw-push).
   */
  const sender = async () => {
    const p = await profileOf(env, token, me);
    return { said: p?.name ?? 'A friend', ...(p && { name: p.name }), ...(p?.dn && { dn: p.dn }) };
  };
  switch (c.kind) {
    case 'request': {
      const d = await getDoc(env, token, ['users', c.to, 'requests', me]);
      if (!exists(d) || !fresh(d, now)) throw new Refused('request');
      const { said, ...name } = await sender();
      return { kind: 'request', from: me, ...name, key: `request:${me}:${d.createTime}`, note: requestNote(said), route: 'friends', unread: true, daily: `request:${me}` };
    }
    case 'accepted': {
      await friendOf(env, token, c.to);
      const mine = await getDoc(env, token, ['users', me, 'friends', c.to]);
      if (!exists(mine) || !fresh(mine, now)) throw new Refused('accepted');
      const { said, ...name } = await sender();
      return { kind: 'accepted', from: me, ...name, key: `accepted:${me}:${mine.createTime}`, note: acceptedNote(said), route: `friend.${me}`, unread: false };
    }
    case 'gym': {
      const d = await getDoc(env, token, ['users', c.to, 'gymInbox', c.id!]);
      if (!exists(d) || d.fields.from !== me || !fresh(d, now)) throw new Refused('gym');
      await friendOf(env, token, c.to);
      const gym = d.fields.gym as { name?: unknown } | undefined;
      const { said, ...name } = await sender();
      return { kind: 'gym', from: me, ...name, key: `gym:${c.id}`, note: gymNote(said, typeof gym?.name === 'string' ? gym.name : ''), route: `friend.${me}`, unread: true };
    }
    case 'inbox': {
      const d = await getDoc(env, token, ['users', c.to, 'inbox', c.id!]);
      if (!exists(d) || d.fields.from !== me || !fresh(d, now)) throw new Refused('inbox');
      await friendOf(env, token, c.to);
      const { said, ...name } = await sender();
      const base = { from: me, ...name, key: `inbox:${c.id}`, route: `friend.${me}` as const, unread: true };
      if (d.fields.kind === 'p') return { ...base, kind: 'ping', note: pingNote(said, d.fields.e) };
      if (d.fields.kind === 'm' && typeof d.fields.t === 'string' && d.fields.t) return { ...base, kind: 'message', note: messageNote(said, d.fields.t) };
      throw new Refused('inbox');
    }
  }
}

/** Who hears of a checked claim: a report, the app's owners (never whoever the claim names); anything else, the person it names. */
export const recipients = (c: Claim): readonly string[] => (c.kind === 'report' || c.kind === 'limit' ? OWNERS : [c.to]);

const HOUR = 3600_000, DAY = 864e5;
/** Each limit's counter, read as the caller (only they may, or anyone for the app's day), and the line it must be at. */
const LIMITS: Record<LimitId, { path: (me: string, to: string, now: number) => string[]; max: number; window: number }> = {
  board: { path: (me) => ['boardRate', me], max: 5, window: DAY },
  report: { path: (me) => ['reportRate', me], max: 20, window: DAY },
  social: { path: (me) => ['socialRate', me], max: SOCIAL_PER_DAY, window: DAY },
  send: { path: (me, to) => ['users', me, 'sendRate', to], max: 30, window: HOUR },
  global: { path: (_me, _to, now) => ['limits', dayId(now)], max: GLOBAL_PER_DAY, window: 0 },
};

/** The push for the app's day full: one a day, from the app (any caller) or the cron, whichever sees it first. */
export const globalPush = (now: number): FriendPush =>
  ({ kind: 'limit', from: 'app', key: `limit:global:${dayId(now)}`, note: limitNote('global', ''), route: 'review', unread: false, daily: 'limit:global' });

/**
 * limit (r28): the caller says they ran into a limit; the Worker reads that counter in Firestore with their token and finds it
 * at its line, within its window. It rings the owners alone (recipients), naming the caller by username, once a day per person
 * and limit (the app's day: once a day in all).
 */
async function limitCheck(env: Env4, token: string, me: string, id: LimitId, to: string, now: number): Promise<FriendPush> {
  const l = LIMITS[id];
  const d = await getDoc(env, token, l.path(me, to, now));
  const n = exists(d) ? d.fields.n : null, win = exists(d) ? d.fields.win : null;
  if (typeof n !== 'number' || n < l.max) throw new Refused('limit');
  if (l.window && (typeof win !== 'number' || win <= now - l.window)) throw new Refused('limit');
  if (id === 'global') return globalPush(now);
  const p = await profileOf(env, token, me);
  const who = p ? `@${p.name}` : 'Someone';
  return { kind: 'limit', from: me, key: `limit:${id}:${me}:${dayId(now)}`, note: limitNote(id, who), route: 'review', unread: false, daily: `limit:${id}:${me}` };
}
