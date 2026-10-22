// What a push carries, shared by the app's service worker and the Worker (worker/ imports this file by relative path),
// so the two can't drift. No DOM, no Vite: plain TypeScript both builds understand.

/** Pushes about friends: a request, an accepted request or invite, a gym sent to you. */
export type ActivityKind = 'request' | 'accepted' | 'gym';
/** A friend's ping (one tap, a preset) or message (up to 140 characters). */
export type MessageKind = 'ping' | 'message';
export type FriendKind = ActivityKind | MessageKind;
/** `pain`: the next-morning question about yesterday's pain (item 08, round 20). */
export type Kind = 'test' | 'rest' | 'remind' | 'recap' | 'pain' | FriendKind;
export const ACTIVITY_KINDS: readonly ActivityKind[] = ['request', 'accepted', 'gym'];

/** Where a tap on the notification lands: the hash `#open=<route>` (see routes.ts). */
export type Route = 'rest' | 'today' | 'recap' | 'pain' | 'friends' | `friend.${string}`;

export interface PushNote {
  title: string;
  body: string;
  lang: 'en';
  /** Absolute, inside the app's scope: where iOS's declarative push opens the app when the service worker doesn't run. */
  navigate: string;
  app_badge?: string;
  /**
   * `from`, `name`, `dn`: a friend's push, its sender's uid, username and display name (as the Worker read them from their
   * profile), so the phone can lead with its own private tag for them, else their display name, beside the username (sw-push,
   * domain/friendNames tagNote). Never in other pushes.
   */
  data: { kind: Kind; route: Route; from?: string; name?: string; dn?: string };
}

/**
 * The reminder's time on weekday `wd` (0 = Sunday), or null for none that day; the Worker plans by it and the app's card shows
 * it. Only on a day he picked; with learning on (`learn` not false), none on a day the app learned isn't one of his ('off'),
 * and the later of his time and the learned one (src/domain/learn/remind.ts). So learning only ever takes a reminder away or
 * makes it later: never a day he didn't pick, never earlier than his time.
 */
export function remindTime(reminder: { days: readonly number[]; at: string; learn?: boolean }, learned: readonly (string | null)[] | null | undefined, wd: number): string | null {
  if (!reminder.days.includes(wd)) return null;
  const l = reminder.learn === false ? null : learned?.[wd] ?? null;
  if (l === 'off') return null;
  return l != null && l > reminder.at ? l : reminder.at;
}

/** Declarative Web Push (iOS 18.4+): shown by the system as is; older iOS, Chrome and Firefox hand it to the service worker. */
export interface PushPayload { web_push: 8030; notification: PushNote; mutable: true }

export interface Delivery { ttl: number; urgency: 'high' | 'normal' | 'low'; topic: string }

/** Per kind: how long the push service keeps it for a phone that's off, how hard it tries, and what a newer one replaces. */
export const DELIVERY: Record<Kind, Delivery> = {
  rest: { ttl: 60, urgency: 'high', topic: 'rest' },
  remind: { ttl: 4 * 3600, urgency: 'normal', topic: 'remind' },
  recap: { ttl: 86400, urgency: 'low', topic: 'recap' },
  // The question is about this morning: a phone that was off till the evening is better asked by Today's card.
  pain: { ttl: 8 * 3600, urgency: 'normal', topic: 'pain' },
  test: { ttl: 600, urgency: 'normal', topic: 'test' },
  // A friend's: kept a day, and the topic is the sender's (friendTopic), so one waiting push per friend.
  request: { ttl: 86400, urgency: 'normal', topic: 'friend' },
  accepted: { ttl: 86400, urgency: 'normal', topic: 'friend' },
  gym: { ttl: 86400, urgency: 'normal', topic: 'friend' },
  ping: { ttl: 86400, urgency: 'normal', topic: 'friend' },
  message: { ttl: 86400, urgency: 'normal', topic: 'friend' },
};

/** Where each kind lands; a friend's kinds land on that friend (the route passed to buildPayload). */
const ROUTE: Record<Kind, Route> = { rest: 'rest', remind: 'today', recap: 'recap', pain: 'pain', test: 'today', request: 'friends', accepted: 'friends', gym: 'friends', ping: 'friends', message: 'friends' };

/**
 * The Topic header for pushes from one sender: 22 base64url characters of SHA-256(uid). A push still waiting at the push
 * service is replaced by a newer one with the same topic, so a phone that was off gets one per friend, not a pile.
 */
export async function friendTopic(uid: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid)));
  return btoa(String.fromCharCode(...h)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22);
}

/** The first `n` characters as a person counts them (an emoji, however it's built, is one), so a cut never leaves half of one. */
export function cut(s: string, n: number): string {
  const t = s.trim();
  const seg = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(t)].map((x) => x.segment) : [...t];
  return seg.slice(0, n).join('');
}
/**
 * At most `n` characters as a person counts them, cut at a word with an ellipsis when it doesn't fit (never "Dumbbe"); a single
 * word longer than the room is cut inside it, still with the ellipsis. A trailing separator (" ·", ":") goes before the ellipsis.
 */
export function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (cut(t, n) === t) return t;
  const room = cut(t, n - 1);
  const at = room.lastIndexOf(' ');
  const head = at > 0 && t[room.length] !== ' ' ? room.slice(0, at) : room;
  return `${head.replace(/[\s·:,;–—-]+$/u, '')}…`;
}
/** What iOS shows of a notification on the 13 mini's lock screen and banners: a title line, and about two lines of body. */
export const MAX_TITLE = 30;
export const MAX_BODY = 90;
/** A gym's name on the lock screen. */
export const MAX_GYM = 40;

/** The rest label as the app sends it ("Bench Press · set 4 next"), cut to what fits a lock-screen line. */
export const MAX_LABEL = 60;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const testNote = () => ({ title: 'Test notification', body: 'Notifications work on this phone.' });
export const restNote = (label?: string | null) => ({ title: 'Rest done', body: clip(label ?? '', MAX_LABEL) || 'Time for your next set' });
export const remindNote = (next?: string | null) => ({ title: 'Time to train', body: next ? `${clip(next, 40)} is up · nothing logged yet` : 'Nothing logged yet today' });
/**
 * Sessions are lift days; cardio-only days go beside them, never toward the goal. An app before them sends no `cardio`. `ach`:
 * the week's achievements, a count only, said when there are some (owner Q5: the recap is the only achievements push).
 */
export const recapNote = (w: { sessions: number; sets: number; prs: number; cardio?: number; ach?: number } | null) => {
  const cardio = w?.cardio ? plural(w.cardio, 'cardio day') : '';
  const ach = w?.ach ? ` · ${plural(w.ach, 'achievement')}` : '';
  return {
    title: 'Your week',
    body: w && w.sessions > 0 ? `This week: ${plural(w.sessions, 'session')}${cardio && ` + ${cardio}`} · ${plural(w.sets, 'set')} · ${plural(w.prs, 'PR')}${ach}`
      : cardio ? `This week: no sessions · ${cardio}${ach}` : 'This week: no sessions logged',
  };
};

/**
 * The regions a pain set can name (src/domain/types REGIONS; the same list, here so the Worker can check what it's sent without
 * importing the app's domain).
 */
export const PAIN_REGIONS = ['elbow', 'lower back', 'shoulder', 'wrist', 'knee', 'other'] as const;
export type PainRegion = (typeof PAIN_REGIONS)[number];
/** A lift's name in the pain push: what fits a lock-screen line. */
export const MAX_LIFT = 40;
/** What hurt on a pain day: a region, and the lift it hurt on worst. */
export interface Hurt { region: PainRegion; lift: string }
/** The most regions a pain day's push names (there are six). */
export const MAX_HURTS = 6;
/**
 * The next-morning question (item 08): every region that hurt yesterday and the lifts it hurt on, by name, nothing else (no
 * severity, no notes), in one push (owner, 2026-10-20: "what if multiple exercises hurt multiple body parts?"). One region:
 * "How’s your elbow this morning?"; two: "How’s your elbow and knee this morning?"; more: "How are the sore spots this
 * morning?". A title that won't fit one line (MAX_TITLE: "lower back", "shoulder", most pairs) is "Morning pain check", and
 * the regions lead the body. Lift names are cut at a word. A tap opens Today at the one-tap questions.
 */
export function painNote(hurts: readonly Hurt[]) {
  const list = hurts.slice(0, MAX_HURTS);
  const regions = [...new Set(list.map((h) => h.region))];
  const lifts = [...new Set(list.map((h) => clip(h.lift, MAX_LIFT)).filter(Boolean))];
  const named = regions.filter((r) => r !== 'other');
  const asked = regions.length === 1 ? (named.length ? `How’s your ${named[0]} this morning?` : 'How’s the pain this morning?')
    : regions.length === 2 && named.length === 2 ? `How’s your ${named[0]} and ${named[1]} this morning?` : 'How are the sore spots this morning?';
  const fits = [...asked].length <= MAX_TITLE;
  const where = regions.join(', ');
  const after = fits ? 'After ' : `${where[0].toUpperCase()}${where.slice(1)}: after `;
  const tail = lifts.length > 1 || regions.length > 1 ? ' yesterday · tap to answer' : ' yesterday · settled, still sore or worse?';
  const what = clip(lifts.join(', '), MAX_BODY - [...after].length - [...tail].length) || 'yesterday’s lift';
  return { title: fits ? asked : 'Morning pain check', body: `${after}${what}${tail}` };
}

// Friend activity. `name` is the sender's username, read by the Worker from their profile, never from the request.
export const requestNote = (name: string) => ({ title: 'Friend request', body: `${name} wants to be friends` });
export const acceptedNote = (name: string) => ({ title: 'New friend', body: `You and ${name} are friends` });
export const gymNote = (name: string, gym: string) => ({ title: 'Gym shared', body: `${name} sent you a gym: ${clip(gym, MAX_GYM) || 'a gym'}` });
/**
 * The pings, stored by key (firestore.rules allows exactly these), so their words can change without touching what's
 * stored. Adding one means the rules, this table and the app together.
 */
export const PRESETS = {
  strong: { emoji: '💪', copy: 'Strong' },
  fire: { emoji: '🔥', copy: 'On fire' },
  clap: { emoji: '👏', copy: 'Nice work' },
  gym: { emoji: '🏋️', copy: 'Gym today?' },
  eyes: { emoji: '👀', copy: 'Did you lift?' },
  salute: { emoji: '🫡', copy: 'On it' },
} as const;
export type PresetKey = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];
export const isPreset = (k: unknown): k is PresetKey => typeof k === 'string' && Object.hasOwn(PRESETS, k);
/**
 * A ping on the lock screen: its emoji alone ("💪", under the sender's name), or for a key this version doesn't know,
 * "sent you a ping". A ping is the emoji, not a message: `copy` names it only for a screen reader and a long press.
 */
export const pingText = (key: unknown) => (isPreset(key) ? PRESETS[key].emoji : 'sent you a ping');
/** A message's most characters, as firestore.rules counts them: UTF-16 units, a JS string's length (💪 is two). */
export const MAX_MESSAGE = 140;
export const pingNote = (name: string, key: unknown) => ({ title: name, body: pingText(key) });
/**
 * A message on the lock screen: line breaks and other control characters become spaces (JSON would spell each in six
 * bytes), and never more than 140 UTF-16 units, cut between emoji. So the payload stays under 1 KB whatever was stored.
 */
export function messageNote(name: string, text: string) {
  let body = '';
  for (const g of [...cut(text.replace(/\p{Cc}+/gu, ' '), MAX_MESSAGE)]) { if (body.length + g.length > MAX_MESSAGE) break; body += g; }
  return { title: name, body: body.trim() || 'sent you a message' };
}

/** A push that stands for more held back by the one-a-minute limit says so. */
export const withMore = (note: { title: string; body: string }, more: number) => (more > 0 ? { ...note, body: `${note.body} · +${more} more` } : note);

/**
 * The payload for one push. `appUrl`: the app's start URL (its scope), so `navigate` is absolute and in scope.
 * `route` overrides the kind's landing place (a friend's pushes open that friend); `badge` is the app icon's count.
 */
export function buildPayload(kind: Kind, note: { title: string; body: string }, appUrl: string, opts: { route?: Route; badge?: number; from?: string; name?: string; dn?: string } = {}): PushPayload {
  const route = opts.route ?? ROUTE[kind];
  return { web_push: 8030, notification: {
    title: note.title, body: note.body, lang: 'en', navigate: new URL(`#open=${route}`, appUrl).href,
    ...(opts.badge != null && { app_badge: String(opts.badge) }),
    data: { kind, route, ...(opts.from && { from: opts.from }), ...(opts.name && { name: opts.name }), ...(opts.dn && { dn: opts.dn }) } }, mutable: true };
}

/** What the service worker shows for whatever arrived: a broken payload still shows something (iOS revokes push after 3 silent ones). */
export function noteOf(raw: unknown): { title: string; body: string; lang?: string; badge?: number; data: { kind?: string; route?: string; from?: string; name?: string; dn?: string } } {
  const n = (raw && typeof raw === 'object' && 'notification' in raw ? (raw as { notification: unknown }).notification : raw) as Partial<PushNote> | null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const data = n && typeof n.data === 'object' && n.data ? n.data : {};
  const badge = Number(n?.app_badge);
  return {
    title: str(n?.title) || 'Gym Tracker',
    body: str(n?.body),
    ...(str(n?.lang) && { lang: str(n?.lang) }),
    ...(n?.app_badge != null && Number.isFinite(badge) && badge >= 0 && { badge }),
    data: {
      kind: str((data as { kind?: unknown }).kind) || undefined, route: str((data as { route?: unknown }).route) || undefined,
      ...(str((data as { from?: unknown }).from) && { from: str((data as { from?: unknown }).from) }),
      ...(str((data as { name?: unknown }).name) && { name: str((data as { name?: unknown }).name) }),
      ...(str((data as { dn?: unknown }).dn) && { dn: str((data as { dn?: unknown }).dn) }),
    },
  };
}
