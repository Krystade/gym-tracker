import { MAX_HURTS, MAX_LABEL, MAX_LIFT, PAIN_REGIONS, type PainRegion } from '../../src/push/payload';
import type { PainDay } from './pain';
import type { Claim } from './notify';
import { validZone } from './schedule';

// Every request body is checked here, field by field; anything else is a 400. Nothing from a body is ever logged.

export class BadRequest extends Error {}
const bad = (what: string): never => { throw new BadRequest(what); };
const obj = (v: unknown, what: string) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(what));
const int = (v: unknown, lo: number, hi: number, what: string) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : bad(what));
const bool = (v: unknown, what: string) => (typeof v === 'boolean' ? v : bad(what));
const hhmm = (v: unknown, what: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : bad(what));
const date = (v: unknown, what: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad(what));
const text = (v: unknown, max: number, what: string) => (typeof v === 'string' && v.length <= max ? v : bad(what));
const b64u = (v: unknown, bytes: number, what: string) => (typeof v === 'string' && v.length === Math.ceil((bytes * 4) / 3) && /^[A-Za-z0-9_-]+$/.test(v) ? v : bad(what));

/** Push services the Worker will send to: Apple, Google, Mozilla, Microsoft. Nothing else, so it can't be pointed anywhere. */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export interface Subscription { endpoint: string; p256dh: string; auth: string; ua: string }
export function subscription(v: unknown, local: boolean): Subscription {
  const o = obj(v, 'body'), keys = obj(o.keys, 'keys');
  const endpoint = text(o.endpoint, 1024, 'endpoint');
  let u: URL;
  try { u = new URL(endpoint); } catch { return bad('endpoint'); }
  const fine = (u.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(u.hostname))) || (local && u.protocol === 'http:' && u.hostname === '127.0.0.1');
  if (!fine) bad('endpoint');
  return { endpoint, p256dh: b64u(keys.p256dh, 65, 'p256dh'), auth: b64u(keys.auth, 16, 'auth'), ua: o.ua == null ? '' : text(o.ua, 200, 'ua') };
}

export interface Prefs {
  tz: string;
  /**
   * `activity`: a friend's request, acceptance or gym. `friends`: their pings and messages. `pain`: the next-morning question
   * after pain (item 08). Missing (an app from before they existed) means on.
   */
  kinds: { rest: boolean; remind: boolean; recap: boolean; activity?: boolean; friends?: boolean; pain?: boolean };
  /**
   * Days 0 = Sunday … 6 = Saturday, at local "HH:MM". `learn`: fitted to his log (the app's learned days and times, and quiet once
   * the week's goal is met); it can only make the reminder quieter or later, never add one. Missing (an older app) means on.
   */
  reminder: { days: number[]; at: string; learn?: boolean };
  recap: { day: number; at: string };
  /** Friends whose pushes this person has muted (in the app, on that friend). They're never told. */
  muted?: string[];
}
export const DEFAULT_PREFS: Prefs = { tz: 'UTC', kinds: { rest: true, remind: false, recap: false, activity: true, friends: true }, reminder: { days: [], at: '18:00' }, recap: { day: 0, at: '18:00' } };
/** Whether a kind that came later than the app's first prefs is on: unset is on. */
export const on = (v: boolean | undefined) => v !== false;

export function prefs(v: unknown): Prefs {
  const o = obj(v, 'body'), k = obj(o.kinds, 'kinds'), r = obj(o.reminder, 'reminder'), c = obj(o.recap, 'recap');
  if (!validZone(o.tz)) bad('tz');
  const days = Array.isArray(r.days) && r.days.length <= 7 ? r.days.map((d) => int(d, 0, 6, 'days')) : bad('days');
  if (new Set(days).size !== days.length) bad('days');
  return {
    tz: o.tz as string,
    kinds: { rest: bool(k.rest, 'rest'), remind: bool(k.remind, 'remind'), recap: bool(k.recap, 'recap'), activity: k.activity == null ? true : bool(k.activity, 'activity'),
      friends: k.friends == null ? true : bool(k.friends, 'friends'), pain: k.pain == null ? true : bool(k.pain, 'pain') },
    reminder: { days: days.sort(), at: hhmm(r.at, 'at'), learn: r.learn == null ? true : bool(r.learn, 'learn') },
    recap: { day: int(c.day, 0, 6, 'day'), at: hhmm(c.at, 'at') },
    muted: o.muted == null ? [] : Array.isArray(o.muted) && o.muted.length <= 500 ? [...new Set(o.muted.map((u) => docId(u, 'muted')))] : bad('muted'),
  };
}

export interface Timer { sub: string; seconds: number; label: string }
export function timer(v: unknown): Timer {
  const o = obj(v, 'body');
  return { sub: deviceId(o.sub), seconds: int(o.seconds, 5, 3600, 'seconds'), label: o.label == null ? '' : text(o.label, 200, 'label').slice(0, MAX_LABEL) };
}

/**
 * `week.cardio`: cardio-only days, apart from sessions; an app from before it sends none, read as 0. `goal`: his sessions a week.
 * `remind`: per weekday (0 = Sunday), the app's learned reminder time "HH:MM", 'off' (not one of his days), or null (nothing
 * learned): src/domain/learn/remind.ts. An app from before them sends neither.
 */
export interface Activity {
  date: string; next: string | null; week: { start: string; sessions: number; sets: number; prs: number; cardio: number };
  goal?: number; remind?: (string | null)[];
  /** Pain days the phone hasn't asked about (item 08): at most two (yesterday and today), each a day, a region and a lift's name. */
  pain?: PainDay[];
}
const learned = (v: unknown) => (v === null || v === 'off' ? v : hhmm(v, 'remind'));
const region = (v: unknown) => (typeof v === 'string' && (PAIN_REGIONS as readonly string[]).includes(v) ? (v as PainRegion) : bad('region'));
function painDays(v: unknown): PainDay[] {
  if (!Array.isArray(v) || v.length > 2) return bad('pain');
  const hurt = (x: unknown) => { const o = obj(x, 'pain'); const lift = text(o.lift, MAX_LIFT, 'lift').trim(); return { region: region(o.region), lift: lift || bad('lift') }; };
  // `hurts`: every region and lift of the day, at most MAX_HURTS; an app before them sends none.
  const hurts = (h: unknown) => (Array.isArray(h) && h.length >= 1 && h.length <= MAX_HURTS ? h.map(hurt) : bad('hurts'));
  const out = v.map((x) => { const o = obj(x, 'pain'); return { date: date(o.date, 'pain'), ...hurt(o), ...(o.hurts != null && { hurts: hurts(o.hurts) }) }; });
  if (new Set(out.map((p) => p.date)).size !== out.length) bad('pain');
  return out;
}
export function activity(v: unknown): Activity {
  const o = obj(v, 'body'), w = obj(o.week, 'week');
  return {
    ...(o.goal != null && { goal: int(o.goal, 1, 7, 'goal') }),
    ...(o.remind != null && { remind: Array.isArray(o.remind) && o.remind.length === 7 ? o.remind.map(learned) : bad('remind') }),
    ...(o.pain != null && { pain: painDays(o.pain) }),
    date: date(o.date, 'date'),
    next: o.next == null ? null : text(o.next, 40, 'next'),
    week: { start: date(w.start, 'start'), sessions: int(w.sessions, 0, 7, 'sessions'), sets: int(w.sets, 0, 10_000, 'sets'), prs: int(w.prs, 0, 10_000, 'prs'),
      cardio: w.cardio == null ? 0 : int(w.cardio, 0, 7, 'cardio') },
  };
}

/** A Firebase uid or a Firestore document id: letters, digits, _ and -. */
export const docId = (v: unknown, what: string) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : bad(what));

export function claim(v: unknown): Claim {
  const o = obj(v, 'body');
  if (o.kind !== 'request' && o.kind !== 'accepted' && o.kind !== 'gym' && o.kind !== 'inbox') bad('kind');
  const kind = o.kind as Claim['kind'];
  return { kind, to: docId(o.to, 'to'), ...((kind === 'gym' || kind === 'inbox') && { id: docId(o.id, 'id') }) };
}

/** The app icon's count: the unread friend items the app counted. */
export const badge = (v: unknown) => int(obj(v, 'body').n, 0, 9999, 'n');

export const deviceId = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : bad('sub'));
