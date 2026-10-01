import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { defaultSettings, settingsKey, type ExerciseSettings } from '../domain/progression';

export function useSettings() {
  const db = useDb();
  const [map, setMap] = useState<Map<string, ExerciseSettings>>(new Map());
  useEffect(() => { void db.getAllSettings().then((all) => setMap(new Map(all.map((s) => [s.key, s])))).catch(() => {}); }, []);
  const get = useCallback((name: string) => map.get(settingsKey(name)) ?? defaultSettings(name), [map]);
  const save = useCallback(async (s: ExerciseSettings) => { await db.putSettings(s); setMap((m) => new Map(m).set(s.key, s)); }, []);
  return { get, save };
}
export type SettingsStore = ReturnType<typeof useSettings>;
