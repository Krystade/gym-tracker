import { noteOf } from './payload';
import { tagNote } from '../domain/friendNames';
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
  /** Your private tags for friends, by uid (push/store, kept by state/friendCache); none in tests that don't need them. */
  tags?: () => Promise<Record<string, string> | undefined>;
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
/** How long a friend's push waits for the tags before it shows as it came. */
const TAGS_WAIT_MS = 500;
const FRIEND_KINDS = new Set(['request', 'accepted', 'gym', 'ping', 'message']);
type Note = ReturnType<typeof noteOf>;
/**
 * A friend's push with your tag for them, else their display name (`dn`), beside their name. Who it's from is in its data
 * (`from`, `name`); from a Worker before that, a ping or message still names them in its title and lands on them (`friend.<uid>`).
 */
async function tagged(n: Note, d: SwDeps): Promise<Note> {
  const k = n.data.kind;
  const from = n.data.from ?? (n.data.route?.startsWith('friend.') ? n.data.route.slice('friend.'.length) : undefined);
  const name = n.data.name ?? (k === 'ping' || k === 'message' ? n.title : undefined);
  if (!d.tags || !from || !name) return n;
  const tags = await Promise.race([d.tags().catch(() => undefined), new Promise<undefined>((r) => setTimeout(r, TAGS_WAIT_MS))]);
  return tagNote(n, k, name, tags?.[from], n.data.dn);
}

export function onPush(e: PushEventLike, d: SwDeps): void {
  const n = noteOf(parse(e));
  const friend = !!d.tags && FRIEND_KINDS.has(n.data.kind ?? '');
  // Where a tap lands, as the declarative notification this replaces had it. A browser that knows `navigate` (iOS 18.4+)
  // opens it itself and fires no notificationclick; shown without one, a tap there just brought the app up wherever it
  // was. One that doesn't know it ignores it and fires notificationclick, below.
  const options: NotificationOptions & { navigate: string } = {
    body: n.body, data: n.data, ...(n.lang && { lang: n.lang }), navigate: `${d.scope}#open=${isRoute(n.data.route) ? n.data.route : 'today'}`,
  };
  // Shown at once, unless it's a friend's: then after a look at your tags (never longer than TAGS_WAIT_MS).
  const shown = friend
    ? tagged(n, d).catch(() => n).then((t) => d.registration.showNotification(t.title, { ...options, body: t.body }))
    : d.registration.showNotification(n.title, options);
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
