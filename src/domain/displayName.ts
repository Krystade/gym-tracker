// A display name (social S1, owner 2026-10-22): free text shown beside the @username, never instead of it. The @username is who
// someone is (unique, how they're found); the display name is what they'd like to be called ("Jack S."); your private tag for a
// friend wins over it, for you alone. Wherever a person shows: tag, else display name, else @username in bold, and the @username
// beside it in grey (ui/FriendName). firestore.rules (dnOk) keeps the same characters out; a test checks the two agree.
// Plain TypeScript, no DOM: the push Worker and the service worker use it too.

/** Its most characters, as a person counts them (an emoji, however it's built, is one). */
export const MAX_DISPLAY = 30;
/** Its most UTF-16 units, as firestore.rules counts them (an emoji is two or more). */
export const MAX_DISPLAY_UNITS = 60;
/** How often it may change: once a day, by the server's clock (firestore.rules holds the same). */
export const NAME_GAP_MS = 864e5;

/**
 * Never in one (firestore.rules dnOk refuses the same class): @; controls (C0, DEL, C1); the soft hyphen, the Arabic letter mark,
 * the zero-width space, direction marks and overrides, line and paragraph separators, the word joiner and invisible operators,
 * isolates and the byte-order mark; and what's drawn like the ✓ (✓ ✔ ☑ ✅ 🗸 √ 🔵 ® ™, so ✔️ and ☑️ too). Joiners (U+200C,
 * U+200D) are allowed: 🏋️‍♀️ and some scripts are built with them.
 */
export const BANNED = /[@\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ae\u2122\u221a\u2611\u2705\u2713\u2714\u{1f535}\u{1f5f8}]/u;
/** Drawn like the ✓: a name can't wear a fake one. */
const CHECKS = /[\u00ae\u2122\u221a\u2611\u2705\u2713\u2714\u{1f535}\u{1f5f8}]/u;
/** A link (firestore.rules: the same two). */
const LINK = /:\/\/|www\./i;
/** Invisible: dropped as typed or pasted, so a name never fails over something nobody can see. */
const INVISIBLE = /[\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;
/**
 * Words that read as the app itself speaking, as whole words in any case (plan §1). Checked here only, as typed: the rules can't
 * afford a word list, and anyone who goes round the app is the owner's to remove.
 */
const RESERVED = /(?<![\p{L}\p{N}])(?:admin|moderator|mod|official|owner|support|staff|verified|gym\s*tracker)s?(?![\p{L}\p{N}])/iu;

const graphemes = (s: string) =>
  typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s];
/** Its length as a person counts it. */
export const displayLength = (s: string) => graphemes(s).length;

/** As kept: composed (NFC), invisible characters dropped, one line, single spaces, trimmed; '' for none. */
export function cleanDisplayName(s: string): string {
  return s.normalize('NFC').replace(INVISIBLE, '').replace(/[\s\p{Cc}]+/gu, ' ').trim();
}

/** Why a cleaned name can't be kept, in a line the form shows; null when it can. '' (none) always can. */
export function displayNameError(clean: string): string | null {
  if (!clean) return null;
  if (displayLength(clean) > MAX_DISPLAY || clean.length > MAX_DISPLAY_UNITS) return `Too long: ${MAX_DISPLAY} characters at most, fewer with emoji.`;
  if (clean.includes('@')) return 'No @: your @username already shows beside it.';
  if (CHECKS.test(clean)) return 'No ✓ or anything like it: the real one comes from the app’s owner.';
  if (LINK.test(clean)) return 'No links.';
  if (RESERVED.test(clean)) return 'Not a word the app itself would use, like admin, official or support.';
  if (BANNED.test(clean)) return 'One of those characters can’t be used.';
  return null;
}

/**
 * Someone's display name as shown, from their profile: none (null) for the old shape (the username itself), one that's no longer
 * clean, or one the rules would refuse, so nothing past the app's checks shows (a profile written round the app included).
 */
export function displayOf(username: string, displayName: unknown): string | null {
  if (typeof displayName !== 'string' || displayName === username) return null;
  return cleanDisplayName(displayName) === displayName && !displayNameError(displayName) ? displayName : null;
}

/** When the display name may change again; null: now. */
export function nextNameAt(nameAt: number | undefined, now: number): number | null {
  return nameAt != null && now < nameAt + NAME_GAP_MS ? nameAt + NAME_GAP_MS : null;
}
