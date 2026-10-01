import type { Flag, Region } from './types';

// Reads a free-text workout log as typed in a notes app. Generic rules only: personal name mappings live on the device.

export interface NoteSet { weight: number; reps: number | null; flags: Flag[]; note?: string; rir?: number; painRegion?: Region }

// weight×reps[×sets]: "-" = assisted, "bw" = bodyweight, "45s" = a pair of 45s, "40s" after reps = seconds, "?" = unsure.
const SET_RE = /(?<![\w.:])(-)?(bw|\d+(?:\.\d+)?)(s)?\s*[x×*]\s*(\d+)?(s)?(?:\s*[x×*]\s*(\d+)(?!\s*s\b))?(\?)?(?![\w.])/gi;
// Hold exercises also take a bare duration: "45s", "30 sec", "1:05".
const HOLD_RE = /(?<![\w.:])(?:(\d+)\s*(?:s|secs?|seconds)\b|(\d+):([0-5]\d)(?!\d))/gi;

const PAIN_RE = /\b(pain|painful|hurt|hurts|hurting|discomfort|elbow)\b/i;
const UNSURE_RE = /\b(unsure|idk|not sure)\b/i;
const WARMUP_RE = /\(?\b(?:wu|warm[- ]?ups?)\b\)?/gi;
const RIR_RE = /(\d)\s*(?:-\s*\d\s*)?rir\b|\brir\s*(\d)|@\s*(\d)(?!\d)/i;
// Most specific first: "lower back" before a bare "back".
const REGION_RES: [RegExp, Region][] = [
  [/\belbows?\b/i, 'elbow'], [/\b(lower back|back|spine|lumbar)\b/i, 'lower back'],
  [/\bshoulders?\b/i, 'shoulder'], [/\bwrists?\b/i, 'wrist'], [/\bknees?\b/i, 'knee'],
];

const tidy = (s: string) => s.replace(/^[\s,;.&]+|[\s,;.&]+$/g, '').replace(/^and\b\s*|\s*\band$/gi, '').trim();

interface Token { start: number; end: number; sets: NoteSet[] }

function tokens(text: string, hold: boolean): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(SET_RE)) {
    const [, minus, w, , repsRaw, secs, count, unsure] = m;
    const assisted = !!minus;
    const weight = assisted || /^bw$/i.test(w) ? 0 : Number(w);
    const reps = repsRaw ? Number(repsRaw) : null;
    const flags: Flag[] = [];
    if (hold || secs) flags.push('hold');
    if (weight === 0) flags.push('bodyweight');
    if (reps == null) flags.push('partial');
    if (unsure) flags.push('unsure');
    const one = (): NoteSet => ({ weight, reps, flags: [...flags], ...(assisted && { note: `assisted -${w} lb` }) });
    out.push({ start: m.index, end: m.index + m[0].length, sets: Array.from({ length: count ? Math.max(1, Number(count)) : 1 }, one) });
  }
  if (hold) {
    for (const m of text.matchAll(HOLD_RE)) {
      if (out.some((t) => m.index < t.end && m.index + m[0].length > t.start)) continue;
      const secs = m[1] ? Number(m[1]) : Number(m[2]) * 60 + Number(m[3]);
      out.push({ start: m.index, end: m.index + m[0].length, sets: [{ weight: 0, reps: secs, flags: ['hold', 'bodyweight'] }] });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Flags, RIR and pain region a note implies; returns the note with warm-up markers removed. */
function applyNote(s: NoteSet, raw: string): void {
  if (!raw) return;
  let note = raw;
  if (note.search(WARMUP_RE) >= 0) { if (!s.flags.includes('warmup')) s.flags.push('warmup'); note = tidy(note.replace(WARMUP_RE, ' ').replace(/\s+/g, ' ')); }
  const rir = RIR_RE.exec(note);
  if (rir && s.rir == null) s.rir = Number(rir[1] ?? rir[2] ?? rir[3]);
  if (PAIN_RE.test(note) && !s.flags.includes('pain')) {
    s.flags.push('pain');
    const region = REGION_RES.find(([re]) => re.test(note))?.[1];
    if (region) s.painRegion = region;
  }
  if (UNSURE_RE.test(note) && !s.flags.includes('unsure')) s.flags.push('unsure');
  if (note) s.note = s.note ? `${s.note}; ${note}` : note;
}

/** The sets in one line's text after the exercise name. Text before the first set goes to it; text after a set, to that set. */
export function readSets(text: string, hold: boolean): { lead: string; sets: NoteSet[] } {
  const ts = tokens(text, hold);
  if (!ts.length) return { lead: tidy(text), sets: [] };
  const lead = tidy(text.slice(0, ts[0].start));
  const sets: NoteSet[] = [];
  ts.forEach((t, i) => {
    const after = tidy(text.slice(t.end, ts[i + 1]?.start ?? text.length));
    if (i === 0) applyNote(t.sets[0], lead);
    const last = t.sets.at(-1)!;
    applyNote(last, after);
    sets.push(...t.sets);
  });
  return { lead, sets };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAY = String.raw`(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?`;
const NUMERIC = new RegExp(String.raw`^${WEEKDAY}(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?)(?![\d/x×*.])`, 'i');
const MONTH_FIRST = new RegExp(String.raw`^${WEEKDAY}(${MONTHS.join('|')})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`, 'i');
const DAY_FIRST = new RegExp(String.raw`^${WEEKDAY}(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTHS.join('|')})[a-z]*\.?(?:,?\s+(\d{4}))?(?![\w])`, 'i');

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A date at the start of a line, and the text after it. A date without a year is never in the future. */
export function parseNoteDate(text: string, today: string): { date: string; rest: string } | null {
  const t = text.trim();
  let y: number | undefined, mo: number, d: number, len: number;
  let m = NUMERIC.exec(t);
  if (m) {
    len = m[0].length;
    if (m[1]) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
    else { mo = Number(m[4]); d = Number(m[5]); if (m[6]) y = m[6].length === 2 ? 2000 + Number(m[6]) : Number(m[6]); }
  } else if ((m = MONTH_FIRST.exec(t))) {
    len = m[0].length; mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; d = Number(m[2]); if (m[3]) y = Number(m[3]);
  } else if ((m = DAY_FIRST.exec(t))) {
    len = m[0].length; d = Number(m[1]); mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; if (m[3]) y = Number(m[3]);
  } else return null;
  let date: string | null;
  if (y === undefined) {
    const ty = Number(today.slice(0, 4));
    date = validDate(ty, mo, d);
    if (date && date > today) date = validDate(ty - 1, mo, d);
    // Feb 29 that only exists this year, in the future: no valid past date.
  } else date = validDate(y, mo, d);
  if (!date) return null;
  return { date, rest: t.slice(len).replace(/^[\s:,\-–—]+/, '').trim() };
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
