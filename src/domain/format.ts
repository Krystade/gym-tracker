import type { SetEntry } from './types';

export const fmtWeight = (w: number): string => String(Math.round(w * 100) / 100);
export const fmtSet = (s: SetEntry): string => `${s.weight === 0 ? 'BW' : fmtWeight(s.weight)} × ${s.reps ?? '?'}`;
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
