import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import worker from '../src/index';
import type { UserBox } from '../src/userbox';
import { fakeNet, signer, subscriber, type Sent } from './helpers';

const ORIGIN = 'https://krystade.github.io';
let s: Awaited<ReturnType<typeof signer>>;
beforeAll(async () => { s = await signer(); });

let n = 0;
/** A fresh account per test, so each gets its own Durable Object. */
const account = () => `uid-${++n}-${crypto.randomUUID().slice(0, 8)}`;

async function call(uid: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await worker.fetch(new Request(`https://push.example.workers.dev${path}`, {
    method, headers: { origin: ORIGIN, authorization: `Bearer ${await s.token({ sub: uid })}`, ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: r.status, headers: r.headers, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}
const box = (uid: string) => env.USERS.get(env.USERS.idFromName(uid));
const setClock = (uid: string, t: number) => runInDurableObject(box(uid), (o: UserBox) => { o.now = () => t; });
const PREFS = { tz: 'America/New_York', kinds: { rest: true, remind: true, recap: true }, reminder: { days: [2, 5], at: '18:00' }, recap: { day: 0, at: '19:00' } };

async function enrolled(status?: (url: string) => number, at?: number) {
  const uid = account();
  const net = fakeNet(s.jwks, status);
  if (at != null) await setClock(uid, at);
  const phone = await subscriber();
  const r = await call(uid, 'POST', '/subscribe', { endpoint: phone.endpoint, keys: phone.keys, ua: 'iPhone' });
  expect(r.status).toBe(200);
  return { uid, net, phone, id: r.json!.id as string };
}
const pushes = (net: { sent: Sent[] }) => net.sent;

describe('the Worker', () => {
  it('refuses calls without a valid token, answers CORS only for the app', async () => {
    fakeNet(s.jwks);
    const r = await worker.fetch(new Request('https://x.dev/status', { headers: { origin: ORIGIN } }), env);
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const evil = await call(account(), 'GET', '/status', undefined, { origin: 'https://krystade.github.io.evil.com' });
    expect(evil.status).toBe(200); // a token is what protects it; the browser just can't read it
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await worker.fetch(new Request('https://x.dev/subscribe', { method: 'OPTIONS', headers: { origin: ORIGIN } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, DELETE');
  });

  it('subscribes a device and sends it a test push it can read', async () => {
    const { uid, net, phone, id } = await enrolled();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    const t = await call(uid, 'POST', '/test', { sub: id });
    expect(t.json).toEqual({ status: 201 });
    const [p] = pushes(net);
    expect(p.url).toBe(phone.endpoint);
    expect(p.headers.get('authorization')).toMatch(/^vapid t=.+, k=B/);
    expect(await phone.read(p.body)).toMatchObject({ web_push: 8030, notification: { title: 'Test notification', navigate: 'https://krystade.github.io/gym-tracker/#open=today' } });
    const st = await call(uid, 'GET', '/status');
    expect(st.json).toMatchObject({ configured: true, devices: [{ id, ua: 'iPhone', lastStatus: 201 }] });
    expect((st.json!.devices as { lastOkAt: number }[])[0].lastOkAt).toBeGreaterThan(0);
  });

  it('rejects endpoints that aren\'t push services, and bad keys', async () => {
    const uid = account();
    fakeNet(s.jwks);
    const phone = await subscriber();
    for (const endpoint of ['https://evil.example/push', 'http://web.push.apple.com/x', 'https://web.push.apple.com.evil.com/x', 'http://127.0.0.1:9/x']) {
      expect((await call(uid, 'POST', '/subscribe', { endpoint, keys: phone.keys })).status).toBe(400);
    }
    expect((await call(uid, 'POST', '/subscribe', { endpoint: phone.endpoint, keys: { ...phone.keys, auth: 'short' } })).status).toBe(400);
  });

  it('a 410 or 404 removes the device; a 429 backs off', async () => {
    for (const code of [410, 404]) {
      const { uid, id } = await enrolled(() => code);
      expect((await call(uid, 'POST', '/test', { sub: id })).json).toEqual({ status: code });
      expect((await call(uid, 'GET', '/status')).json!.devices).toEqual([]);
    }
    const { uid, id, net } = await enrolled(() => 429);
    await call(uid, 'POST', '/test', { sub: id });
    await call(uid, 'POST', '/test', { sub: id });
    expect(pushes(net)).toHaveLength(1);
  });

  it('keeps at most five devices, dropping the one seen longest ago', async () => {
    const uid = account();
    fakeNet(s.jwks);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      await setClock(uid, Date.UTC(2026, 9, 16, 12, i));
      const p = await subscriber();
      ids.push((await call(uid, 'POST', '/subscribe', { endpoint: p.endpoint, keys: p.keys })).json!.id as string);
    }
    const left = ((await call(uid, 'GET', '/status')).json!.devices as { id: string }[]).map((d) => d.id).sort();
    expect(left).toEqual(ids.slice(1).sort());
  });

  it('prunes devices not seen for 30 days when the alarm runs', async () => {
    const { uid } = await enrolled();
    const t = Date.now() + 31 * 864e5;
    await setClock(uid, t);
    await runInDurableObject(box(uid), async (_o, state) => { await state.storage.put('plan', { remindAt: null, recapAt: null, pruneAt: t - 1 }); await state.storage.setAlarm(t - 1); });
    expect(await runDurableObjectAlarm(box(uid))).toBe(true);
    expect((await call(uid, 'GET', '/status')).json!.devices).toEqual([]);
  });

  it('rate-limits validation failures and other routes the same way: unknown routes 404, bad bodies 400', async () => {
    const uid = account();
    fakeNet(s.jwks);
    expect((await call(uid, 'GET', '/nope')).status).toBe(404);
    expect((await call(uid, 'PUT', '/prefs', { ...PREFS, tz: 'Mars/Olympus' })).status).toBe(400);
    expect((await call(uid, 'PUT', '/prefs', { ...PREFS, reminder: { days: [1, 1], at: '18:00' } })).status).toBe(400);
    expect((await call(uid, 'POST', '/timer', { sub: '0123456789abcdef', seconds: 90 })).status).toBe(404);
  });
});

describe('rest timer', () => {
  it('sends one high-urgency push to that device only, when the alarm runs', async () => {
    const { uid, net, phone, id } = await enrolled();
    const other = await subscriber();
    await call(uid, 'POST', '/subscribe', { endpoint: other.endpoint, keys: other.keys });
    expect((await call(uid, 'POST', '/timer', { sub: id, seconds: 90, label: 'Bench Press · set 4 next' })).status).toBe(200);
    const due = await runInDurableObject(box(uid), (_o, st) => st.storage.getAlarm());
    await setClock(uid, due!);
    expect(await runDurableObjectAlarm(box(uid))).toBe(true);
    expect(pushes(net)).toHaveLength(1);
    const [p] = pushes(net);
    expect(p.url).toBe(phone.endpoint);
    expect(Object.fromEntries(p.headers)).toMatchObject({ urgency: 'high', ttl: '60', topic: 'rest' });
    expect((await phone.read(p.body)).notification).toMatchObject({ title: 'Rest done', body: 'Bench Press · set 4 next', data: { route: 'rest' } });
  });

  it('a cancelled timer sends nothing, and a second timer replaces the first', async () => {
    const { uid, net, id } = await enrolled();
    await call(uid, 'POST', '/timer', { sub: id, seconds: 90, label: 'a' });
    expect((await call(uid, 'DELETE', '/timer')).status).toBe(200);
    await setClock(uid, Date.now() + 3600_000);
    await runDurableObjectAlarm(box(uid));
    expect(pushes(net)).toHaveLength(0);

    await setClock(uid, Date.now());
    await call(uid, 'POST', '/timer', { sub: id, seconds: 60, label: 'first' });
    await call(uid, 'POST', '/timer', { sub: id, seconds: 120, label: 'second' });
    const due = await runInDurableObject(box(uid), (_o, st) => st.storage.getAlarm());
    expect(due! - Date.now()).toBeGreaterThan(100_000);
    await setClock(uid, due!);
    await runDurableObjectAlarm(box(uid));
    expect(pushes(net)).toHaveLength(1);
  });

  it('an alarm for something else before the rest is up leaves the rest waiting', async () => {
    const t = Date.now();
    const { uid, net, id } = await enrolled(undefined, t);
    await call(uid, 'POST', '/timer', { sub: id, seconds: 600, label: 'later' });
    await runInDurableObject(box(uid), (_o, st) => st.storage.setAlarm(t + 1000));
    await setClock(uid, t + 1000);
    await runDurableObjectAlarm(box(uid));
    expect(pushes(net)).toHaveLength(0);
    expect(await runInDurableObject(box(uid), (_o, st) => st.storage.getAlarm())).toBe(t + 600_000);
  });

  it('sends nothing with the rest kind switched off', async () => {
    const { uid, net, id } = await enrolled();
    await call(uid, 'PUT', '/prefs', { ...PREFS, kinds: { ...PREFS.kinds, rest: false } });
    await call(uid, 'POST', '/timer', { sub: id, seconds: 30 });
    await setClock(uid, Date.now() + 60_000);
    await runDurableObjectAlarm(box(uid));
    expect(pushes(net)).toHaveLength(0);
  });
});

describe('reminder and recap', () => {
  // Tuesday 20 October 2026, 12:00 in New York (EDT).
  const TUE_NOON = Date.parse('2026-10-20T16:00:00Z');
  const TUE_6PM = Date.parse('2026-10-20T22:00:00Z');

  async function planned(lastLogged: string, week = { start: '2026-10-19', sessions: 2, sets: 31, prs: 1 }) {
    const e = await enrolled(undefined, TUE_NOON);
    await call(e.uid, 'PUT', '/prefs', PREFS);
    await call(e.uid, 'POST', '/activity', { date: lastLogged, next: 'Day B', week });
    return e;
  }

  it('fires at the chosen time on a planned day when nothing is logged', async () => {
    const { uid, net, phone } = await planned('2026-10-19');
    expect(await runInDurableObject(box(uid), (_o, st) => st.storage.getAlarm())).toBe(TUE_6PM);
    await setClock(uid, TUE_6PM);
    await runDurableObjectAlarm(box(uid));
    expect(pushes(net)).toHaveLength(1);
    expect((await phone.read(pushes(net)[0].body)).notification).toMatchObject({ title: 'Time to train', body: 'Day B is up · nothing logged yet' });
    expect(pushes(net)[0].headers.get('topic')).toBe('remind');
    // Next: Friday 18:00 EDT.
    expect(await runInDurableObject(box(uid), (_o, st) => st.storage.get<{ remindAt: number }>('plan'))).toMatchObject({ remindAt: Date.parse('2026-10-23T22:00:00Z') });
  });

  it('stays quiet when something was logged today', async () => {
    const { uid, net } = await planned('2026-10-20');
    await setClock(uid, TUE_6PM);
    await runDurableObjectAlarm(box(uid));
    expect(pushes(net)).toHaveLength(0);
  });

  it('the weekly recap carries the counts the app sent', async () => {
    const { uid, net, phone } = await planned('2026-10-20', { start: '2026-10-19', sessions: 4, sets: 61, prs: 2 });
    const sunday = Date.parse('2026-10-25T23:00:00Z'); // Sunday 19:00 EDT
    await runInDurableObject(box(uid), async (_o, st) => { const p = await st.storage.get<{ remindAt: number }>('plan'); await st.storage.put('plan', { ...p, remindAt: null }); });
    await setClock(uid, sunday);
    await runDurableObjectAlarm(box(uid));
    expect(pushes(net)).toHaveLength(1);
    expect((await phone.read(pushes(net)[0].body)).notification).toMatchObject({ title: 'Your week', body: 'This week: 4 sessions · 61 sets · 2 PRs', data: { route: 'recap' } });
    expect(Object.fromEntries(pushes(net)[0].headers)).toMatchObject({ urgency: 'low', topic: 'recap' });
  });

  it('a recap with counts from an earlier week says nothing was logged', async () => {
    const { uid, net, phone } = await planned('2026-10-14', { start: '2026-10-12', sessions: 3, sets: 40, prs: 0 });
    await runInDurableObject(box(uid), async (_o, st) => { const p = await st.storage.get<{ remindAt: number }>('plan'); await st.storage.put('plan', { ...p, remindAt: null }); });
    await setClock(uid, Date.parse('2026-10-25T23:00:00Z'));
    await runDurableObjectAlarm(box(uid));
    expect((await phone.read(pushes(net)[0].body)).notification.body).toBe('This week: no sessions logged');
  });
});
