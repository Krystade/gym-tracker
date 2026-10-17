import { noteOf } from './payload';
import { isRoute } from './routes';
import type { PushRecords } from './store';

// The service worker's push and notificationclick handlers, written against the few things they touch so tests can fake them.

interface Win { focus(): Promise<unknown>; postMessage(m: unknown): void }
export interface SwDeps {
  registration: { showNotification(title: string, options?: NotificationOptions): Promise<void> };
  clients: { matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly Win[]>; openWindow(url: string): Promise<unknown> };
  setBadge: (n?: number) => Promise<void>;
  record: <K extends keyof PushRecords>(key: K, value: PushRecords[K]) => Promise<void>;
  /** The registration's scope: the app's start URL. */
  scope: string;
}
interface ExtendableEvent { waitUntil(p: Promise<unknown>): void }
export interface PushEventLike extends ExtendableEvent {
  data?: { json(): unknown; text(): string } | null;
  /** Declarative Web Push (iOS 18.4+): the notification the system proposes. */
  notification?: { title?: string; body?: string; lang?: string; data?: unknown } | null;
}
export interface ClickEventLike extends ExtendableEvent { notification: { close(): void; data?: unknown } }

const parse = (e: PushEventLike): unknown => {
  if (e.notification) return e.notification;
  try { return e.data?.json(); } catch { return null; }
};

/**
 * Every push shows a notification, whatever it carried: Safari revokes the subscription after three that show nothing,
 * and that counts pushes that arrive while the app is open. Anything that should stay quiet is decided on the Worker.
 */
export function onPush(e: PushEventLike, d: SwDeps): void {
  const n = noteOf(parse(e));
  const shown = d.registration.showNotification(n.title, { body: n.body, data: n.data, ...(n.lang && { lang: n.lang }) });
  // The rest is bookkeeping: none of it may stop the notification, so each failure is its own.
  const extras = Promise.allSettled([
    n.badge != null ? d.setBadge(n.badge) : Promise.resolve(),
    d.record('lastPush', { at: Date.now(), kind: n.data.kind ?? null }),
    d.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => { for (const w of ws) w.postMessage({ type: 'push', kind: n.data.kind ?? null, route: n.data.route ?? null }); }),
  ]);
  e.waitUntil(Promise.all([shown, extras]));
}

/** A tap: an open window goes there; with none, a new one opens on the route. The route is stored too, for a window that loses the hash. */
export function onNotificationClick(e: ClickEventLike, d: SwDeps): void {
  e.notification.close();
  const raw = (e.notification.data as { route?: unknown } | undefined)?.route;
  const route = isRoute(raw) ? raw : 'today';
  e.waitUntil((async () => {
    await d.record('route', { route, at: Date.now() }).catch(() => {});
    const [w] = await d.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (w) {
      await w.focus().catch(() => {});
      w.postMessage({ type: 'open', route });
      return;
    }
    await d.clients.openWindow(`${d.scope}#open=${route}`);
  })());
}
