import { DurableObject } from 'cloudflare:workers';
import { ACTIVITY_KINDS, buildPayload, DELIVERY, friendTopic, painNote, recapNote, remindNote, restNote, testNote, withMore, type ActivityKind, type Kind, type Route } from '../../src/push/payload';
import type { Env } from './env';
import type { FriendPush } from './notify';
import { hurtsOf, nextPainAt, painDue } from './pain';
import { sendOne } from './send';
import { localDate, nextAt, nextRemind, remindToday, weekStart } from './schedule';
import { DEFAULT_PREFS, on, type Activity, type Prefs, type Subscription } from './validate';
import { parseVapid, vapidAuth } from './vapid';

// One per account (named by Firebase uid). It holds the account's devices, preferences and pending pushes, and one alarm
// pointed at the earliest of them. Sending (encryption and the push service call) happens here, never in the Worker.

export interface Device extends Subscription {
  id: string; created: number; lastSeen: number;
  lastAt?: number; lastStatus?: number; lastOkAt?: number; backoffUntil?: number;
}
interface Rest { device: string; due: number; label: string }
/**
 * `remindedOn`: the local date the last reminder went out (one a day, however often the plan moves). `painAt`: the next
 * morning pain question's time; `painSent`: the pain days already asked about (the last few); `painOn`: the local date the last
 * one went out (one a day).
 */
interface Plan { remindAt: number | null; recapAt: number | null; pruneAt: number | null; remindedOn?: string; painAt?: number | null; painSent?: string[]; painOn?: string }
export interface Status {
  devices: { id: string; ua: string; created: number; lastSeen: number; lastAt: number | null; lastStatus: number | null; lastOkAt: number | null }[];
  prefs: Prefs; alarm: number | null; rest: { due: number } | null; configured: boolean;
}

export const MAX_DEVICES = 5;
export const STALE_MS = 30 * 864e5;
const DAY = 864e5;

// A friend's pushes, per sender: one a minute (those held back still wait in the app, and the next push says "+N more"),
// thirty an hour, and the last 200 claims remembered so a replayed one sends nothing. Exact: a Durable Object runs one
// call at a time.
export const HOLD_MS = 60_000;
export const PER_HOUR = 30;
export const SEEN = 200;
interface Rate { last: number; held: number; hour: number; n: number }
/** What happened to a friend's push. Never told to the sender: a mute must not show. */
export type Outcome = 'sent' | 'held' | 'limit' | 'replay' | 'off' | 'muted' | 'daily' | 'no device';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const deviceIdOf = async (endpoint: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))).slice(0, 16);

export class UserBox extends DurableObject<Env> {
  /** The clock; tests move it. */
  now = () => Date.now();

  private get kv() {
    const s = this.ctx.storage;
    return { get: <T>(k: string) => s.get<T>(k), put: <T>(k: string, v: T) => s.put(k, v) };
  }
  private async devices() { return (await this.ctx.storage.get<Record<string, Device>>('devices')) ?? {}; }
  private async prefs() { return (await this.ctx.storage.get<Prefs>('prefs')) ?? DEFAULT_PREFS; }
  private async plan(): Promise<Plan> { return (await this.ctx.storage.get<Plan>('plan')) ?? { remindAt: null, recapAt: null, pruneAt: null }; }

  /** Adds or refreshes a device; the oldest goes past five. Returns its id. */
  async subscribe(s: Subscription): Promise<string> {
    const now = this.now(), id = await deviceIdOf(s.endpoint);
    const all = await this.devices();
    all[id] = { ...all[id], ...s, id, created: all[id]?.created ?? now, lastSeen: now };
    const ids = Object.values(all).sort((a, b) => b.lastSeen - a.lastSeen).map((d) => d.id);
    for (const old of ids.slice(MAX_DEVICES)) delete all[old];
    await this.ctx.storage.put('devices', all);
    const plan = await this.plan();
    if (plan.pruneAt == null) await this.ctx.storage.put('plan', { ...plan, pruneAt: now + DAY });
    await this.schedule();
    return id;
  }

  async unsubscribe(id: string): Promise<void> {
    const all = await this.devices();
    delete all[id];
    await this.ctx.storage.put('devices', all);
    const rest = await this.ctx.storage.get<Rest>('rest');
    if (rest?.device === id) await this.ctx.storage.delete('rest');
    await this.schedule();
  }

  /** New preferences: the reminder and recap are worked out again from now. */
  async setPrefs(p: Prefs): Promise<void> {
    await this.ctx.storage.put('prefs', p);
    const now = this.now(), plan = await this.plan();
    await this.ctx.storage.put('plan', { ...plan, ...this.timesFor(p, now, await this.ctx.storage.get<Activity>('activity'), plan) });
    if (!p.kinds.rest) await this.ctx.storage.delete('rest');
    await this.schedule();
  }

  private timesFor(p: Prefs, now: number, act: Activity | undefined, plan: Plan) {
    return {
      remindAt: p.kinds.remind ? nextRemind(p.tz, p.reminder, act?.remind, now, act?.rest) : null,
      recapAt: p.kinds.recap ? nextAt(p.tz, [p.recap.day], p.recap.at, now) : null,
      painAt: on(p.kinds.pain) ? nextPainAt(p.tz, act?.pain, plan.painSent ?? [], now) : null,
    };
  }

  /** The rest timer: a push to that device in `seconds`. A second call replaces the first. False for an unknown device. */
  async setTimer(device: string, seconds: number, label: string): Promise<boolean> {
    if (!(await this.devices())[device]) return false;
    if (!(await this.prefs()).kinds.rest) return true;
    await this.ctx.storage.put('rest', { device, due: this.now() + seconds * 1000, label } satisfies Rest);
    await this.schedule();
    return true;
  }

  async cancelTimer(): Promise<void> {
    await this.ctx.storage.delete('rest');
    await this.schedule();
  }

  /**
   * What the reminder, recap and pain question need: the last day anything was logged, the next program day, this week's counts,
   * his goal, the learned reminder times, the week plan's rest dates and the pain days not asked about. The reminder and the pain question are planned again
   * from them (pain answered on the phone first drops out of `pain`, and the question with it).
   */
  async activity(a: Activity): Promise<void> {
    await this.ctx.storage.put('activity', a);
    const prefs = await this.prefs(), plan = await this.plan(), now = this.now();
    const remindAt = prefs.kinds.remind ? nextRemind(prefs.tz, prefs.reminder, a.remind, now, a.rest) : null;
    const painAt = on(prefs.kinds.pain) ? nextPainAt(prefs.tz, a.pain, plan.painSent ?? [], now) : null;
    if (remindAt === plan.remindAt && painAt === (plan.painAt ?? null)) return;
    await this.ctx.storage.put('plan', { ...plan, remindAt, painAt });
    await this.schedule();
  }

  /** One push to one device, now. Returns the push service's status (0: unreachable or not configured). */
  async sendTest(device: string): Promise<number | null> {
    if (!(await this.devices())[device]) return null;
    return (await this.send('test', testNote(), [device]))[device] ?? 0;
  }

  /** A friend's push, already checked against Firestore by the Worker. */
  async friendPush(p: FriendPush): Promise<Outcome> {
    const now = this.now(), st = this.ctx.storage;
    const seen = (await st.get<string[]>('seen')) ?? [];
    if (seen.includes(p.key)) return 'replay';
    seen.push(p.key);
    await st.put('seen', seen.slice(-SEEN));
    // The badge counts what waits in the app, rung or not; the app sets the true count when it opens (POST /badge).
    const unread = ((await st.get<number>('unread')) ?? 0) + (p.unread ? 1 : 0);
    if (p.unread) await st.put('unread', unread);
    const prefs = await this.prefs();
    if (!on(ACTIVITY_KINDS.includes(p.kind as ActivityKind) ? prefs.kinds.activity : prefs.kinds.friends)) return 'off';
    if (prefs.muted?.includes(p.from)) return 'muted';
    if (!Object.keys(await this.devices()).length) return 'no device';
    if (p.daily && now - ((await st.get<number>(`daily:${p.daily}`)) ?? -DAY) < DAY) return 'daily';
    const key = `rate:${p.from}`;
    const rate = (await st.get<Rate>(key)) ?? { last: -HOLD_MS, held: 0, hour: now, n: 0 };
    if (now - rate.hour >= 3600_000) Object.assign(rate, { hour: now, n: 0 });
    if (rate.n >= PER_HOUR) return 'limit';
    if (now - rate.last < HOLD_MS) { rate.held++; await st.put(key, rate); return 'held'; }
    await this.send(p.kind, withMore(p.note, rate.held), undefined, { route: p.route, topic: await friendTopic(p.from), badge: unread, from: p.from, name: p.name });
    Object.assign(rate, { last: now, held: 0, n: rate.n + 1 });
    await st.put(key, rate);
    if (p.daily) await st.put(`daily:${p.daily}`, now);
    return 'sent';
  }

  /** The true unread count, from the app: the next friend push's badge counts on from it. */
  async setBadge(n: number): Promise<void> {
    await this.ctx.storage.put('unread', n);
  }

  async status(): Promise<Status> {
    const devices = Object.values(await this.devices()).map((d) => ({
      id: d.id, ua: d.ua, created: d.created, lastSeen: d.lastSeen, lastAt: d.lastAt ?? null, lastStatus: d.lastStatus ?? null, lastOkAt: d.lastOkAt ?? null,
    }));
    const rest = await this.ctx.storage.get<Rest>('rest');
    return { devices, prefs: await this.prefs(), alarm: await this.ctx.storage.getAlarm(), rest: rest ? { due: rest.due } : null, configured: !!parseVapid(this.env.VAPID_PRIVATE_JWK) };
  }

  async alarm(): Promise<void> {
    const now = this.now();
    const prefs = await this.prefs();
    const plan = await this.plan();
    const rest = await this.ctx.storage.get<Rest>('rest');
    if (rest && rest.due <= now) {
      await this.ctx.storage.delete('rest');
      if (prefs.kinds.rest) await this.send('rest', restNote(rest.label), [rest.device]);
    }
    const today = localDate(prefs.tz, now);
    const act = await this.ctx.storage.get<Activity>('activity');
    if (plan.remindAt != null && plan.remindAt <= now) {
      // Nothing logged today, one a day, and with learning on not once the goal is met or on a planned rest day: remindToday.
      if (remindToday(prefs, act, plan.remindedOn, today)) {
        await this.send('remind', remindNote(act?.next));
        plan.remindedOn = today;
      }
      plan.remindAt = this.timesFor(prefs, now, act, plan).remindAt;
    }
    if (plan.recapAt != null && plan.recapAt <= now) {
      if (prefs.kinds.recap) await this.send('recap', recapNote(act && act.week.start === weekStart(today) ? act.week : null));
      plan.recapAt = this.timesFor(prefs, now, act, plan).recapAt;
    }
    if (plan.painAt != null && plan.painAt <= now) {
      // Only pain the day before, once per pain day, one a day: painDue says which, if any.
      const due = on(prefs.kinds.pain) ? painDue(prefs.tz, act?.pain, plan.painSent ?? [], plan.painOn, now) : null;
      if (due) {
        await this.send('pain', painNote(hurtsOf(due)));
        plan.painSent = [...(plan.painSent ?? []), due.date].slice(-7);
        plan.painOn = today;
      }
      plan.painAt = this.timesFor(prefs, now, act, plan).painAt;
    }
    if (plan.pruneAt != null && plan.pruneAt <= now) {
      const all = await this.devices();
      for (const d of Object.values(all)) if (d.lastSeen < now - STALE_MS) delete all[d.id];
      await this.ctx.storage.put('devices', all);
      plan.pruneAt = Object.keys(all).length ? now + DAY : null;
    }
    await this.ctx.storage.put('plan', plan);
    await this.schedule();
  }

  /** Points the one alarm at the earliest thing pending, or clears it. */
  private async schedule(): Promise<void> {
    const plan = await this.plan(), rest = await this.ctx.storage.get<Rest>('rest');
    const has = Object.keys(await this.devices()).length > 0;
    const times = [rest?.due, ...(has ? [plan.remindAt, plan.recapAt, plan.painAt] : []), plan.pruneAt].filter((t): t is number => t != null);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  /** Sends one kind to the given devices (all by default), keeping each device's last result. Logs kind, status and time only. */
  private async send(kind: Kind, note: { title: string; body: string }, ids?: string[], opts: { route?: Route; topic?: string; badge?: number; from?: string; name?: string } = {}): Promise<Record<string, number>> {
    const key = parseVapid(this.env.VAPID_PRIVATE_JWK);
    const out: Record<string, number> = {};
    if (!key) { console.log(JSON.stringify({ kind, error: 'no VAPID key' })); return out; }
    const payload = buildPayload(kind, note, this.env.APP_URL, { route: opts.route, badge: opts.badge, from: opts.from, name: opts.name });
    const delivery = { ...DELIVERY[kind], ...(opts.topic && { topic: opts.topic }) };
    const all = await this.devices();
    for (const d of Object.values(all)) {
      if (ids && !ids.includes(d.id)) continue;
      const now = this.now();
      if (d.backoffUntil && d.backoffUntil > now) { out[d.id] = 429; continue; }
      const t0 = Date.now();
      const status = await sendOne(d, payload, delivery, await vapidAuth(this.kv, key, d.endpoint, this.env.VAPID_SUBJECT, now));
      console.log(JSON.stringify({ kind, status, ms: Date.now() - t0 }));
      out[d.id] = status;
      if (status === 404 || status === 410) { delete all[d.id]; continue; } // the subscription is gone for good
      Object.assign(d, { lastAt: now, lastStatus: status }, status >= 200 && status < 300 && { lastOkAt: now }, status === 429 && { backoffUntil: now + 60_000 });
    }
    await this.ctx.storage.put('devices', all);
    return out;
  }
}
