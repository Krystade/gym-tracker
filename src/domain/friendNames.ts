// How a friend is named: their @username (theirs to change, at most once a day), "formerly @old" for 30 days after a
// change, and your private tag beside it. Tags are yours alone (users/{you}/private/tags), kept by their uid, so a tag
// survives every change of name. Plain TypeScript: the service worker uses tagNote too.
import { MAX_BODY, MAX_TITLE } from '../push/payload';

/** How long "formerly @old" shows after a change. */
export const FORMERLY_MS = 30 * 864e5;
/** How often a username may change (firestore.rules holds the same: once a day). */
export const CHANGE_GAP_MS = 864e5;
/** A tag's most characters, as a person counts them. */
export const MAX_TAG = 24;

const graphemes = (s: string) =>
  typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s];

/** A tag as kept: one line, single spaces, at most MAX_TAG characters; '' for none. */
export function cleanTag(s: string): string {
  return graphemes(s.replace(/[\p{Cc}\s]+/gu, ' ').trim()).slice(0, MAX_TAG).join('').trim();
}

/** "Sam (gym) · @sam_k" with a tag, "@sam_k" without. */
export const tagged = (name: string, tag?: string) => (tag ? `${tag} · @${name}` : `@${name}`);

/** Their old username, while "formerly @old" still shows; null otherwise. */
export function formerlyOf(p: { prev?: string; changedAt?: number }, now: number): string | null {
  return p.prev && p.changedAt != null && now - p.changedAt < FORMERLY_MS ? p.prev : null;
}

/** When your username may change again; null: now. */
export function nextChangeAt(changedAt: number | undefined, now: number): number | null {
  return changedAt != null && now < changedAt + CHANGE_GAP_MS ? changedAt + CHANGE_GAP_MS : null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A friend's push as the phone shows it, with your tag for its sender. A ping's or message's title is their name; the
 * other kinds say it in the body ("sam_k wants to be friends"), and only that first whole-word mention changes.
 */
export function tagNote<N extends { title: string; body: string }>(note: N, kind: string | undefined, name: string | undefined, tag: string | undefined): N {
  if (!tag || !name) return note;
  // A title is one line on the lock screen (push/payload MAX_TITLE): a long tag and name put the tag there and the @name first
  // in the body; a body is about two lines (MAX_BODY), so a long one names them by the tag alone.
  if (kind === 'ping' || kind === 'message') {
    if (note.title !== name) return note;
    const t = tagged(name, tag);
    return graphemes(t).length <= MAX_TITLE ? { ...note, title: t } : { ...note, title: tag, body: `@${name} · ${note.body}` };
  }
  if (kind !== 'request' && kind !== 'accepted' && kind !== 'gym') return note;
  const re = new RegExp(`(^|[^a-z0-9_])${esc(name)}(?![a-z0-9_])`);
  if (!re.test(note.body)) return note;
  const by = (who: string) => note.body.replace(re, (_m, pre: string) => `${pre}${who}`);
  const full = by(tagged(name, tag));
  return { ...note, body: graphemes(full).length <= MAX_BODY ? full : by(tag) };
}
