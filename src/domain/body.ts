import { addDays } from './analytics';
import { parseRows, type CsvError } from './csv';

export const BODY_FIELDS = ['weight', 'calories', 'protein', 'energy'] as const;
export type BodyField = (typeof BODY_FIELDS)[number];
/**
 * `energy`: how the day's training felt going in, 1 (flat) to 5 (great). `at`: when each field was last entered by hand (epoch ms),
 * so two phones that both changed one keep the newer; a field from before round 10 has none.
 */
export interface BodyDay { date: string; weight?: number; calories?: number; protein?: number; energy?: 1 | 2 | 3 | 4 | 5; at?: Partial<Record<BodyField, number>> }
export type CsvKind = 'sets' | 'body' | 'mfp-weight' | 'mfp-nutrition' | 'unknown';
/** `edited_at`: each field's edit time, as `weight=<ISO time>;energy=<ISO time>`. */
export const BODY_HEADER = ['date', 'weight_lb', 'calories', 'protein_g', 'energy', 'edited_at'] as const;

const headerOf = (text: string): string[] => (parseRows(text.replace(/^﻿/, ''))[0] ?? []).map((h) => h.trim().toLowerCase());

/** Which file this is, from its header alone; column order and extra columns don't matter. */
export function detectCsv(text: string): CsvKind {
  const h = headerOf(text);
  if (!h.includes('date')) return 'unknown';
  if (h.includes('exercise')) return 'sets';
  if (h.includes('weight_lb') || h.includes('protein_g')) return 'body';
  if (h.includes('meal') && h.includes('calories')) return 'mfp-nutrition';
  if (h.includes('weight')) return 'mfp-weight';
  return 'unknown';
}

/** ISO dates as-is; US M/D/YYYY converted. Either way the day must exist (no Feb 30, no month 13). */
function isoDate(s: string): string | null {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const [y, mo, d] = iso ? [iso[1], iso[2], iso[3]].map(Number) : us ? [us[3], us[1], us[2]].map(Number) : [];
  if (y === undefined) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Same bounds as a typed weigh-in, so one stray 0 can't drag the trend. */
export const WEIGHT_RANGE = [50, 700] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function parseBodyFile(text: string): { kind: CsvKind; days: BodyDay[]; errors: CsvError[] } {
  const kind = detectCsv(text);
  const rows = parseRows(text.replace(/^﻿/, ''));
  const h = headerOf(text);
  const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const cols: Partial<Record<'weight' | 'calories' | 'protein' | 'energy', number>> =
    kind === 'body' ? { weight: col('weight_lb'), calories: col('calories'), protein: col('protein_g'), energy: col('energy') }
    : kind === 'mfp-weight' ? { weight: col('weight') }
    : kind === 'mfp-nutrition' ? { calories: col('calories'), protein: col('protein (g)', 'protein') }
    : {};
  const di = col('date'), ei = kind === 'body' ? col('edited_at') : -1;
  const errors: CsvError[] = [];
  const by = new Map<string, BodyDay>();
  if (kind === 'unknown' || kind === 'sets') return { kind, days: [], errors };
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    if (r.every((c) => c.trim() === '')) return;
    const date = isoDate(r[di] ?? '');
    if (!date) { errors.push({ row, message: `Bad date "${r[di] ?? ''}"` }); return; }
    const vals: Partial<Record<'weight' | 'calories' | 'protein' | 'energy', number>> = {};
    for (const [k, c] of Object.entries(cols) as ['weight' | 'calories' | 'protein' | 'energy', number][]) {
      const v = (r[c] ?? '').trim();
      if (c < 0 || v === '') continue;
      const n = Number(v.replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) { errors.push({ row, message: `Bad ${k} "${v}"` }); return; }
      if (k === 'energy' && !(Number.isInteger(n) && n >= 1 && n <= 5)) { errors.push({ row, message: `Bad energy "${v}" (want 1–5)` }); return; }
      if (k === 'weight' && (n < WEIGHT_RANGE[0] || n > WEIGHT_RANGE[1])) { errors.push({ row, message: `Weight ${v} is outside ${WEIGHT_RANGE[0]}–${WEIGHT_RANGE[1]} lb` }); return; }
      vals[k] = n;
    }
    if (!Object.keys(vals).length) return;
    const at: BodyDay['at'] = {};
    for (const part of (ei < 0 ? '' : r[ei] ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
      const [k, v] = part.split('='), t = Date.parse(v ?? '');
      if (!(BODY_FIELDS as readonly string[]).includes(k) || !Number.isFinite(t)) { errors.push({ row, message: `Bad edited_at "${part}"` }); return; }
      at[k as BodyField] = t;
    }
    const d = by.get(date) ?? { date };
    if (Object.keys(at).length) d.at = { ...d.at, ...at };
    // Nutrition comes one row per meal: add them up. Weights and body.csv rows replace.
    if (kind === 'mfp-nutrition') for (const k of ['calories', 'protein'] as const) { if (vals[k] != null) d[k] = round1((d[k] ?? 0) + vals[k]); }
    else Object.assign(d, vals);
    by.set(date, d);
  });
  return { kind, days: [...by.values()].sort((a, b) => a.date.localeCompare(b.date)), errors };
}

export function toBodyCsv(days: BodyDay[]): string {
  const lines = [...days].sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => [d.date, d.weight ?? '', d.calories ?? '', d.protein ?? '', d.energy ?? '',
      BODY_FIELDS.filter((k) => d.at?.[k] != null).map((k) => `${k}=${new Date(d.at![k]!).toISOString()}`).join(';')].join(','));
  return [BODY_HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}

/** The day with each field it carries stamped as entered now: between two phones that both entered one, the newer wins in sync. */
export const stampDay = (d: BodyDay, now = Date.now()): BodyDay => {
  const at = Object.fromEntries(BODY_FIELDS.filter((k) => d[k] != null).map((k) => [k, now]));
  return Object.keys(at).length ? { ...d, at: { ...d.at, ...at } } : d;
};

/** A day with `fill` laid over it: the fields it carries replace, and their edit times merge field by field the same way. */
export function mergeDay(d: BodyDay | undefined, fill: BodyDay): BodyDay {
  const at = d?.at || fill.at ? { ...d?.at, ...fill.at } : undefined;
  return { ...d, ...fill, ...(at && { at }) };
}

/** Fields present in `incoming` overwrite; the rest of each day is kept. */
export function mergeBody(existing: BodyDay[], incoming: BodyDay[]): BodyDay[] {
  const by = new Map(existing.map((d) => [d.date, { ...d }]));
  for (const d of incoming) by.set(d.date, mergeDay(by.get(d.date), d));
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const ALPHA = 0.1;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Exponentially smoothed trend weight (10 % a day); a gap of g days moves it as g daily steps toward the new weight would. */
export function trend(days: BodyDay[]): { date: string; weight: number; trend: number }[] {
  const out: { date: string; weight: number; trend: number }[] = [];
  for (const d of [...days].filter((x) => x.weight != null).sort((a, b) => a.date.localeCompare(b.date))) {
    const prev = out.at(-1);
    const t = prev ? prev.trend + (d.weight! - prev.trend) * (1 - (1 - ALPHA) ** dayDiff(prev.date, d.date)) : d.weight!;
    out.push({ date: d.date, weight: d.weight!, trend: t });
  }
  return out;
}

/** Least-squares slope of the trend over the last `days`, once it spans two weeks. */
export function rate(points: { date: string; trend: number }[], days = 28): { lbPerWeek: number; pctPerWeek: number } | null {
  if (!points.length) return null;
  const end = points.at(-1)!.date;
  const win = points.filter((p) => dayDiff(p.date, end) < days);
  if (win.length < 3 || dayDiff(win[0].date, end) < 14) return null;
  const xs = win.map((p) => dayDiff(win[0].date, p.date)), ys = win.map((p) => p.trend);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const lbPerWeek = slope * 7;
  return { lbPerWeek, pctPerWeek: (lbPerWeek / my) * 100 };
}

/** Context bands, % of body weight a week: lean gain 0.25–0.5 (Iraki 2019), cutting 0.5–1 (Helms 2014), with some slack. */
export function rateBand(pct: number): { label: string; tone: 'ok' | 'warn' } {
  if (pct > 0.6) return { label: 'Fast gain', tone: 'warn' };
  if (pct >= 0.15) return { label: 'Lean gain', tone: 'ok' };
  if (pct <= -1.1) return { label: 'Fast cut', tone: 'warn' };
  if (pct <= -0.15) return { label: 'Cutting', tone: 'ok' };
  return { label: 'Maintaining', tone: 'ok' };
}

/**
 * Stats › Body's weight (IA A5, owner 2026-10-21): the smoothed trend's latest, its 4-week rate and band, and the weigh-ins in the
 * range (`from` to `to`, both included) with their trend. Null with no weigh-in up to `to`: the section shows only with weigh-ins.
 */
export function weightSummary(days: readonly BodyDay[], from: string, to: string): {
  last: { date: string; weight: number; trend: number }; count: number;
  rate: { lbPerWeek: number; pctPerWeek: number } | null; band: { label: string; tone: 'ok' | 'warn' } | null;
  points: { date: string; weight: number; trend: number }[];
} | null {
  const t = trend(days.filter((d) => d.date <= to));
  if (!t.length) return null;
  const r = rate(t);
  return { last: t.at(-1)!, count: t.length, rate: r, band: r ? rateBand(r.pctPerWeek) : null, points: t.filter((p) => p.date >= from) };
}

/** Average protein over the last 7 days that have it, against 1.6 g/kg (Morton 2018). */
export function proteinCheck(days: BodyDay[], trendWeight: number, today: string): { avg: number; target: number; days: number } | null {
  const since = addDays(today, -6);
  const xs = days.filter((d) => d.protein != null && d.date >= since && d.date <= today);
  if (!xs.length) return null;
  return { avg: Math.round(xs.reduce((a, d) => a + d.protein!, 0) / xs.length), target: Math.round((trendWeight / 2.20462) * 1.6), days: xs.length };
}

/**
 * Like `diffSets` for days. Changed: a field the day carries replaces a different stored value (an empty field is kept by `mergeBody`,
 * so it can't change anything). A day that only fills fields the stored one lacks overwrites nothing, so it counts as fresh.
 */
export function diffBody(existing: BodyDay[], incoming: BodyDay[]): { fresh: BodyDay[]; changed: BodyDay[]; same: number } {
  const by = new Map(existing.map((d) => [d.date, d]));
  const out = { fresh: [] as BodyDay[], changed: [] as BodyDay[], same: 0 };
  for (const d of incoming) {
    const had = by.get(d.date);
    const fields = Object.entries(d).filter(([k, v]) => k !== 'date' && k !== 'at' && v !== undefined) as [keyof BodyDay, unknown][];
    if (!had) out.fresh.push(d);
    else if (fields.some(([k, v]) => had[k] !== undefined && had[k] !== v)) out.changed.push(d);
    else if (fields.some(([k]) => had[k] === undefined)) out.fresh.push(d);
    else out.same++;
  }
  return out;
}
