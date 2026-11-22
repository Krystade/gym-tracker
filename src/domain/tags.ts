import type { Flag, SetEntry } from './types';

/**
 * The built-in tags. Each sets a flag that means something (a warm-up isn't a working set, Pain opens the pain fields). The four
 * set-quality tags (owner, 2026-11-21) each move the model a little, and never a set's volume or points:
 * - Form fail: half weight as a strength reading (learn/capacity FORM_FAIL_WEIGHT);
 * - Extra good form: read as half a rep harder (learn/capacity GOOD_FORM_REPS);
 * - Full stack: no more weight on that lift at that gym while its last session was at the stack's top (progression);
 * - No spot: never read as lower strength (learn/capacity reads it as a lower bound; a plateau doesn't count its session).
 */
export const BUILT_IN: [Flag, string][] = [['pain', 'Pain'], ['unsure', 'Unsure'], ['warmup', 'Warm-up'], ['double_pulley', '2× pulley'], ['test', 'Test'],
  ['form_fail', 'Form fail'], ['good_form', 'Extra good form'], ['full_stack', 'Full stack'], ['no_spot', 'No spot']];

/**
 * A tag of their own that a built-in now is (owner, 2026-11-21: Form fail, Extra good form, Full stack, No spot): the name in any
 * case, spacing or hyphens, and the obvious short forms. Read, never written back: an own tag of that name becomes the built-in
 * wherever it is shown or counted (`asBuiltIns` on the log as read, `withBuiltIns` on the tag row), on every phone, whatever build
 * wrote it.
 */
const ALIASES: Record<string, Flag> = {
  formfail: 'form_fail', formfailure: 'form_fail', extragoodform: 'good_form', goodform: 'good_form',
  fullstack: 'full_stack', stackmaxed: 'full_stack', nospot: 'no_spot', nospotter: 'no_spot',
};
const squash = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
/** The built-in a tag of their own names, if it names one of the four. */
export const builtInFor = (tag: string): Flag | undefined => ALIASES[squash(tag)];

/** A set with any of its own tags that are now built-ins moved onto their flags; the same object when there are none. */
export function asBuiltIns(e: SetEntry): SetEntry {
  if (!e.tags?.length || !e.tags.some((t) => builtInFor(t))) return e;
  const flags = [...e.flags];
  for (const t of e.tags) { const f = builtInFor(t); if (f && !flags.includes(f)) flags.push(f); }
  const tags = e.tags.filter((t) => !builtInFor(t));
  const { tags: _old, ...rest } = e;
  return { ...rest, flags, ...(tags.length && { tags }) };
}

/** The tag row with any own tag that is now a built-in taken off it (the built-in shows in its place). */
export function withBuiltIns(p: TagPrefs): TagPrefs {
  if (!p.custom.some((c) => builtInFor(c))) return p;
  return { ...p, custom: p.custom.filter((c) => !builtInFor(c)) };
}

/**
 * The tag row as a person keeps it: built-ins hidden from it, and their own tags in the order added. Per profile, synced.
 * Hiding a built-in hides only its chip; their own tags are plain labels on a set, and nothing counts them.
 */
export interface TagPrefs { key: 'tags'; hidden: Flag[]; custom: string[] }
export const defaultTags = (): TagPrefs => ({ key: 'tags', hidden: [], custom: [] });

export const TAG_MAX = 24;
/** A tag as typed, tidied: one line, single spaces, no `;` (the CSV's separator), at most TAG_MAX characters. */
export const cleanTag = (s: string): string => s.replace(/;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX).trim();
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const builtIn = (t: string) => BUILT_IN.find(([f, l]) => same(l, t) || builtInFor(t) === f);

/** Already on the row: a shown built-in or one of their own, whatever the case. */
export function hasTag(p: TagPrefs, raw: string): boolean {
  const t = cleanTag(raw), b = builtIn(t);
  return b ? !p.hidden.includes(b[0]) : p.custom.some((c) => same(c, t));
}

/** A built-in's name shows that built-in again; a tag already there changes nothing. */
export function addTag(p: TagPrefs, raw: string): TagPrefs {
  const t = cleanTag(raw);
  if (!t || hasTag(p, t)) return p;
  const b = builtIn(t);
  return b ? { ...p, hidden: p.hidden.filter((f) => f !== b[0]) } : { ...p, custom: [...p.custom, t] };
}
export const removeTag = (p: TagPrefs, t: string): TagPrefs => ({ ...p, custom: p.custom.filter((c) => c !== t) });
export const showTag = (p: TagPrefs, f: Flag, shown: boolean): TagPrefs =>
  ({ ...p, hidden: shown ? p.hidden.filter((x) => x !== f) : [...new Set([...p.hidden, f])] });

/** A set's tags from a CSV cell: tidied, without blanks or repeats. */
export function parseTags(cell: string): string[] {
  const out: string[] = [];
  for (const t of cell.split(';').map(cleanTag)) if (t && !out.some((x) => same(x, t))) out.push(t);
  return out;
}
