import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { defaultSettings, settingsKey, type ExerciseSettings } from '../domain/progression';
import { defaultTags, type TagPrefs } from '../domain/tags';

export function useSettings() {
  const db = useDb();
  const [map, setMap] = useState<Map<string, ExerciseSettings>>(new Map());
  const [tags, setTags] = useState<TagPrefs>(defaultTags);
  const reload = useCallback(() => Promise.all([
    db.getAllSettings().then((all) => setMap(new Map(all.map((s) => [s.key, s])))).catch(() => {}),
    db.getTags().then((t) => setTags(t ?? defaultTags())).catch(() => {}),
  ]), []);
  useEffect(() => { void reload(); }, [reload]);
  const get = useCallback((name: string, hold?: boolean) => map.get(settingsKey(name)) ?? defaultSettings(name, hold), [map]);
  const save = useCallback(async (s: ExerciseSettings) => { await db.putSettings(s); setMap((m) => new Map(m).set(s.key, s)); }, []);
  // Shown straight away; a failed write leaves the row as it was on the next launch.
  const saveTags = useCallback(async (t: TagPrefs) => { setTags(t); await db.putTags(t).catch(() => {}); }, []);
  return { get, save, reload, tags, saveTags };
}
export type SettingsStore = ReturnType<typeof useSettings>;
