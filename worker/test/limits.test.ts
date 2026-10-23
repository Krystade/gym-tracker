import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import worker, { watchDay } from '../src/index';
import { RESEND_URL } from '../src/email';
import { NOTIFY_PER_DAY, type UserBox } from '../src/userbox';
import { fakeNet, signer, subscriber, World } from './helpers';
import { OWNERS } from '../../src/cloud/owner';
import { dayId } from '../../src/domain/limits';

// A limit someone ran into (r28): checked in Firestore as the caller, then to the owner by push and, with the two secrets set,
// by email; at most once a day per person and limit. And the cron, which watches the app's counter for the day by itself.

const ORIGIN = 'https://krystade.github.io';
const APP = 'https://krystade.github.io/gym-tracker/';
const MAIL = { ...env, RESEND_API_KEY: 'test-key', ALERT_EMAIL: 'owner@test.local' };
let s: Awaited<ReturnType<typeof signer>>;
beforeAll(async () => { s = await signer(); });

let n = 0;
const uid = (who: string) => `${who}${++n}x${crypto.randomUUID().slice(0, 8)}`;
const owner = OWNERS[0];
const box = (u: string) => env.USERS.get(env.USERS.idFromName(u));
// Every test here shares the owner's Durable Object: each moves its clock on two days, so no test sees another's day.
let day = 0;
const nextDay = async () => { day += 2; await runInDurableObject(box(owner), (o: UserBox) => { const t = Date.now() + day * 864e5; o.now = () => t; }); };

async function call(as: string, body: unknown, e: typeof env = MAIL) {
  const r = await worker.fetch(new Request('https://push.example.workers.dev/notify', {
    method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${await s.token({ sub: as })}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), e);
  return r.status;
}

/** The owner's phone, subscribed, and a stand-in Firestore; `sent` counts this test's pushes to that phone, `mail` its emails. */
async function setup() {
  const world = new World();
  const net = fakeNet(s.jwks, () => 201, world);
  const phone = await subscriber();
  const r = await worker.fetch(new Request('https://push.example.workers.dev/subscribe', {
    method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${await s.token({ sub: owner })}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: phone.endpoint, keys: phone.keys }),
  }), env);
  expect(r.status).toBe(200);
  await nextDay();
  return {
    world, phone,
    sent: () => net.sent.filter((x) => x.url === phone.endpoint),
    mail: () => net.sent.filter((x) => x.url === RESEND_URL),
  };
}
const now = () => Date.now();

describe('POST /notify: a limit (r28)', () => {
  it('rings the owner and emails them, naming who and which, once their counter is at its line', async () => {
    const { world, phone, sent, mail } = await setup();
    const r = uid('rita');
    world.put(`users/${r}`, { username: 'rita' }).put(`socialRate/${r}`, { at: now(), win: now() - 3600_000, n: 300 });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'social' })).toBe(200);
    expect(sent()).toHaveLength(1);
    const got = (await phone.read(sent()[0].body)) as { notification: Record<string, unknown> };
    expect(got.notification).toMatchObject({ title: 'Limit reached', body: '@rita reached 300 social actions today (💪s, messages, requests, invites, gyms).', navigate: `${APP}#open=review` });
    expect(sent()[0].headers.get('topic')).toBe('limit');
    expect(mail()).toHaveLength(1);
    expect(mail()[0].headers.get('authorization')).toBe('Bearer test-key');
    const email = JSON.parse(new TextDecoder().decode(mail()[0].body)) as Record<string, unknown>;
    expect(email).toMatchObject({ to: ['owner@test.local'], subject: 'Gym Tracker: Limit reached' });
    expect(String(email.text)).toContain('@rita reached 300 social actions today');
    // Once a day for her and that limit: again, nothing.
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'social' })).toBe(200);
    expect(sent()).toHaveLength(1);
    expect(mail()).toHaveLength(1);
  });

  it('refused unless the caller\'s own counter is at its line, inside its window', async () => {
    const { world, sent, mail } = await setup();
    const r = uid('rex'), o = uid('otto');
    world.put(`users/${r}`, { username: 'rex' });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'social' })).toBe(403); // no counter
    world.put(`socialRate/${r}`, { at: now(), win: now() - 3600_000, n: 299 });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'social' })).toBe(403); // under the line
    world.put(`socialRate/${r}`, { at: now(), win: now() - 864e5 - 1000, n: 300 });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'social' })).toBe(403); // yesterday's
    world.put(`boardRate/${o}`, { at: now(), win: now() - 3600_000, n: 5 });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'board' })).toBe(403); // someone else's is no proof (and unreadable)
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'nope' })).toBe(400);
    expect(sent()).toHaveLength(0);
    expect(mail()).toHaveLength(0);
    world.put(`boardRate/${r}`, { at: now(), win: now() - 3600_000, n: 5 });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'board' })).toBe(200);
    expect(sent()).toHaveLength(1);
  });

  it('the per-friend message limit, an hour long', async () => {
    const { world, phone, sent } = await setup();
    const r = uid('sam'), f = uid('fay');
    world.put(`users/${r}`, { username: 'sam' }).put(`users/${r}/sendRate/${f}`, { at: now(), win: now() - 3601_000, n: 30 });
    expect(await call(r, { kind: 'limit', to: f, id: 'send' })).toBe(403);
    world.put(`users/${r}/sendRate/${f}`, { at: now(), win: now() - 600_000, n: 30 });
    expect(await call(r, { kind: 'limit', to: f, id: 'send' })).toBe(200);
    expect(((await phone.read(sent()[0].body)) as { notification: { body: string } }).notification.body).toBe('@sam sent one friend 30 messages or pings this hour.');
  });

  it('no email without both secrets; the push still goes', async () => {
    const { world, sent, mail } = await setup();
    const r = uid('lena');
    world.put(`users/${r}`, { username: 'lena' }).put(`reportRate/${r}`, { at: now(), win: now() - 60_000, n: 20 });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'report' }, { ...env, RESEND_API_KEY: 'k' })).toBe(200);
    expect(sent()).toHaveLength(1);
    expect(mail()).toHaveLength(0);
  });
});

describe('the app\'s day full (r28)', () => {
  it('from the app or the cron, whichever sees it first: once a day; not before it\'s full', async () => {
    const { world, phone, sent, mail } = await setup();
    expect(await watchDay(MAIL)).toBe(false); // no counter today
    world.put(`limits/${dayId(now())}`, { n: 1999 });
    expect(await watchDay(MAIL)).toBe(false);
    const r = uid('ana');
    world.put(`users/${r}`, { username: 'ana' });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'global' })).toBe(403);
    expect(sent()).toHaveLength(0);
    world.put(`limits/${dayId(now())}`, { n: 2000 });
    expect(await watchDay(MAIL)).toBe(true);
    expect(sent()).toHaveLength(1);
    expect(((await phone.read(sent()[0].body)) as { notification: { body: string } }).notification.body)
      .toBe('Gym Tracker reached 2,000 social writes today: posts, messages and requests stop until 00:00 UTC.');
    expect(mail()).toHaveLength(1);
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'global' })).toBe(200);
    await watchDay(MAIL);
    expect(sent()).toHaveLength(1);
    expect(mail()).toHaveLength(1);
    // Two days on (the owner's box too), full again: once more.
    await nextDay();
    const later = now() + 2 * 864e5;
    world.put(`limits/${dayId(later)}`, { n: 2000 });
    await watchDay(MAIL, later);
    expect(sent()).toHaveLength(2);
    expect(mail()).toHaveLength(2);
  });
});

describe('POST /notify: a day\'s worth per account (r28)', () => {
  it('400 a day, each a check in Firestore; the 401st is refused before any read', async () => {
    const { world } = await setup();
    const r = uid('max');
    world.put(`users/${r}`, { username: 'max' }).put(`socialRate/${r}`, { at: now(), win: now() - 60_000, n: 300 });
    await runInDurableObject(box(r), async (_o: UserBox, st: DurableObjectState) => { await st.storage.put('spend:notify', { win: Date.now() - 3600_000, n: NOTIFY_PER_DAY - 1 }); });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'social' })).toBe(200);
    const reads = world.reads.length;
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'social' })).toBe(429);
    expect(world.reads.length).toBe(reads);
    // A day on, again.
    await runInDurableObject(box(r), async (_o: UserBox, st: DurableObjectState) => { await st.storage.put('spend:notify', { win: Date.now() - 864e5 - 1000, n: NOTIFY_PER_DAY }); });
    expect(await call(r, { kind: 'limit', to: 'owner', id: 'social' })).toBe(200);
  });
});
