import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import worker from '../src/index';
import type { UserBox } from '../src/userbox';
import { addDays, askTime, nextPainAt, painDue, PAIN_LATE_MS, type PainDay } from '../src/pain';
import { localDate } from '../src/schedule';
import { fakeNet, signer, subscriber, type Sent } from './helpers';

// The next-morning pain question (item 08, round 20): at 11:00 local the day after pain, once, at most one a day, never on a day
// with no pain the day before, only for someone who turned push on and didn't turn the question off.

const ORIGIN = 'https://krystade.github.io';
let s: Awaited<ReturnType<typeof signer>>;
beforeAll(async () => { s = await signer(); });
let n = 0;
const account = () => `pain-${++n}-${crypto.randomUUID().slice(0, 8)}`;
async function call(uid: string, method: string, path: string, body?: unknown) {
  const r = await worker.fetch(new Request(`https://push.example.workers.dev${path}`, {
    method, headers: { origin: ORIGIN, authorization: `Bearer ${await s.token({ sub: uid })}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}
const box = (uid: string) => env.USERS.get(env.USERS.idFromName(uid));
const setClock = (uid: string, t: number) => runInDurableObject(box(uid), (o: UserBox) => { o.now = () => t; });
const alarmOf = (uid: string) => runInDurableObject(box(uid), (_o, st) => st.storage.getAlarm());
const painAtOf = (uid: string) => runInDurableObject(box(uid), async (_o, st) => (await st.storage.get<{ painAt?: number | null }>('plan'))?.painAt ?? null);
const NY = 'America/New_York';
const PREFS = { tz: NY, kinds: { rest: true, remind: false, recap: false }, reminder: { days: [], at: '18:00' }, recap: { day: 0, at: '19:00' } };
const WEEK = { start: '2027-03-01', sessions: 1, sets: 12, prs: 0 };
const ELBOW = (date: string): PainDay => ({ date, region: 'elbow', lift: 'Cable Pushdown' });

async function enrolled(at: number, prefs: unknown = PREFS) {
  const uid = account();
  const net = fakeNet(s.jwks);
  await setClock(uid, at);
  const phone = await subscriber();
  expect((await call(uid, 'POST', '/subscribe', { endpoint: phone.endpoint, keys: phone.keys })).status).toBe(200);
  expect((await call(uid, 'PUT', '/prefs', prefs)).status).toBe(200);
  return { uid, net, phone };
}

describe('the pain question’s times (pure)', () => {
  it('11:00 local the day after, across the autumn DST change', () => {
    expect(new Date(askTime(NY, '2026-10-19')).toISOString()).toBe('2026-10-20T15:00:00.000Z'); // EDT
    expect(new Date(askTime(NY, '2026-10-31')).toISOString()).toBe('2026-11-01T16:00:00.000Z'); // the change day: EST
    expect(new Date(askTime('Asia/Kolkata', '2026-10-19')).toISOString()).toBe('2026-10-20T05:30:00.000Z');
  });
  it('plans only times still to come, and never a day already asked about', () => {
    const before = Date.parse('2026-10-20T14:00:00Z');
    expect(nextPainAt(NY, [ELBOW('2026-10-19')], [], before)).toBe(askTime(NY, '2026-10-19'));
    expect(nextPainAt(NY, [ELBOW('2026-10-19')], ['2026-10-19'], before)).toBeNull();
    expect(nextPainAt(NY, [ELBOW('2026-10-19')], [], askTime(NY, '2026-10-19'))).toBeNull(); // its 11:00 has come
    expect(nextPainAt(NY, [ELBOW('2026-10-19'), ELBOW('2026-10-20')], [], before)).toBe(askTime(NY, '2026-10-19'));
    expect(nextPainAt(NY, undefined, [], before)).toBeNull();
  });

  /** A small deterministic generator (mulberry32), so a failure is reproducible from its seed. */
  const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  it('property: painDue only ever names pain from the day before, not asked yet, on a day nothing was asked, near its 11:00', () => {
    const zones = [NY, 'UTC', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Los_Angeles', 'Europe/London'];
    let fired = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const r = rng(seed);
      const tz = zones[Math.floor(r() * zones.length)];
      const now = Date.parse('2026-01-01T00:00:00Z') + Math.floor(r() * 365 * 864e5);
      const today = localDate(tz, now);
      const pain = Array.from({ length: Math.floor(r() * 3) }, () => ELBOW(addDays(today, -Math.floor(r() * 4))));
      const sent = pain.filter(() => r() < 0.3).map((p) => p.date);
      const askedOn = r() < 0.2 ? today : r() < 0.5 ? addDays(today, -1) : undefined;
      const due = painDue(tz, pain, sent, askedOn, now);
      if (!due) continue;
      fired++;
      expect(due.date, `seed ${seed}`).toBe(addDays(today, -1));
      expect(pain).toContainEqual(due);
      expect(sent).not.toContain(due.date);
      expect(askedOn).not.toBe(today);
      expect(now - askTime(tz, due.date)).toBeGreaterThanOrEqual(0);
      expect(now - askTime(tz, due.date)).toBeLessThanOrEqual(PAIN_LATE_MS);
    }
    // It fired at all, or the property says nothing: a window of an hour a day over 4000 random instants.
    expect(fired).toBeGreaterThan(5);
  });
});

describe('the pain question, sent', () => {
  // Monday 1 March 2027, 20:00 EST: a pushdown session where the elbow hurt. (In the future: a Durable Object runs an alarm set
  // in the real past at once, whatever the test's clock.)
  const MON_8PM = Date.parse('2027-03-02T01:00:00Z');
  const TUE_11 = Date.parse('2027-03-02T16:00:00Z');

  it('asks at 11:00 the next day, naming the region and lift, and opens the question', async () => {
    const { uid, net, phone } = await enrolled(MON_8PM);
    expect((await call(uid, 'POST', '/activity', { date: '2027-03-01', next: null, week: WEEK, pain: [ELBOW('2027-03-01')] })).status).toBe(200);
    expect(await painAtOf(uid)).toBe(TUE_11);
    expect(await alarmOf(uid)).toBe(TUE_11);
    await setClock(uid, TUE_11);
    await runDurableObjectAlarm(box(uid));
    expect(net.sent).toHaveLength(1);
    const p = net.sent[0];
    expect(Object.fromEntries(p.headers)).toMatchObject({ topic: 'pain', urgency: 'normal', ttl: String(8 * 3600) });
    const body = await phone.read(p.body);
    expect(body.notification).toMatchObject({
      title: 'How’s your elbow this morning?', body: 'After Cable Pushdown yesterday · settled, still sore or worse?',
      navigate: 'https://krystade.github.io/gym-tracker/#open=pain', data: { kind: 'pain', route: 'pain' },
    });
    expect(JSON.stringify(body)).not.toMatch(/severity|note/i);
    // Once: the same activity again, and the alarm again, send nothing more.
    await call(uid, 'POST', '/activity', { date: '2027-03-01', next: null, week: WEEK, pain: [ELBOW('2027-03-01')] });
    await runInDurableObject(box(uid), (_o, st) => st.storage.setAlarm(TUE_11 + 60_000));
    await setClock(uid, TUE_11 + 60_000);
    await runDurableObjectAlarm(box(uid));
    expect(net.sent).toHaveLength(1);
  });

  it('answered on the phone first: the next activity has no pain, and nothing is sent', async () => {
    const { uid, net } = await enrolled(MON_8PM);
    await call(uid, 'POST', '/activity', { date: '2027-03-01', next: null, week: WEEK, pain: [ELBOW('2027-03-01')] });
    await setClock(uid, TUE_11 - 3600_000);
    await call(uid, 'POST', '/activity', { date: '2027-03-01', next: null, week: WEEK });
    expect(await painAtOf(uid)).toBeNull();
    expect(await alarmOf(uid)).not.toBe(TUE_11);
    await setClock(uid, TUE_11);
    await runDurableObjectAlarm(box(uid));
    expect(net.sent).toHaveLength(0);
  });

  it('switched off, nothing; an app from before the switch (no `pain` in its prefs) has it on', async () => {
    const off = await enrolled(MON_8PM, { ...PREFS, kinds: { ...PREFS.kinds, pain: false } });
    await call(off.uid, 'POST', '/activity', { date: '2027-03-01', next: null, week: WEEK, pain: [ELBOW('2027-03-01')] });
    expect(await painAtOf(off.uid)).toBeNull();
    const old = await enrolled(MON_8PM);
    expect(((await call(old.uid, 'GET', '/status')).json as { prefs: { kinds: { pain: boolean } } }).prefs.kinds.pain).toBe(true);
  });

  it('pain told of after its 11:00 (the phone is open on Today, which asks) sends nothing', async () => {
    const { uid, net } = await enrolled(TUE_11 + 600_000);
    await call(uid, 'POST', '/activity', { date: '2027-03-01', next: null, week: WEEK, pain: [ELBOW('2027-03-01')] });
    expect(await painAtOf(uid)).toBeNull();
    expect(net.sent).toHaveLength(0);
  });

  it('refuses a malformed pain list', async () => {
    const { uid } = await enrolled(MON_8PM);
    const post = (pain: unknown) => call(uid, 'POST', '/activity', { date: '2027-03-01', next: null, week: WEEK, pain });
    expect((await post([{ ...ELBOW('2027-03-01'), region: 'neck' }])).status).toBe(400);
    expect((await post([ELBOW('2027-02-27'), ELBOW('2027-02-28'), ELBOW('2027-03-01')])).status).toBe(400);
    expect((await post([ELBOW('2027-03-01'), ELBOW('2027-03-01')])).status).toBe(400);
    expect((await post([{ ...ELBOW('2027-03-01'), lift: ' ' }])).status).toBe(400);
    expect((await post([{ ...ELBOW('2027-03-01'), lift: 'x'.repeat(41) }])).status).toBe(400);
    expect((await post([{ ...ELBOW('01-03-2027') }])).status).toBe(400);
    expect((await post('elbow')).status).toBe(400);
    expect((await post([ELBOW('2027-03-01')])).status).toBe(200);
    expect((await call(uid, 'PUT', '/prefs', { ...PREFS, kinds: { ...PREFS.kinds, pain: 'yes' } })).status).toBe(400);
  });
});

describe('property: the box never asks without pain the day before, and never twice', () => {
  const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  it('random weeks of sessions, answers, phone posts and alarms, in several time zones', async () => {
    const zones = [NY, 'Pacific/Auckland', 'Asia/Kolkata', 'Europe/London'];
    let total = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const r = rng(seed * 7919);
      const tz = zones[seed % zones.length];
      // Late October into November 2027 (in the future, see above): New York and London change clocks, Auckland is a day ahead.
      let clock = Date.parse('2027-10-25T03:00:00Z') + Math.floor(r() * 864e5);
      const { uid, net, phone } = await enrolled(clock, { ...PREFS, tz });
      /** The true log: days with pain (local dates), and the days he answered on the phone. */
      const painDays = new Set<string>(), answered = new Set<string>();
      const sends: { at: number; date: string }[] = [];
      const runAlarms = async (until: number) => {
        for (let k = 0; k < 20; k++) {
          const a = await alarmOf(uid);
          if (a == null || a > until) return;
          const at = a + Math.floor(r() * 120_000); // alarms run a little late
          await setClock(uid, at);
          const before = net.sent.length;
          await runDurableObjectAlarm(box(uid));
          for (const p of net.sent.slice(before)) sends.push({ at, date: (await phone.read(p.body)).notification.title });
        }
      };
      for (let step = 0; step < 14; step++) {
        const to = clock + Math.floor((0.2 + r() * 1.3) * 864e5);
        await runAlarms(to);
        clock = to;
        await setClock(uid, clock);
        const today = localDate(tz, clock);
        if (r() < 0.45) painDays.add(today); // a session that hurt
        if (r() < 0.25) answered.add(addDays(today, -1)); // answered yesterday's on the phone
        // What the phone posts: yesterday's and today's pain not yet answered (domain/morning pushAsks).
        const pain = [addDays(today, -1), today].filter((d) => painDays.has(d) && !answered.has(d)).map(ELBOW);
        // Some days the app isn't opened: the Worker keeps the last list it was sent, stale days and all.
        if (r() < 0.4) continue;
        expect((await call(uid, 'POST', '/activity', { date: today, next: null, week: WEEK, ...(pain.length && { pain }) })).status).toBe(200);
      }
      await runAlarms(clock + 3 * 864e5);
      // Every send: on a local day whose day before had pain, at most one per local day, at most one per pain day.
      const days = sends.map((x) => localDate(tz, x.at));
      for (const d of days) expect(painDays.has(addDays(d, -1)), `seed ${seed}: sent on ${d}`).toBe(true);
      expect(new Set(days).size, `seed ${seed}: twice on one day`).toBe(days.length);
      for (const x of sends) expect(x.date).toBe('How’s your elbow this morning?');
      total += sends.length;
    }
    // The property was exercised: questions did go out.
    expect(total).toBeGreaterThan(5);
  }, 120_000);
});

export type { Sent };
