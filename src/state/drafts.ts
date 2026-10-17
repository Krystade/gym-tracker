// What's typed into a set form but not saved, and the cards added today, so switching profile mid-set or a reload (an app
// update) loses nothing. Kept in session storage, which outlives a reload but not the tab; a draft only counts on its own day.
const drafts = new Map<string, { date: string; value: unknown }>();
const k = (profile: string, exercise: string) => `${profile}|${exercise}`;
const STORE = 'gym-tracker:draft:';
// Session storage can be missing or throw (a private window, blocked site data): memory alone still covers leaving a screen.
const session = (): Storage | null => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } };

export function saveDraft<T>(profile: string, exercise: string, date: string, value: T) {
  drafts.set(k(profile, exercise), { date, value });
  try { session()?.setItem(STORE + k(profile, exercise), JSON.stringify({ date, value })); } catch { /* memory only */ }
}
export function getDraft<T>(profile: string, exercise: string, date: string): T | undefined {
  let d = drafts.get(k(profile, exercise));
  if (!d) {
    try { const raw = session()?.getItem(STORE + k(profile, exercise)); if (raw) drafts.set(k(profile, exercise), (d = JSON.parse(raw) as { date: string; value: unknown })); }
    catch { /* nothing saved */ }
  }
  return d && d.date === date ? (d.value as T) : undefined;
}
export function clearDraft(profile: string, exercise: string) {
  drafts.delete(k(profile, exercise));
  try { session()?.removeItem(STORE + k(profile, exercise)); } catch { /* memory only */ }
}

// Forms with changes not saved yet, so an app update can wait rather than reload under someone typing.
const dirty = new Set<string>();
export const markDirty = (form: string, on: boolean) => { if (on) dirty.add(form); else dirty.delete(form); };
export const anyDirty = () => dirty.size > 0;
