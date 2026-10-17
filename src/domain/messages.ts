import { isPreset, MAX_MESSAGE, PRESETS } from '../push/payload';

// Pings and messages between friends, as the app shows them. Stored in users/{to}/inbox (firestore.rules); this file is
// the arithmetic on what was read: the thread, what's unread, how long ago.

export { MAX_MESSAGE, PRESET_KEYS, PRESETS, type PresetKey } from '../push/payload';

/** One inbox document as read: a ping (`e`, a preset key) or a message (`t`). `at` is the server's time, in ms. */
export interface InboxDoc { id: string; from: string; kind: 'p' | 'm'; e?: string; t?: string; at: number }

/** One line in a thread: yours on the right, theirs on the left; a gym they sent shows with Add and Dismiss. */
export interface ThreadItem { id: string; mine: boolean; at: number; kind: 'p' | 'm' | 'gym'; text: string }

/** Older than this, the recipient's phone deletes it (Spark has no automatic expiry). */
export const KEEP_MS = 30 * 864e5;
/** The last this many show in a thread. */
export const THREAD_MAX = 20;

/** A ping or message as text: "💪 Strong", the message itself, or "Ping" for a preset this version doesn't know. */
export function itemText(d: Pick<InboxDoc, 'kind' | 'e' | 't'>): string {
  if (d.kind === 'm') return d.t ?? '';
  return isPreset(d.e) ? `${PRESETS[d.e].emoji} ${PRESETS[d.e].copy}` : 'Ping';
}

/** The short form for a row: a ping's emoji alone, a message cut to fit. */
export function itemShort(d: Pick<InboxDoc, 'kind' | 'e' | 't'>, max = 24): string {
  if (d.kind === 'p') return isPreset(d.e) ? PRESETS[d.e].emoji : 'Ping';
  const t = (d.t ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Both halves of a conversation and the gyms they sent, oldest first, the last `max` of them. */
export function thread(mine: InboxDoc[], theirs: InboxDoc[], gyms: { id: string; sent: number; name: string }[], max = THREAD_MAX): ThreadItem[] {
  const items: ThreadItem[] = [
    ...mine.map((d) => ({ id: d.id, mine: true, at: d.at, kind: d.kind, text: itemText(d) })),
    ...theirs.map((d) => ({ id: d.id, mine: false, at: d.at, kind: d.kind, text: itemText(d) })),
    ...gyms.map((g) => ({ id: g.id, mine: false, at: g.sent, kind: 'gym' as const, text: g.name })),
  ];
  return items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-max);
}

/** Per friend: how many of their pings and messages came after you last opened their thread. Only current friends count. */
export function unreadOf(inbox: InboxDoc[], readAt: Record<string, number | undefined>, friends: ReadonlySet<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of inbox) if (friends.has(d.from) && d.at > (readAt[d.from] ?? 0)) out[d.from] = (out[d.from] ?? 0) + 1;
  return out;
}

/** Per friend, the newest thing they sent. */
export function latestOf(inbox: InboxDoc[]): Record<string, InboxDoc> {
  const out: Record<string, InboxDoc> = {};
  for (const d of inbox) if (!out[d.from] || d.at > out[d.from].at) out[d.from] = d;
  return out;
}

/** What the recipient's phone clears: anything over 30 days old, and anything from someone no longer a friend. */
export const toClear = (inbox: InboxDoc[], friends: ReadonlySet<string>, now: number) => inbox.filter((d) => d.at < now - KEEP_MS || !friends.has(d.from)).map((d) => d.id);

/** "now", "5m", "2h", "3d": how long ago, for a row. */
export function shortAgo(at: number, now: number): string {
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 24 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

/** A message the rules will take: 1 to 140 characters as they count them (a JS string's length) after trimming. */
export const messageOk = (t: string) => t.trim().length >= 1 && t.trim().length <= MAX_MESSAGE;
