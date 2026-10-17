import { loadCloud } from '../cloud/firebase';
import { PUSH_ON, VAPID_PUBLIC_KEY, WORKER_REACHABLE, WORKER_URL } from './config';
import type { Activity } from './activity';

// The app's side of push: subscribing this phone, the preferences, and the calls the rest timer and the log make.
// Nothing here runs unless config.ts names a Worker; until this phone is turned on, nothing calls it.

export interface PushPrefs {
  /** `activity`: a friend request, a request or invite accepted, a gym sent to you. */
  kinds: { rest: boolean; remind: boolean; recap: boolean; activity: boolean };
  /** Days 0 = Sunday … 6 = Saturday, at local "HH:MM". */
  reminder: { days: number[]; at: string };
  recap: { day: number; at: string };
}
interface Local { device: string | null; prefs: PushPrefs | null; activity?: string; synced?: number; lost?: boolean }

const KEY = 'gym-tracker:push';
const load = (): Local => { try { return { device: null, prefs: null, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { device: null, prefs: null }; } };
const save = (patch: Partial<Local>) => { try { localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch })); } catch { /* private mode: lives for the page */ } notify(); };

// The card re-renders on any change here.
const subs = new Set<() => void>();
const notify = () => { for (const f of subs) f(); };
export const subscribeLocal = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const localState = load;

/** Reminder days spread over the week for a sessions-per-week goal: 2 → Tuesday and Friday. */
export function spreadDays(goal: number): number[] {
  const table: Record<number, number[]> = { 1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
  return table[Math.min(7, Math.max(1, Math.round(goal)))];
}
export const defaultPrefs = (goal: number): PushPrefs => ({
  kinds: { rest: true, remind: false, recap: true, activity: true },
  reminder: { days: spreadDays(goal), at: '18:00' },
  recap: { day: 0, at: '18:00' },
});
/** Saved prefs with any kind added since they were saved filled in as its default (on). */
export const withDefaults = (p: PushPrefs | null, goal: number): PushPrefs => {
  const d = defaultPrefs(goal);
  return p ? { ...d, ...p, kinds: { ...d.kinds, ...p.kinds } } : d;
};

/** The app is running from the Home Screen, the only place iOS gives web push. */
export const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export class PushError extends Error { constructor(readonly status: number) { super(`push ${status}`); } }

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const c = await loadCloud();
  await c.auth.authStateReady();
  const user = c.auth.currentUser;
  if (!user) throw new PushError(401);
  if (!WORKER_REACHABLE) throw new PushError(0);
  const r = await fetch(`${WORKER_URL}${path}`, {
    method, headers: { authorization: `Bearer ${await user.getIdToken()}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new PushError(r.status);
  return r.json() as Promise<T>;
}

const key = () => Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const register = (sub: PushSubscription) => api<{ id: string }>('POST', '/subscribe', { ...sub.toJSON(), ua: navigator.userAgent.slice(0, 200) });

/**
 * Turns notifications on, from the button's click. iOS only shows its prompt for a tap, so subscribe() is the first thing
 * awaited: `reg` is fetched when the card mounts, not here.
 */
export async function enablePush(reg: ServiceWorkerRegistration, goal: number): Promise<void> {
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() });
  const { id } = await register(sub);
  const prefs = withDefaults(load().prefs, goal);
  save({ device: id, prefs, lost: false, synced: Date.now(), activity: undefined });
  await api('PUT', '/prefs', { tz: tz(), ...prefs });
}

/** Off on this phone: the subscription goes, and the Worker forgets the device. */
export async function disablePush(): Promise<void> {
  const { device } = load();
  try { await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe(); } catch { /* gone already */ }
  if (device) await api('DELETE', `/subscribe/${device}`).catch(() => {});
  save({ device: null, lost: false, activity: undefined });
}

/** Signed out: this phone's subscription goes, so the Worker's next push to it fails and it drops the device. */
export async function forgetDevice(): Promise<void> {
  if (!load().device) return;
  try { await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe(); } catch { /* gone already */ }
  save({ device: null, activity: undefined });
}

const RESYNC_MS = 10 * 60_000;
/**
 * On coming back to the front: iOS can drop a subscription without telling the page (and has no pushsubscriptionchange),
 * so check it's there and tell the Worker this phone is still in use. A dropped one is renewed without a tap if iOS
 * allows that (unverified); if it doesn't, the card offers "Re-enable notifications".
 */
export async function resyncPush(force = false): Promise<void> {
  const l = load();
  if (!PUSH_ON || !l.device || (!force && l.synced && Date.now() - l.synced < RESYNC_MS)) return;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    if (Notification.permission !== 'granted') { save({ device: null }); return; }
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() }); } catch { save({ lost: true }); return; }
  }
  const { id } = await register(sub);
  save({ device: id, lost: false, synced: Date.now() });
  if (l.prefs) await api('PUT', '/prefs', { tz: tz(), ...withDefaults(l.prefs, 2) });
}

let prefsTimer: ReturnType<typeof setTimeout> | undefined;
/** Saves the preferences here at once and sends them a second after the last change. */
export function setPrefs(p: PushPrefs, onError?: (e: unknown) => void): void {
  save({ prefs: p });
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => { if (load().device) api('PUT', '/prefs', { tz: tz(), ...p }).catch((e) => onError?.(e)); }, 1000);
}

/** Sends the reminder and recap numbers when they've changed. */
export async function postActivity(a: Activity): Promise<void> {
  const l = load(), json = JSON.stringify(a);
  if (!PUSH_ON || !l.device || l.activity === json) return;
  await api('POST', '/activity', a);
  save({ activity: json });
}

/**
 * Tells the Worker about a friend write just made, so the friend's phone can ring: a request, an accepted request or
 * invite, a gym sent. The Worker checks it in Firestore as this person before anything is sent. Whether or not this
 * phone has notifications on, and never failing the write it follows: a friend without them simply hears nothing.
 */
export function notifyFriend(kind: 'request' | 'accepted' | 'gym', to: string, id?: string): void {
  if (!WORKER_REACHABLE) return;
  void api('POST', '/notify', { kind, to, ...(id && { id }) }).catch(() => {});
}

export const sendTest = () => api<{ status: number }>('POST', '/test', { sub: load().device });
export interface Status { devices: { id: string; lastStatus: number | null; lastOkAt: number | null; lastAt: number | null }[]; configured: boolean; alarm: number | null }
export const getStatus = () => api<Status>('GET', '/status');

// The rest timer's lock-screen alert. `alert`: whether the Worker took the last one (the bar says when it didn't).
let restCancel: ReturnType<typeof setTimeout> | undefined;
let restAlert: 'ok' | 'failed' | null = null;
const restSubs = new Set<() => void>();
const setAlert = (a: typeof restAlert) => { restAlert = a; for (const f of restSubs) f(); };
export const restAlertState = () => restAlert;
export const subscribeRestAlert = (f: () => void) => { restSubs.add(f); return () => { restSubs.delete(f); }; };

/**
 * A rest started (or changed) to end at `until`, or ended (null). The Worker pushes at the end; while the app is on
 * screen it's told to stand down 3 s before, and the bar ends the rest itself. In the background that page timer is
 * suspended, so the push goes out.
 */
export function restPush(until: number | null, label = ''): void {
  if (!PUSH_ON) return;
  const l = load();
  if (!l.device || !l.prefs?.kinds.rest) return;
  clearTimeout(restCancel);
  if (until == null) { setAlert(null); void api('DELETE', '/timer').catch(() => {}); return; }
  const seconds = Math.round((until - Date.now()) / 1000);
  if (seconds < 5) return;
  api('POST', '/timer', { sub: l.device, seconds, label }).then(() => setAlert('ok'), () => setAlert('failed'));
  restCancel = setTimeout(() => { if (document.visibilityState === 'visible') void api('DELETE', '/timer').catch(() => {}); }, Math.max(0, until - Date.now() - 3000));
}
