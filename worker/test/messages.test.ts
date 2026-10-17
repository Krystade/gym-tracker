import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import worker from '../src/index';
import { friendTopic } from '../../src/push/payload';
import type { UserBox } from '../src/userbox';
import { fakeNet, signer, subscriber, World } from './helpers';

// Pings and messages: the app writes users/{to}/inbox/{id} (firestore.rules check it), then POST /notify { kind: 'inbox' }.
// The Worker reads that document back as the sender, and the words come from it, never from the request.

const ORIGIN = 'https://krystade.github.io';
const APP = 'https://krystade.github.io/gym-tracker/';
let s: Awaited<ReturnType<typeof signer>>;
beforeAll(async () => { s = await signer(); });

let n = 0;
const uid = (who: string) => `${who}${++n}m${crypto.randomUUID().slice(0, 8)}`;
const box = (u: string) => env.USERS.get(env.USERS.idFromName(u));
const setClock = (u: string, t: number) => runInDurableObject(box(u), (o: UserBox) => { o.now = () => t; });
const PREFS = { tz: 'UTC', kinds: { rest: true, remind: false, recap: false, activity: true, friends: true }, reminder: { days: [], at: '18:00' }, recap: { day: 0, at: '18:00' } };

async function call(as: string, method: string, path: string, body?: unknown) {
  const r = await worker.fetch(new Request(`https://push.example.workers.dev${path}`, {
    method, headers: { origin: ORIGIN, authorization: `Bearer ${await s.token({ sub: as })}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}

type Note = { title: string; body: string; navigate: string; app_badge?: string; data: { kind: string; route: string } };
async function friends() {
  const world = new World();
  const a = uid('alice'), b = uid('bob'), c = uid('carol');
  world.put(`users/${a}`, { username: 'alice' }).put(`users/${b}`, { username: 'bob' }).put(`users/${c}`, { username: 'carol' }).friends(a, b).friends(c, b);
  const net = fakeNet(s.jwks, () => 201, world);
  const phone = await subscriber();
  expect((await call(b, 'POST', '/subscribe', { endpoint: phone.endpoint, keys: phone.keys })).status).toBe(200);
  let k = 0;
  /** `from` writes a ping or message to Bob's inbox (as the rules would allow) and tells the Worker. */
  const send = async (from: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}, createTime = Date.now()) => {
    const id = `i${++k}${from.slice(0, 5)}`;
    world.put(`users/${b}/inbox/${id}`, { from, at: createTime, ...data }, createTime);
    return { id, ...(await call(from, 'POST', '/notify', { kind: 'inbox', to: b, id, ...extra })) };
  };
  const note = async (i = -1) => ((await phone.read(net.sent.at(i)!.body)) as { notification: Note }).notification;
  return { world, a, b, c, net, phone, send, note };
}

describe('POST /notify: pings and messages', () => {
  it('a ping rings with the preset\'s words, on the sender\'s topic, landing on the sender, with the badge counting', async () => {
    const { a, net, send, note } = await friends();
    expect((await send(a, { kind: 'p', e: 'strong' })).json).toEqual({ ok: true });
    expect(net.sent).toHaveLength(1);
    expect(Object.fromEntries(net.sent[0].headers)).toMatchObject({ urgency: 'normal', ttl: '86400', topic: await friendTopic(a) });
    expect(await note()).toEqual({ title: 'alice', body: '💪 Strong', lang: 'en', navigate: `${APP}#open=friend.${a}`, app_badge: '1', data: { kind: 'ping', route: `friend.${a}` } });
  });

  it('every preset has its words; one this Worker doesn\'t know says "sent you a ping"', async () => {
    const want: Record<string, string> = { strong: '💪 Strong', fire: '🔥 On fire', clap: '👏 Nice work', gym: '🏋️ Gym today?', eyes: '👀 Did you lift?', salute: '🫡 On it', kiss: 'sent you a ping' };
    for (const [e, body] of Object.entries(want)) {
      const { a, send, note, net } = await friends();
      await send(a, { kind: 'p', e });
      expect(net.sent).toHaveLength(1);
      expect((await note()).body).toBe(body);
    }
  });

  it('a message rings with the stored text, never anything in the request, and stays under 1 KB', async () => {
    const { a, send, note, net } = await friends();
    const text = '💪'.repeat(70); // 140 characters as the rules count them
    await send(a, { kind: 'm', t: text }, { t: 'click evil.example', name: 'mallory', title: 'Bank' });
    const got = await note();
    expect(got).toMatchObject({ title: 'alice', body: text, data: { kind: 'message', route: `friend.${a}` } });
    // The encrypted body: the JSON plus RFC 8291's 86-byte header, 16-byte tag and 1-byte delimiter.
    expect(net.sent[0].body.length - 103).toBeLessThan(1024);
  });

  it('refused: someone else\'s document, one over a minute old, one that isn\'t there, and an ex-friend\'s', async () => {
    const { world, a, b, c, net, send } = await friends();
    world.put(`users/${b}/inbox/fromc`, { from: c, kind: 'p', e: 'fire' });
    expect((await call(a, 'POST', '/notify', { kind: 'inbox', to: b, id: 'fromc' })).status).toBe(403);
    expect((await send(a, { kind: 'p', e: 'fire' }, {}, Date.now() - 61_000)).status).toBe(403);
    expect((await call(a, 'POST', '/notify', { kind: 'inbox', to: b, id: 'nothing' })).status).toBe(403);
    // Bob blocked or removed Alice after she wrote it: her name is off his list, so the probe refuses.
    world.docs.delete(`users/${b}/friends/${a}`);
    expect((await send(a, { kind: 'p', e: 'fire' })).status).toBe(403);
    expect(net.sent).toHaveLength(0);
  });

  it('a friend can’t ring with another friend’s message, even if the rules let them read it', async () => {
    const { world, a, b, c, net } = await friends();
    world.loose = true;
    world.put(`users/${b}/inbox/fromc`, { from: c, kind: 'm', t: 'from carol' });
    world.put(`users/${b}/gymInbox/gc`, { from: c, gym: { name: 'Carol Gym' } });
    expect((await call(a, 'POST', '/notify', { kind: 'inbox', to: b, id: 'fromc' })).status).toBe(403);
    expect((await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'gc' })).status).toBe(403);
    expect(net.sent).toHaveLength(0);
  });

  it('a stranger is refused even with a document in place (as if the rules had let one through)', async () => {
    const { world, b, net } = await friends();
    const eve = uid('eve');
    world.put(`users/${eve}`, { username: 'eve' }).put(`users/${b}/inbox/e1`, { from: eve, kind: 'm', t: 'hi' });
    expect((await call(eve, 'POST', '/notify', { kind: 'inbox', to: b, id: 'e1' })).status).toBe(403);
    expect(net.sent).toHaveLength(0);
  });

  it('a muted friend rings nothing, and the sender can\'t tell; another friend still rings', async () => {
    const { a, b, c, net, send, note } = await friends();
    expect((await call(b, 'PUT', '/prefs', { ...PREFS, muted: [a] })).status).toBe(200);
    expect((await send(a, { kind: 'p', e: 'clap' })).json).toEqual({ ok: true });
    expect(net.sent).toHaveLength(0);
    await send(c, { kind: 'p', e: 'clap' });
    expect(net.sent).toHaveLength(1);
    expect((await note()).title).toBe('carol');
    // Unmuted, Alice rings again.
    await call(b, 'PUT', '/prefs', { ...PREFS, muted: [] });
    await send(a, { kind: 'p', e: 'fire' });
    expect(net.sent).toHaveLength(2);
  });

  it('pings and messages switched off ring nothing; friend activity is its own switch', async () => {
    const { world, a, b, net, send } = await friends();
    await call(b, 'PUT', '/prefs', { ...PREFS, kinds: { ...PREFS.kinds, friends: false } });
    await send(a, { kind: 'm', t: 'hello' });
    expect(net.sent).toHaveLength(0);
    world.put(`users/${b}/gymInbox/g1`, { from: a, gym: { name: 'Home' } });
    await call(a, 'POST', '/notify', { kind: 'gym', to: b, id: 'g1' });
    expect(net.sent).toHaveLength(1);
  });

  it('the second ping inside a minute is held, and the next push says "+1 more"', async () => {
    const { a, b, net, send, note } = await friends();
    const t0 = Date.now();
    await setClock(b, t0);
    await send(a, { kind: 'p', e: 'strong' });
    await setClock(b, t0 + 30_000);
    await send(a, { kind: 'p', e: 'fire' });
    expect(net.sent).toHaveLength(1);
    await setClock(b, t0 + 61_000);
    await send(a, { kind: 'm', t: 'gym at 6?' });
    expect(net.sent).toHaveLength(2);
    expect(await note()).toMatchObject({ body: 'gym at 6? · +1 more', app_badge: '3' });
  });

  it('a replayed ping sends nothing; the app\'s own count resets the badge', async () => {
    const { a, b, net, send, note } = await friends();
    const t0 = Date.now();
    const first = await send(a, { kind: 'p', e: 'strong' });
    await setClock(b, t0 + 120_000);
    await call(a, 'POST', '/notify', { kind: 'inbox', to: b, id: first.id });
    expect(net.sent).toHaveLength(1);
    // Bob opened the app and read everything.
    expect((await call(b, 'POST', '/badge', { n: 0 })).status).toBe(200);
    expect((await call(b, 'POST', '/badge', { n: -1 })).status).toBe(400);
    await send(a, { kind: 'p', e: 'eyes' });
    expect(await note()).toMatchObject({ body: '👀 Did you lift?', app_badge: '1' });
  });

  it('refuses a muted list that isn\'t uids', async () => {
    const { b } = await friends();
    expect((await call(b, 'PUT', '/prefs', { ...PREFS, muted: ['../x'] })).status).toBe(400);
    expect((await call(b, 'PUT', '/prefs', { ...PREFS, muted: 'all' })).status).toBe(400);
  });
});
