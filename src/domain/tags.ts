import type { Flag } from './types';

/** The built-in tags. Each sets a flag that means something (a warm-up isn't a working set, Pain opens the pain fields). */
export const BUILT_IN: [Flag, string][] = [['pain', 'Pain'], ['unsure', 'Unsure'], ['warmup', 'Warm-up'], ['double_pulley', '2× pulley'], ['test', 'Test']];

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
const builtIn = (t: string) => BUILT_IN.find(([, l]) => same(l, t));

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
