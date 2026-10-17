import { DurableObject } from 'cloudflare:workers';
import { buildPayload, DELIVERY, recapNote, remindNote, restNote, testNote, type Kind } from '../../src/push/payload';
import type { Env } from './env';
import { sendOne } from './send';
import { localDate, nextAt, weekStart } from './schedule';
import { DEFAULT_PREFS, type Activity, type Prefs, type Subscription } from './validate';
import { parseVapid, vapidAuth } from './vapid';

// One per account (named by Firebase uid). It holds the account's devices, preferences and pending pushes, and one alarm
// pointed at the earliest of them. Sending (encryption and the push service call) happens here, never in the Worker.

export interface Device extends Subscription {
  id: string; created: number; lastSeen: number;
  lastAt?: number; lastStatus?: number; lastOkAt?: number; backoffUntil?: number;
}
interface Rest { device: string; due: number; label: string }
interface Plan { remindAt: number | null; recapAt: number | null; pruneAt: number | null }
export interface Status {
  devices: { id: string; ua: string; created: number; lastSeen: number; lastAt: number | null; lastStatus: number | null; lastOkAt: number | null }[];
  prefs: Prefs; alarm: number | null; rest: { due: number } | null; configured: boolean;
}

export const MAX_DEVICES = 5;
export const STALE_MS = 30 * 864e5;
const DAY = 864e5;

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
    await this.ctx.storage.put('plan', { ...plan, ...this.timesFor(p, now) });
    if (!p.kinds.rest) await this.ctx.storage.delete('rest');
    await this.schedule();
  }

  private timesFor(p: Prefs, now: number) {
    return {
      remindAt: p.kinds.remind ? nextAt(p.tz, p.reminder.days, p.reminder.at, now) : null,
      recapAt: p.kinds.recap ? nextAt(p.tz, [p.recap.day], p.recap.at, now) : null,
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

  /** What the reminder and recap need: the last day anything was logged, the next program day, this week's counts. */
  async activity(a: Activity): Promise<void> {
    await this.ctx.storage.put('activity', a);
  }

  /** One push to one device, now. Returns the push service's status (0: unreachable or not configured). */
  async sendTest(device: string): Promise<number | null> {
    if (!(await this.devices())[device]) return null;
    return (await this.send('test', testNote(), [device]))[device] ?? 0;
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
      // Nothing logged today is the whole point: a day with a set in it gets no reminder.
      if (prefs.kinds.remind && act?.date !== today) await this.send('remind', remindNote(act?.next));
      plan.remindAt = this.timesFor(prefs, now).remindAt;
    }
    if (plan.recapAt != null && plan.recapAt <= now) {
      if (prefs.kinds.recap) await this.send('recap', recapNote(act && act.week.start === weekStart(today) ? act.week : null));
      plan.recapAt = this.timesFor(prefs, now).recapAt;
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
    const times = [rest?.due, ...(has ? [plan.remindAt, plan.recapAt] : []), plan.pruneAt].filter((t): t is number => t != null);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  /** Sends one kind to the given devices (all by default), keeping each device's last result. Logs kind, status and time only. */
  private async send(kind: Kind, note: { title: string; body: string }, ids?: string[]): Promise<Record<string, number>> {
    const key = parseVapid(this.env.VAPID_PRIVATE_JWK);
    const out: Record<string, number> = {};
    if (!key) { console.log(JSON.stringify({ kind, error: 'no VAPID key' })); return out; }
    const payload = buildPayload(kind, note, this.env.APP_URL);
    const all = await this.devices();
    for (const d of Object.values(all)) {
      if (ids && !ids.includes(d.id)) continue;
      const now = this.now();
      if (d.backoffUntil && d.backoffUntil > now) { out[d.id] = 429; continue; }
      const t0 = Date.now();
      const status = await sendOne(d, payload, DELIVERY[kind], await vapidAuth(this.kv, key, d.endpoint, this.env.VAPID_SUBJECT, now));
      console.log(JSON.stringify({ kind, status, ms: Date.now() - t0 }));
      out[d.id] = status;
      if (status === 404 || status === 410) { delete all[d.id]; continue; } // the subscription is gone for good
      Object.assign(d, { lastAt: now, lastStatus: status }, status >= 200 && status < 300 && { lastOkAt: now }, status === 429 && { backoffUntil: now + 60_000 });
    }
    await this.ctx.storage.put('devices', all);
    return out;
  }
}
