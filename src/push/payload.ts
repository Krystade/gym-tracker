// What a push carries, shared by the app's service worker and the Worker (worker/ imports this file by relative path),
// so the two can't drift. No DOM, no Vite: plain TypeScript both builds understand.

/** The kinds of push this round sends. Friend kinds come with friend messaging. */
export type Kind = 'test' | 'rest' | 'remind' | 'recap';

/** Where a tap on the notification lands: the hash `#open=<route>` (see routes.ts). */
export type Route = 'rest' | 'today' | 'recap' | 'friends' | `friend.${string}`;

export interface PushNote {
  title: string;
  body: string;
  lang: 'en';
  /** Absolute, inside the app's scope: where iOS's declarative push opens the app when the service worker doesn't run. */
  navigate: string;
  app_badge?: string;
  data: { kind: Kind; route: Route };
}

/** Declarative Web Push (iOS 18.4+): shown by the system as is; older iOS, Chrome and Firefox hand it to the service worker. */
export interface PushPayload { web_push: 8030; notification: PushNote; mutable: true }

export interface Delivery { ttl: number; urgency: 'high' | 'normal' | 'low'; topic: string }

/** Per kind: how long the push service keeps it for a phone that's off, how hard it tries, and what a newer one replaces. */
export const DELIVERY: Record<Kind, Delivery> = {
  rest: { ttl: 60, urgency: 'high', topic: 'rest' },
  remind: { ttl: 4 * 3600, urgency: 'normal', topic: 'remind' },
  recap: { ttl: 86400, urgency: 'low', topic: 'recap' },
  test: { ttl: 600, urgency: 'normal', topic: 'test' },
};

const ROUTE: Record<Kind, Route> = { rest: 'rest', remind: 'today', recap: 'recap', test: 'today' };

/** The rest label as the app sends it ("Bench Press · set 4 next"), cut to what fits a lock-screen line. */
export const MAX_LABEL = 60;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const testNote = () => ({ title: 'Test notification', body: 'Notifications work on this phone.' });
export const restNote = (label?: string | null) => ({ title: 'Rest done', body: label?.trim().slice(0, MAX_LABEL) || 'Time for your next set' });
export const remindNote = (next?: string | null) => ({ title: 'Time to train', body: next ? `${next} is up · nothing logged yet` : 'Nothing logged yet today' });
export const recapNote = (w: { sessions: number; sets: number; prs: number } | null) => ({
  title: 'Your week',
  body: w && w.sessions > 0 ? `This week: ${plural(w.sessions, 'session')} · ${plural(w.sets, 'set')} · ${plural(w.prs, 'PR')}` : 'This week: no sessions logged',
});

/** The payload for one push. `appUrl`: the app's start URL (its scope), so `navigate` is absolute and in scope. */
export function buildPayload(kind: Kind, note: { title: string; body: string }, appUrl: string): PushPayload {
  const route = ROUTE[kind];
  return { web_push: 8030, notification: { title: note.title, body: note.body, lang: 'en', navigate: new URL(`#open=${route}`, appUrl).href, data: { kind, route } }, mutable: true };
}

/** What the service worker shows for whatever arrived: a broken payload still shows something (iOS revokes push after 3 silent ones). */
export function noteOf(raw: unknown): { title: string; body: string; lang?: string; badge?: number; data: { kind?: string; route?: string } } {
  const n = (raw && typeof raw === 'object' && 'notification' in raw ? (raw as { notification: unknown }).notification : raw) as Partial<PushNote> | null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const data = n && typeof n.data === 'object' && n.data ? n.data : {};
  const badge = Number(n?.app_badge);
  return {
    title: str(n?.title) || 'Gym Tracker',
    body: str(n?.body),
    ...(str(n?.lang) && { lang: str(n?.lang) }),
    ...(n?.app_badge != null && Number.isFinite(badge) && badge >= 0 && { badge }),
    data: { kind: str((data as { kind?: unknown }).kind) || undefined, route: str((data as { route?: unknown }).route) || undefined },
  };
}
