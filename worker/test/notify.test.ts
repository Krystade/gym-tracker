import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import worker from '../src/index';
import { friendTopic } from '../../src/push/payload';
import type { FriendPush } from '../src/notify';
import { PER_HOUR, type UserBox } from '../src/userbox';
import { fakeNet, signer, subscriber, World } from './helpers';
import { OWNERS } from '../../src/cloud/owner';

// Friend activity: a request, an accepted request or invite, a gym sent. Each /notify is checked in a stand-in Firestore
// that answers as firestore.rules would (helpers.ts World), as the sender, before the recipient's phone hears of it.

const ORIGIN = 'https://krystade.github.io';
const APP = 'https://krystade.github.io/gym-tracker/';
let s: Awaited<ReturnType<typeof signer>>;
beforeAll(async () => { s = await signer(); });

let n = 0;
const uid = (who: string) => `${who}${++n}x${crypto.randomUUID().slice(0, 8)}`;
const box = (u: string) => env.USERS.get(env.USERS.idFromName(u));
const setClock = (u: string, t: number) => runInDurableObject(box(u), (o: UserBox) => { o.now = () => t; });

async function call(as: string, method: string, path: string, body?: unknown) {
  const r = await worker.fetch(new Request(`https://push.example.workers.dev${path}`, {
    method, headers: { origin: ORIGIN, authorization: `Bearer ${await s.token({ sub: as })}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}

/** Alice (the sender) and Bob (whose phone is subscribed), in one Firestore. */
async function pair(opts: { friends?: boolean } = {}) {
  const world = new World();
  const a = uid('alice'), b = uid('bob');
  world.put(`users/${a}`, { username: 'alice' }).put(`users/${b}`, { username: 'bob' });
  if (opts.friends) world.friends(a, b);
  const net = fakeNet(s.jwks, () => 201, world);
  const phone = await subscriber();
  expect((await call(b, 'POST', '/subscribe', { endpoint: phone.endpoint, keys: phone.keys })).status).toBe(200);
  const read = async (i = -1) => (await phone.read(net.sent.at(i)!.body)) as { notification: { title: string; body: string; navigate: string; data: { kind: string; route: string } } };
  return { world, a, b, net, phone, read };
}

describe('POST /notify: friend activity', () => {
  it('a new request rings the person asked, in words the Worker chose, with the asker\'s name from their profile', async () => {
    const { world, a, b, net, read } = await pair();
    world.put(`users/${b}/requests/${a}`, { username: 'not-what-it-says', sent: 1 });
    // A name in the request body is ignored: the profile says who it is.
    expect((await call(a, 'POST', '/notify', { kind: 'request', to: b, name: 'mallory', text: 'click here' })).json).toEqual({ ok: true });
    expect(net.sent).toHaveLength(1);
    const p = net.sent[0];
    expect(Object.fromEntries(p.headers)).toMatchObject({ urgency: 'normal', ttl: '86400', topic: await friendTopic(a) });
    expect(p.headers.get('topic')).toMatch(/^[\w-]{22}$/);
    expect((await read()).notification).toEqual({ title: 'Friend request', body: 'alice wants to be friends', lang: 'en', navigate: `${APP}#open=friends`, app_badge: '1', data: { kind: 'request', route: 'friends', from: a, name: 'alice' } });
    expect(p.body.length).toBeLessThan(1024 + 103); // under 1 KB of JSON, plus RFC 8291's header and tag
  });

  it('no request in Firestore, or one over a minute old, sends nothing', async () => {
    const { world, a, b, net } = await pair();
    expect((await call(a, 'POST', '/notify', { kind: 'request', to: b })).status).toBe(403);
    world.put(`users/${b}/requests/${a}`, { username: 'alice', sent: 1 }, Date.now() - 61_000);
    expect((await call(a, 'POST', '/notify', { kind: 'request', to: b })).status).toBe(403);
    expect(net.sent).toHaveLength(0);
  });

  it('asking, cancelling and asking again rings once a day', async () => {
    const { world, a, b, net } = await pair();
    const t0 = Date.now();
    world.put(`users/${b}/requests/${a}`, { username: 'alice', sent: 1 }, t0 - 1000);
    await call(a, 'POST', '/notify', { kind: 'request', to: b });
    await setClock(b, t0 + 5 * 60_000);
    world.put(`users/${b}/requests/${a}`, { username: 'alice', sent: 2 }, t0);
    expect((await call(a, 'POST', '/notify', { kind: 'request', to: b })).json).toEqual({ ok: true });
    expect(net.sent).toHaveLength(1);
    await setClock(b, t0 + 864e5 + 1000);
    world.put(`users/${b}/requests/${a}`, { username: 'alice', sent: 3 }, Date.now());
    await call(a, 'POST', '/notify', { kind: 'request', to: b });
    expect(net.sent).toHaveLength(2);
  });

  it('accepted: only between friends, and only for a friendship made in the last minute', async () => {
    const strangers = await pair();
    // Alice lists Bob (anyone can list anyone), but Bob's list doesn't name her: the probe is refused.
    strangers.world.put(`users/${strangers.a}/friends/${strangers.b}`, { since: 1 });
    expect((await call(strangers.a, 'POST', '/notify', { kind: 'accepted', to: strangers.b })).status).toBe(403);
    expect(strangers.net.sent).toHaveLength(0);
    expect(strangers.world.reads.map((r) => r.path)).toContain(`users/${strangers.b}/meta/__probe`);

    const old = await pair();
    old.world.friends(old.a, old.b, Date.now() - 61_000);
    expect((await call(old.a, 'POST', '/notify', { kind: 'accepted', to: old.b })).status).toBe(403);
    expect(old.net.sent).toHaveLength(0);

    const { world, a, b, net, read } = await pair({ friends: true });
    expect((await call(a, 'POST', '/notify', { kind: 'accepted', to: b })).status).toBe(200);
    expect(net.sent).toHaveLength(1);
    expect((await read()).notification).toMatchObject({ title: 'New friend', body: 'You and alice are friends', navigate: `${APP}#open=friend.${a}`, data: { route: `friend.${a}`, from: a, name: 'alice' } });
    expect(world.reads.every((r) => r.uid === a)).toBe(true); // every read was as the sender
  });

  it('a gym: only one the sender put there, new, with its name cut at a word to 40 characters', async () => {
    const { world, a, b, net, read } = await pair({ friends: true });
    const name = `Planet Fitness 🏋️ Downtown and the long annex by the river`;
    world.put(`users/${b}/gymInbox/g1`, { from: a, fromName: 'liar', gym: { name, equipment: [] }, sent: 1 });
    world.put(`users/${b}/gymInbox/g2`, { from: 'someone-else', fromName: 'x', gym: { name: 'Other' }, sent: 1 });
    world.put(`users/${b}/gymInbox/g3`, { from: a, fromName: 'alice', gym: { name: 'Old' }, sent: 1 }, Date.now() - 61_000);
    expect((await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g2' })).status).toBe(403);
    expect((await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g3' })).status).toBe(403);
    expect((await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'nope' })).status).toBe(403);
    expect(net.sent).toHaveLength(0);
    expect((await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g1' })).status).toBe(200);
    const note = (await read()).notification;
    expect(note).toMatchObject({ title: 'Gym shared', data: { kind: 'gym', route: `friend.${a}` } });
    expect(note.body).toBe('alice sent you a gym: Planet Fitness 🏋️ Downtown and the long…');
  });

  it('a replayed claim sends nothing, even after the minute\'s hold is over', async () => {
    const { world, a, b, net } = await pair({ friends: true });
    const t0 = Date.now();
    world.put(`users/${b}/gymInbox/g1`, { from: a, gym: { name: 'Home' } }).put(`users/${b}/gymInbox/g2`, { from: a, gym: { name: 'Work' } });
    await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g1' });
    await setClock(b, t0 + 2 * 60_000);
    expect((await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g1' })).json).toEqual({ ok: true });
    expect(net.sent).toHaveLength(1);
    // Not the hold: a new one goes.
    await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g2' });
    expect(net.sent).toHaveLength(2);
  });

  it('friend activity switched off sends nothing, and says so to nobody', async () => {
    const { world, a, b, net } = await pair({ friends: true });
    const prefs = { tz: 'UTC', kinds: { rest: true, remind: false, recap: false, activity: false }, reminder: { days: [], at: '18:00' }, recap: { day: 0, at: '18:00' } };
    expect((await call(b, 'PUT', '/prefs', prefs)).status).toBe(200);
    world.put(`users/${b}/gymInbox/g1`, { from: a, gym: { name: 'Home' } });
    expect((await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g1' })).json).toEqual({ ok: true });
    expect((await call(a, 'POST', '/notify', { kind: 'accepted', to: b })).json).toEqual({ ok: true });
    expect(net.sent).toHaveLength(0);
    // Back on: the next one rings.
    expect((await call(b, 'PUT', '/prefs', { ...prefs, kinds: { ...prefs.kinds, activity: true } })).status).toBe(200);
    world.put(`users/${b}/gymInbox/g2`, { from: a, gym: { name: 'Work' } });
    await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g2' });
    expect(net.sent).toHaveLength(1);
  });

  it('prefs from an app that predates friend activity leave it on', async () => {
    const { world, a, b, net } = await pair({ friends: true });
    await call(b, 'PUT', '/prefs', { tz: 'UTC', kinds: { rest: true, remind: false, recap: false }, reminder: { days: [], at: '18:00' }, recap: { day: 0, at: '18:00' } });
    world.put(`users/${b}/gymInbox/g1`, { from: a, gym: { name: 'Home' } });
    await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g1' });
    expect(net.sent).toHaveLength(1);
  });

  it('refuses a bad body, yourself, and an unknown kind', async () => {
    const { a, b } = await pair({ friends: true });
    for (const body of [{ kind: 'request' }, { kind: 'spam', to: b }, { kind: 'gym', to: b }, { kind: 'request', to: '../x' }, { kind: 'request', to: 'a/b' }]) {
      expect((await call(a, 'POST', '/notify', body)).status).toBe(400);
    }
    expect((await call(a, 'POST', '/notify', { kind: 'accepted', to: a })).status).toBe(403);
  });

  it('a sender gets 10 notifies a minute', async () => {
    const { world, a, b } = await pair({ friends: true });
    world.put(`users/${b}/gymInbox/g1`, { from: a, gym: { name: 'Home' } });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g1' })).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('the recipient\'s limits on one sender', () => {
  const push = (from: string, i: number): FriendPush => ({ kind: 'gym', from, key: `gym:k${i}`, note: { title: 'Gym shared', body: `alice sent you a gym: G${i}` }, route: `friend.${from}`, unread: true });

  it('one a minute: the ones in between are held, and the next push says how many', async () => {
    const { a, b, net, read } = await pair({ friends: true });
    const t0 = Date.now();
    await setClock(b, t0);
    expect(await box(b).friendPush(push(a, 1))).toBe('sent');
    await setClock(b, t0 + 20_000);
    expect(await box(b).friendPush(push(a, 2))).toBe('held');
    await setClock(b, t0 + 40_000);
    expect(await box(b).friendPush(push(a, 3))).toBe('held');
    expect(net.sent).toHaveLength(1);
    // Another friend isn't held by alice's minute.
    expect(await box(b).friendPush(push(uid('carol'), 9))).toBe('sent');
    await setClock(b, t0 + 61_000);
    expect(await box(b).friendPush(push(a, 4))).toBe('sent');
    expect((await read()).notification.body).toBe('alice sent you a gym: G4 · +2 more');
  });

  it('thirty an hour; the 31st is dropped, and the next hour starts again', async () => {
    const { a, b, net } = await pair({ friends: true });
    const t0 = Date.now();
    // A minute and a second apart: 30 of them take half an hour, all inside the hour.
    for (let i = 0; i < PER_HOUR; i++) {
      await setClock(b, t0 + i * 61_000);
      expect(await box(b).friendPush(push(a, i))).toBe('sent');
    }
    await setClock(b, t0 + PER_HOUR * 61_000);
    expect(await box(b).friendPush(push(a, 30))).toBe('limit');
    expect(net.sent).toHaveLength(PER_HOUR);
    await setClock(b, t0 + 3600_000 + 1);
    expect(await box(b).friendPush(push(a, 31))).toBe('sent');
  });

  it('a phone with nothing subscribed gets nothing, and nothing is kept for it', async () => {
    const world = new World();
    const net = fakeNet(s.jwks, () => 201, world);
    const b = uid('bob');
    expect(await box(b).friendPush(push('x', 1))).toBe('no device');
    expect(net.sent).toHaveLength(0);
  });
});

describe('POST /notify: who it is from, for the phone to put its own tag beside the name', () => {
  it('carries the sender’s uid and username; a profile with no proper username carries no name, and says "A friend"', async () => {
    const { world, a, b, read } = await pair();
    world.put(`users/${b}/requests/${a}`, { username: 'alice', sent: 1 });
    await call(a, 'POST', '/notify', { kind: 'request', to: b });
    expect((await read()).notification.data).toEqual({ kind: 'request', route: 'friends', from: a, name: 'alice' });

    const odd = await pair();
    odd.world.put(`users/${odd.a}`, { username: 'Not A Name' }).put(`users/${odd.b}/requests/${odd.a}`, { username: 'x', sent: 1 });
    await call(odd.a, 'POST', '/notify', { kind: 'request', to: odd.b });
    const n = (await odd.read()).notification;
    expect(n.body).toBe('A friend wants to be friends');
    expect(n.data).toEqual({ kind: 'request', route: 'friends', from: odd.a });
  });
  it('carries their display name as `dn` when the app allows it, the words still the username’s; one it would refuse, none', async () => {
    const { world, a, b, read } = await pair();
    world.put(`users/${a}`, { username: 'alice', displayName: 'Alice K.' }).put(`users/${b}/requests/${a}`, { username: 'alice', sent: 1 });
    await call(a, 'POST', '/notify', { kind: 'request', to: b });
    const n = (await read()).notification;
    expect(n.body).toBe('alice wants to be friends');
    expect(n.data).toEqual({ kind: 'request', route: 'friends', from: a, name: 'alice', dn: 'Alice K.' });

    for (const [i, bad] of ['Admin', 'Alice ✓', 'see www.x.com', 'alice'].entries()) {
      const p = await pair();
      p.world.put(`users/${p.a}`, { username: 'alice', displayName: bad }).put(`users/${p.b}/requests/${p.a}`, { username: 'alice', sent: 1 });
      await call(p.a, 'POST', '/notify', { kind: 'request', to: p.b });
      expect((await p.read()).notification.data, `${i}`).toEqual({ kind: 'request', route: 'friends', from: p.a, name: 'alice' });
    }
  });
});

describe('POST /notify: a board report (social S4)', () => {
  /**
   * The owner's phone, subscribed, and a reporter. Every test here shares the owner's Durable Object (each sets its clock on two
   * days), and each subscribes another phone to it: `sent` counts only this test's phone.
   */
  async function board() {
    const world = new World();
    const r = uid('rita'), owner = OWNERS[0];
    world.put(`users/${r}`, { username: 'rita' });
    const net = fakeNet(s.jwks, () => 201, world);
    const phone = await subscriber();
    expect((await call(owner, 'POST', '/subscribe', { endpoint: phone.endpoint, keys: phone.keys })).status).toBe(200);
    const sent = () => net.sent.filter((x) => x.url === phone.endpoint);
    return { world, r, owner, net: { get sent() { return sent(); } }, phone };
  }
  let day = 0;
  const nextDay = async (owner: string) => { day += 2; await setClock(owner, Date.now() + day * 864e5); };

  it('rings the owner, whoever the claim names, in the Worker\'s own words: nothing of who or what', async () => {
    const { world, r, owner, net, phone } = await board();
    await nextDay(owner);
    const someone = uid('sam');
    world.put(`board/p1/reports/${r}`, { why: 'spam', at: 1 });
    expect((await call(r, 'POST', '/notify', { kind: 'report', to: someone, id: 'p1' })).json).toEqual({ ok: true });
    expect(net.sent).toHaveLength(1);
    const p = net.sent[0];
    expect(p.headers.get('topic')).toBe('report');
    const n = (await phone.read(p.body)) as { notification: unknown };
    expect(n.notification).toEqual({ title: 'Board reports', body: 'New reports are waiting in Board review.', lang: 'en', navigate: `${APP}#open=review`, data: { kind: 'report', route: 'review' } });
    // Nothing went to the person the claim named.
    expect(await runInDurableObject(box(someone), async (o: UserBox) => (await o.status()).devices.length)).toBe(0);
  });

  it('refused when the report isn\'t the caller\'s, isn\'t there, or is over a minute old; an owner\'s own rings nobody', async () => {
    const { world, r, owner, net } = await board();
    await nextDay(owner);
    const other = uid('otto');
    world.put(`board/p2/reports/${other}`, { why: 'spam', at: 1 });
    expect((await call(r, 'POST', '/notify', { kind: 'report', to: owner, id: 'p2' })).status).toBe(403);
    expect((await call(r, 'POST', '/notify', { kind: 'report', to: owner, id: 'p3' })).status).toBe(403);
    world.put(`board/p4/reports/${r}`, { why: 'spam', at: 1 }, Date.now() - 61_000);
    expect((await call(r, 'POST', '/notify', { kind: 'report', to: owner, id: 'p4' })).status).toBe(403);
    world.put(`board/p5/reports/${owner}`, { why: 'spam', at: 1 });
    expect((await call(owner, 'POST', '/notify', { kind: 'report', to: uid('x'), id: 'p5' })).status).toBe(403);
    expect((await call(r, 'POST', '/notify', { kind: 'report', to: owner })).status).toBe(400);
    expect(net.sent).toHaveLength(0);
  });

  it('at most once a day, from anyone, and whatever the owner\'s friend switches and mutes say', async () => {
    const { world, r, owner, net } = await board();
    await nextDay(owner);
    const prefs = { tz: 'UTC', kinds: { rest: true, remind: false, recap: false, activity: false, friends: false }, reminder: { days: [], at: '18:00' }, recap: { day: 0, at: '18:00' }, muted: [r] };
    expect((await call(owner, 'PUT', '/prefs', prefs)).status).toBe(200);
    const r2 = uid('rob');
    world.put(`users/${r2}`, { username: 'rob' });
    world.put(`board/p6/reports/${r}`, { why: 'spam', at: 1 }).put(`board/p6/reports/${r2}`, { why: 'harass', at: 1 }).put(`board/p7/reports/${r}`, { why: 'danger', at: 1 });
    await call(r, 'POST', '/notify', { kind: 'report', to: owner, id: 'p6' });
    await call(r2, 'POST', '/notify', { kind: 'report', to: owner, id: 'p6' });
    await call(r, 'POST', '/notify', { kind: 'report', to: owner, id: 'p7' });
    expect(net.sent).toHaveLength(1);
    await nextDay(owner);
    world.put(`board/p8/reports/${r2}`, { why: 'spam', at: 1 });
    await call(r2, 'POST', '/notify', { kind: 'report', to: owner, id: 'p8' });
    expect(net.sent).toHaveLength(2);
  });
});
