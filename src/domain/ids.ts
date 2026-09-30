export const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ');

export const setId = (source: string, date: string, exercise: string, setNo: number): string =>
  `${source}|${date}|${normalizeName(exercise).toLowerCase()}|${setNo}`;

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
