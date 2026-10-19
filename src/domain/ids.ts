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
