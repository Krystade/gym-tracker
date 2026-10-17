// Small per-profile choices about how a screen looks (a card folded, a suggestion dismissed), kept on this phone in local
// storage so they outlive closing the app. Storage can be missing or throw (a private window, blocked site data): then
// memory alone keeps them for the page, and the screens still work, only forgetting the choice.
const KEY = 'gym-tracker:pref:';
const memory = new Map<string, unknown>();
const local = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function getPref<T>(profile: string, name: string): T | undefined {
  const k = `${KEY}${profile}|${name}`;
  if (memory.has(k)) return memory.get(k) as T;
  try { const raw = local()?.getItem(k); return raw == null ? undefined : (JSON.parse(raw) as T); } catch { return undefined; }
}

export function setPref<T>(profile: string, name: string, value: T | undefined) {
  const k = `${KEY}${profile}|${name}`;
  memory.set(k, value);
  try { if (value === undefined) local()?.removeItem(k); else local()?.setItem(k, JSON.stringify(value)); } catch { /* memory only */ }
}
