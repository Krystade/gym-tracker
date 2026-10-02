import type { SetEntry } from './types';

export const fmtWeight = (w: number): string => String(Math.round(w * 100) / 100);
export const fmtSet = (s: SetEntry): string => `${s.weight === 0 ? 'BW' : fmtWeight(s.weight)} × ${s.reps ?? '?'}${s.flags.includes('hold') ? 's' : ''}`;
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
// The Today heading must fit one line on a phone: the year only when it isn't this year, and then without the weekday.
export function fmtDay(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const other = iso.slice(0, 4) !== today.slice(0, 4);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, other ? { month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
}
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
