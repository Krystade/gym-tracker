// What's typed into a set form but not saved, so switching profile mid-set loses nothing. Memory only, and only for the day it was typed.
const drafts = new Map<string, { date: string; value: unknown }>();
const k = (profile: string, exercise: string) => `${profile}|${exercise}`;

export const saveDraft = <T,>(profile: string, exercise: string, date: string, value: T) => { drafts.set(k(profile, exercise), { date, value }); };
export function getDraft<T>(profile: string, exercise: string, date: string): T | undefined {
  const d = drafts.get(k(profile, exercise));
  return d && d.date === date ? (d.value as T) : undefined;
}
export const clearDraft = (profile: string, exercise: string) => { drafts.delete(k(profile, exercise)); };
