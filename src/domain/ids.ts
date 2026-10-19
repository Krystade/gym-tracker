export const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ');

// Lift names are compared on every set of every whole-log scan, so each distinct string's key is worked out once. The log
// holds a few dozen names; the cap only bounds what typing into a search adds.
const KEYS = new Map<string, string>();
const MAX_KEYS = 2000;
/** A lift's identity: "Bench  Press" and "bench press" are one lift. normalizeName, lower-cased. */
export function liftKey(name: string): string {
  let k = KEYS.get(name);
  if (k === undefined) {
    k = normalizeName(name).toLowerCase();
    if (KEYS.size >= MAX_KEYS) KEYS.clear();
    KEYS.set(name, k);
  }
  return k;
}

export const setId = (source: string, date: string, exercise: string, setNo: number): string =>
  `${source}|${date}|${liftKey(exercise)}|${setNo}`;

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const SYNONYMS: Record<string, string> = {
  dumbell: 'db', dumbbell: 'db', dbs: 'db', tricep: 'triceps', bicep: 'biceps', calve: 'calf', ext: 'extension', bb: 'barbell',
};

/** A folded form of an exercise name: case, punctuation, plurals and common spellings don't matter. */
export function nameKey(name: string): string {
  const s = name.toLowerCase().replace(/[’'`]/g, '').replace(/[-–—/()_,.&+]/g, ' ')
    .replace(/\b(push|pull|chin|sit)\s+(ups?|downs?)\b/g, '$1$2');
  return s.split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .map((w) => SYNONYMS[w] ?? w)
    .join(' ');
}

/** Word overlap (Jaccard) of two names after folding. */
export function nameSimilarity(a: string, b: string): number {
  const A = new Set(nameKey(a).split(' ')), B = new Set(nameKey(b).split(' '));
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both || 1);
}
