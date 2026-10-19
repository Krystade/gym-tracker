import { nameKey } from './ids';
import { LIFTS, resolveLift, words, type Lift } from './lifts';

// Finding a lift by name (round 15): one search for the picker, the Lifts tab and the gym's list. Names and other names (aka),
// words in any order, each typed word the start of a word in the name: "inc db pr" finds Incline DB Press.

/** A name's words as search sees them: folded (nameKey), and spelled as the movements are (words). */
const wordsOf = (name: string): string[] => [...new Set([...nameKey(name).split(' '), ...words(name)].filter(Boolean))];
const TEXTS = new Map<Lift, string[][]>(LIFTS.map((l) => [l, [l.name, ...(l.aka ?? [])].map(wordsOf)]));

/** The typed words: lower case, split on punctuation, the common spellings folded ("dumbbell" is db); never a plural fold, since a word may be half typed. */
function typed(query: string): string[][] {
  return query.toLowerCase().replace(/[’'`]/g, '').split(/[\s\-–—/()_,.&+]+/).filter(Boolean).map((t) => [...new Set([t, nameKey(t)])]);
}
/** Whether every typed word starts some word of the name (any order); `first`: whether the first typed word starts its first word. */
function match(ws: string[], q: string[][]): { ok: boolean; first: boolean } {
  const starts = (w: string, t: string[]) => t.some((x) => w.startsWith(x));
  return { ok: q.every((t) => ws.some((w) => starts(w, t))), first: !!ws[0] && starts(ws[0], q[0]) };
}

/** Catalog lifts a logged name stands for: the same name, or one of its other names. */
function standsFor(logged: string[]): Set<Lift> {
  const out = new Set<Lift>();
  for (const n of logged) {
    const r = resolveLift(n);
    if (r.lift && (r.how === 'catalog' || r.how === 'alias')) out.add(r.lift);
  }
  return out;
}

/** Before any search: the logged lifts, then the common ones his names don't already stand for. */
export function liftsBeforeSearch(logged: string[]): string[] {
  const own = standsFor(logged);
  return [...logged, ...LIFTS.filter((l) => l.common && !own.has(l)).map((l) => l.name)];
}

/**
 * Logged names and catalog lifts matching the query, best first: logged, then those whose name (or other name) starts with the
 * first typed word, then common lifts, then the rest; the table's order within each. A catalog lift a logged name stands for
 * is left out: his name is the one he uses.
 */
export function searchLifts(query: string, logged: string[]): string[] {
  const q = typed(query);
  if (!q.length) return liftsBeforeSearch(logged);
  // Also as the movements spell it, so "skull crusher" finds Skullcrusher and "hex bar" the trap bar.
  const q2 = words(query).map((w) => [w]);
  const test = (ws: string[]) => { const a = match(ws, q), b = q2.length ? match(ws, q2) : { ok: false, first: false }; return { ok: a.ok || b.ok, first: (a.ok && a.first) || (b.ok && b.first) }; };
  const own = standsFor(logged);
  const ranked: [string, number][] = [];
  for (const n of logged) if (test(wordsOf(n)).ok) ranked.push([n, 0]);
  for (const l of LIFTS) {
    if (own.has(l)) continue;
    const ms = TEXTS.get(l)!.map(test).filter((m) => m.ok);
    if (!ms.length) continue;
    ranked.push([l.name, ms.some((m) => m.first) ? 1 : l.common ? 2 : 3]);
  }
  // Stable: the table's order within a rank.
  return ranked.sort((a, b) => a[1] - b[1]).map(([n]) => n);
}
