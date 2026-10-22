// The board (social S3, S4; plan .superpowers/redesign/social/plan.md §3): one page of short text posts that everyone signed in
// reads. Posting takes a verified email, an account a day old, a one-time "16 or older, and the board's rules", and no ban;
// firestore.rules holds every one of those, and the counts and limits below are the same numbers. Plain TypeScript, no DOM.

/** A post's most characters, as firestore.rules counts them (UTF-16 units: a JS string's length; 💪 is two). */
export const MAX_POST = 280;
/** Posts show for 30 days; older ones are asked for by nobody and swept up by their author's phone and the owner's. */
export const POST_DAYS_MS = 30 * 864e5;
/** A page of the board. */
export const PAGE = 20;
/** Fewer than this left of a page once hides, mutes and blocks are taken out: one more page is read. */
export const MIN_SHOWN = 8;
/** The board as last read counts as fresh this long: opened again within it, nothing is read. */
export const CACHE_MS = 60_000;
/** Read whole (the first page again) when what's kept is this old: likes, reports and removals catch up. */
export const FULL_MS = 15 * 60_000;
/** A read of what's new starts this far before the newest post kept: two posts moments apart may commit out of order. */
export const OVERLAP_MS = 60_000;
/** firestore.rules boardRate: 60 s between posts, 5 a day from the first. */
export const POST_GAP_MS = 60_000;
export const POSTS_A_DAY = 5;
/** firestore.rules reportRate: 20 reports a day. */
export const REPORTS_A_DAY = 20;
/** At this many reports (since the owner last kept it) a post is hidden for everyone until the owner reviews it. */
export const HIDE_AT = 3;
/** Your own lists of hidden posts and muted people, newest kept. */
export const HIDDEN_MAX = 200;
export const MUTED_MAX = 200;
/** An account posts from its second day (firestore.rules: its profile's createdAt plus a day). */
export const ACCOUNT_AGE_MS = 864e5;
const DAY = 864e5;

export interface Post {
  id: string; uid: string;
  /** The author's display name when they posted (their @username itself when they had none). */ name: string;
  /** Their @username when they posted. */ user: string;
  t: string; /** The server's time (ms). */ at: number;
  reports: number; likes: number;
  /** How many of its reports the owner has reviewed and kept it through. */ kept?: number;
}

/** A post as read: only one in shape, so nothing written round the app breaks a screen. */
export function postOf(id: string, d: Record<string, unknown> | undefined, at: number | undefined): Post | null {
  if (!d || at == null) return null;
  const { uid, name, user, t, reports, likes, kept } = d;
  if (typeof uid !== 'string' || typeof user !== 'string' || typeof t !== 'string' || !t) return null;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  return {
    id, uid, user, name: typeof name === 'string' && name ? name : user, t, at, reports: n(reports), likes: n(likes),
    ...(typeof kept === 'number' && kept > 0 && { kept: n(kept) }),
  };
}

/** The display name to lead with, when there's one: none when the post's name is the @username itself. */
export const leadOf = (p: Pick<Post, 'name' | 'user'>) => (p.name && p.name !== p.user ? p.name : undefined);

// ---- Writing ----

/** Invisible and direction-flipping characters: dropped as typed, so nothing in a post hides or reorders what's around it. */
const INVISIBLE = /[­؜​‎‏‪-‮⁠-⁤⁦-⁩﻿]/gu;
/** A link (firestore.rules refuses the same two). */
const LINK = /:\/\/|www\./i;

/** As posted: composed (NFC), invisible characters gone, no space at line ends, at most one blank line in a row, trimmed. */
export function cleanPost(s: string): string {
  return s.normalize('NFC').replace(INVISIBLE, '').replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Why a cleaned post can't go, in the composer's words; null when it can. */
export function postError(clean: string): string | null {
  if (!clean) return 'Write something first.';
  if (clean.length > MAX_POST) return `Too long: ${MAX_POST} characters at most (an emoji counts as two).`;
  if (LINK.test(clean)) return 'No links: the board takes words only.';
  return null;
}

/**
 * Personal details in what's typed: the composer warns, and still lets it go (the person may mean it: "my PR is 1,000,000 lbs").
 * A phone number, an email address, or a street address. Never stored, never sent anywhere.
 */
export function personalWarning(s: string): string | null {
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(s)) return 'That looks like an email address. Everyone on the board will see it.';
  // Weights, reps and dates aren't phone numbers: "100 kg", "5 reps", "2026-10-22" are taken out first.
  const numbers = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\b\d{1,4}\s*(?:kg|lbs?|x|×|reps?|sets?)\b/gi, ' ');
  if (/(?:\+?\d[\s().-]*){7,}/.test(numbers)) return 'That looks like a phone number. Everyone on the board will see it.';
  if (/\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Blvd|Boulevard|Dr|Drive|Way|Ct|Court)\b/.test(s)) return 'That looks like a street address. Everyone on the board will see it.';
  return null;
}

/** A counter of yours as firestore.rules keep it: when the last went (ms), when its day began, how many in that day. */
export interface Rate { at: number; win: number; n: number }
/**
 * When you may next post, by this phone's clock: null for now; else when, and why (60 s since the last; 5 in the day that began
 * with the first). The server's clock has the last word: the rules decide.
 */
export function nextPostAt(r: Rate | null, now: number): { at: number; why: 'gap' | 'day' } | null {
  if (!r) return null;
  const newDay = now >= r.win + DAY;
  if (!newDay && r.n >= POSTS_A_DAY) return { at: r.win + DAY, why: 'day' };
  if (now <= r.at + POST_GAP_MS) return { at: r.at + POST_GAP_MS + 1000, why: 'gap' };
  return null;
}
/** The counter to write with a post or report: on in its day, or a new day from 1. `flip`: judge the day the other way (a refusal near its edge). */
export function rateNext(r: Rate | null, now: number, flip = false): { keep: boolean; n: number } {
  if (!r) return { keep: false, n: 1 };
  const newDay = (now >= r.win + DAY) !== flip;
  return newDay ? { keep: false, n: 1 } : { keep: true, n: r.n + 1 };
}

// ---- Reading ----

/** Hidden for everyone (but its author and the owner) until reviewed: HIDE_AT reports since the owner last kept it. */
export const heldByReports = (p: Pick<Post, 'reports' | 'kept'>) => p.reports - (p.kept ?? 0) >= HIDE_AT;

/** What a viewer has set aside: posts hidden, people muted on the board, people blocked (their Friends block list). */
export interface Filters { me: string; hidden: ReadonlySet<string>; muted: ReadonlySet<string>; blocked: ReadonlySet<string>; owner?: boolean }
/** A row of the board: a post, or the line a post held by reports leaves ("Hidden after reports, waiting for review"). */
export type Row = { kind: 'post'; post: Post; held?: boolean } | { kind: 'held'; id: string };
/**
 * The rows a viewer sees, newest first: nothing over 30 days old, nothing they hid, nobody they muted or blocked. A post held by
 * reports is a line for others; its author still sees it (marked), and so does the owner.
 */
export function rowsOf(posts: readonly Post[], f: Filters, now: number): Row[] {
  const out: Row[] = [];
  for (const p of [...posts].sort((a, b) => b.at - a.at)) {
    if (p.at <= now - POST_DAYS_MS || f.hidden.has(p.id)) continue;
    if (p.uid !== f.me && (f.muted.has(p.uid) || f.blocked.has(p.uid))) continue;
    const held = heldByReports(p);
    if (held && p.uid !== f.me && !f.owner) out.push({ kind: 'held', id: p.id });
    else out.push({ kind: 'post', post: p, ...(held && { held: true }) });
  }
  return out;
}
/** How many posts a viewer would actually read of these. */
export const shownCount = (posts: readonly Post[], f: Filters, now: number) => rowsOf(posts, f, now).filter((r) => r.kind === 'post').length;

/** Posts kept, with newer ones read since: by id, the newer read winning, newest first. */
export function mergePosts(kept: readonly Post[], read: readonly Post[]): Post[] {
  const byId = new Map(kept.map((p) => [p.id, p]));
  for (const p of read) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

/** A post's age, rounded so it never says when someone trains: "now", "38m", "2h", then the date alone ("Oct 20"). */
export function postAgo(at: number, now: number): string {
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** An email as the gate shows it: the first letter and the domain ("j•••@example.com"). */
export function maskEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim();
  const at = e.lastIndexOf('@');
  if (at < 1) return 'your email';
  return `${[...e][0]}•••${e.slice(at)}`;
}

// ---- The gate ----

export interface GateFacts {
  /** Your @username; null: none chosen yet. */ username: string | null;
  emailVerified: boolean;
  /** You accepted "16 or older, and the board's rules" (private/board ok). */ accepted: boolean;
  /** Your profile's createdAt (ms); undefined: none yet (it's written on the next open). */ createdAt?: number;
  banned: boolean;
}
export type GateStep = 'banned' | 'username' | 'email' | 'accept' | 'age';
/** What still stands between you and a post, in the order the gate shows it; [] when you can post. */
export function gateSteps(g: GateFacts, now: number): GateStep[] {
  if (g.banned) return ['banned'];
  const out: GateStep[] = [];
  if (!g.username) out.push('username');
  if (!g.emailVerified) out.push('email');
  if (!g.accepted) out.push('accept');
  if (g.createdAt == null || now <= g.createdAt + ACCOUNT_AGE_MS) out.push('age');
  return out;
}
/** When an account a day old may post (by its createdAt); null without one. */
export const postsFrom = (createdAt: number | undefined) => (createdAt == null ? null : createdAt + ACCOUNT_AGE_MS + 1000);

// ---- Words (the content rules wait on the owner's approval before the board ships: plan §7) ----

export const AGE_FLOOR = 16;
/** The board's rules, shown once at the gate and linked from the report sheet. */
export const CONTENT_RULES: readonly string[] = [
  'Be decent. No harassment, threats, hate or pile-ons.',
  'No selling. No ads, promo codes or links.',
  'Keep other people out of it: nobody else’s name, address, number or photo.',
  'No dangerous advice: nothing about steroids, PEDs or other drugs, and no training through an injury.',
  'Nothing sexual, and nothing involving a minor. The board is 16+.',
];
export const RULES_FOOTER = 'Posts that break these are removed; repeat breakers are banned. The app’s owner decides.';

/** Why someone reports a post (firestore.rules allows exactly these keys). `short`: the owner's tally. */
export const REASONS = [
  { key: 'harass', label: 'Harassment or hate', short: 'Harassment' },
  { key: 'spam', label: 'Spam or selling', short: 'Spam or selling' },
  { key: 'personal', label: 'Someone’s personal details', short: 'Personal details' },
  { key: 'sexual', label: 'Sexual content, or a minor at risk', short: 'Sexual or a minor' },
  { key: 'danger', label: 'Dangerous advice (drugs, injury)', short: 'Dangerous advice' },
  { key: 'other', label: 'Something else', short: 'Something else' },
] as const;
export type Reason = (typeof REASONS)[number]['key'];
export const isReason = (k: unknown): k is Reason => REASONS.some((r) => r.key === k);

/** The owner's review: each reported post with its reasons tallied, the most urgent first (a minor at risk, then held, then most reported). */
export interface Review { post: Post; why: Partial<Record<Reason, number>> }
export function reviewOrder(items: readonly Review[]): Review[] {
  const open = items.filter((r) => r.post.reports > (r.post.kept ?? 0));
  const rank = (r: Review) => [r.why.sexual ? 0 : 1, heldByReports(r.post) ? 0 : 1, -(r.post.reports - (r.post.kept ?? 0)), -r.post.at];
  return open.sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}
/** "Spam or selling ×2 · Dangerous advice ×1" */
export const tally = (why: Review['why']) => REASONS.filter((r) => why[r.key]).map((r) => `${r.short} ×${why[r.key]}`).join(' · ');

/** A list of yours (hidden posts, muted people) with one added at the end, or taken out; at most `max`, the oldest dropped. */
export function toggleIn(list: readonly string[], id: string, on: boolean, max: number): string[] {
  const rest = list.filter((x) => x !== id);
  return on ? [...rest, id].slice(-max) : rest;
}
