import { normalizeName, setId } from './ids';
import { isFlag, isRegion, type Flag, type SetEntry } from './types';

export const CSV_HEADER = ['date', 'exercise', 'as_written', 'set', 'weight_lb', 'reps', 'rir', 'flags', 'note', 'source', 'pain_region', 'pain_severity'] as const;
const REQUIRED = ['date', 'exercise', 'set', 'weight_lb', 'reps'];

export interface CsvError { row: number; message: string }

export const compareEntries = (a: SetEntry, b: SetEntry): number =>
  a.date.localeCompare(b.date) || a.seq - b.seq || a.setNo - b.setNo;

const esc = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(entries: SetEntry[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const e of [...entries].sort(compareEntries)) {
    lines.push(
      [e.date, e.exercise, e.asWritten ?? '', String(e.setNo), String(e.weight), e.reps == null ? '' : String(e.reps),
        e.rir == null ? '' : String(e.rir), e.flags.join(';'), e.note ?? '', e.source, e.painRegion ?? '', e.painSeverity == null ? '' : String(e.painSeverity)].map(esc).join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** RFC 4180 rows; quoted fields may contain commas, quotes ("") and newlines. */
export function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export function parseCsv(text: string, defaultSource = 'import'): { entries: SetEntry[]; errors: CsvError[] } {
  const rows = parseRows(text.replace(/^﻿/, ''));
  const errors: CsvError[] = [];
  const entries: SetEntry[] = [];
  if (rows.length === 0) return { entries, errors: [{ row: 1, message: 'Empty file' }] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) return { entries, errors: [{ row: 1, message: `Missing columns: ${missing.join(', ')}` }] };
  const col = (r: string[], name: string) => { const i = header.indexOf(name); return i < 0 ? '' : (r[i] ?? ''); };

  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    if (r.every((f) => f.trim() === '')) return;
    const fail = (message: string) => { errors.push({ row: rowNo, message }); };
    const date = col(r, 'date').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(`Bad date "${date}" (want YYYY-MM-DD)`);
    const exercise = normalizeName(col(r, 'exercise'));
    if (!exercise) return fail('Missing exercise');
    const setNo = num(col(r, 'set'));
    if (setNo == null || !Number.isInteger(setNo) || setNo < 1) return fail(`Bad set number "${col(r, 'set')}"`);
    const weight = num(col(r, 'weight_lb'));
    if (weight == null || weight < 0) return fail(`Bad weight "${col(r, 'weight_lb')}"`);
    const repsRaw = col(r, 'reps');
    const reps = repsRaw.trim() === '' ? null : num(repsRaw);
    if (repsRaw.trim() !== '' && (reps == null || !Number.isInteger(reps) || reps < 0)) return fail(`Bad reps "${repsRaw}"`);
    const rirRaw = col(r, 'rir');
    const rir = rirRaw.trim() === '' ? undefined : num(rirRaw);
    if (rir === null || (rir !== undefined && (rir < 0 || rir > 10))) return fail(`Bad RIR "${rirRaw}"`);
    const flagParts = col(r, 'flags').split(';').map((f) => f.trim()).filter(Boolean);
    const bad = flagParts.filter((f) => !isFlag(f));
    if (bad.length) return fail(`Unknown flag "${bad.join(';')}"`);
    const regionRaw = col(r, 'pain_region').trim().toLowerCase();
    if (regionRaw && !isRegion(regionRaw)) return fail(`Unknown pain region "${regionRaw}"`);
    const sevRaw = col(r, 'pain_severity').trim();
    const sev = sevRaw === '' ? undefined : Number(sevRaw);
    if (sev !== undefined && !(sev === 1 || sev === 2 || sev === 3)) return fail(`Pain severity must be 1-3, got "${sevRaw}"`);
    const source = col(r, 'source').trim() || defaultSource;
    const asWritten = col(r, 'as_written');
    const note = col(r, 'note');
    entries.push({
      id: setId(source, date, exercise, setNo),
      date, seq: i, exercise, setNo, weight, reps, source,
      flags: flagParts as Flag[],
      ...(rir !== undefined && { rir }),
      ...(asWritten !== '' && { asWritten }),
      ...(note !== '' && { note }),
      ...(regionRaw && isRegion(regionRaw) && { painRegion: regionRaw }),
      ...(sev !== undefined && { painSeverity: sev as 1 | 2 | 3 }),
    });
  });
  return { entries, errors };
}
