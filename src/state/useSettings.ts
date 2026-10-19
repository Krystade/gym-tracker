import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { defaultSettings, settingsKey, type ExerciseSettings } from '../domain/progression';
import { setWorksLike } from '../domain/lifts';

/** Every lift's "Works like…" choice, read by the resolver (domain/lifts) before anything renders with them. */
const register = (m: Map<string, ExerciseSettings>) => setWorksLike([...m.values()].flatMap((s) => (s.like ? [[s.key, s.like] as const] : [])));
import { defaultTags, type TagPrefs } from '../domain/tags';

export function useSettings() {
  const db = useDb();
  const [map, setMap] = useState<Map<string, ExerciseSettings>>(new Map());
  const [tags, setTags] = useState<TagPrefs>(defaultTags);
  const reload = useCallback(() => Promise.all([
    db.getAllSettings().then((all) => { const m = new Map(all.map((s) => [s.key, s])); register(m); setMap(m); }).catch(() => {}),
    db.getTags().then((t) => setTags(t ?? defaultTags())).catch(() => {}),
  ]), []);
  useEffect(() => { void reload(); }, [reload]);
  const get = useCallback((name: string, hold?: boolean) => map.get(settingsKey(name)) ?? defaultSettings(name, hold), [map]);
  const save = useCallback(async (s: ExerciseSettings) => { await db.putSettings(s); setMap((m) => { const n = new Map(m).set(s.key, s); register(n); return n; }); }, []);
  // Shown straight away; a failed write leaves the row as it was on the next launch.
  const saveTags = useCallback(async (t: TagPrefs) => { setTags(t); await db.putTags(t).catch(() => {}); }, []);
  return { get, save, reload, tags, saveTags };
}
export type SettingsStore = ReturnType<typeof useSettings>;
