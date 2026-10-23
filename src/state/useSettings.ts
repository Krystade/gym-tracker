import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { resolveSettings, settingsKey, type ExerciseSettings } from '../domain/progression';
import type { TrainingGoal } from '../domain/profile';
import { setWorksLike } from '../domain/lifts';

/** Every lift's "Works like…" choice, read by the resolver (domain/lifts) before anything renders with them. */
const register = (m: Map<string, ExerciseSettings>) => setWorksLike([...m.values()].flatMap((s) => (s.like ? [[s.key, s.like] as const] : [])));
import { defaultTags, type TagPrefs } from '../domain/tags';

/** `goal`: the profile's training goal, for a lift's default range (progression.resolveSettings). */
export function useSettings(goal: TrainingGoal = 'size') {
  const db = useDb();
  const [map, setMap] = useState<Map<string, ExerciseSettings>>(new Map());
  const [tags, setTags] = useState<TagPrefs>(defaultTags);
  const reload = useCallback(() => Promise.all([
    db.getAllSettings().then((all) => { const m = new Map(all.map((s) => [s.key, s])); register(m); setMap(m); }).catch(() => {}),
    db.getTags().then((t) => setTags(t ?? defaultTags())).catch(() => {}),
  ]), []);
  useEffect(() => { void reload(); }, [reload]);
  const get = useCallback((name: string, hold?: boolean) => resolveSettings(map.get(settingsKey(name)), name, hold, goal), [map, goal]);
  // `rangeFrom` is worked out on every read (resolveSettings), never stored: a row saved from a read must not pin it.
  const save = useCallback(async ({ rangeFrom: _, ...s }: ExerciseSettings) => { await db.putSettings(s); setMap((m) => { const n = new Map(m).set(s.key, s); register(n); return n; }); }, []);
  // Shown straight away; a failed write leaves the row as it was on the next launch.
  const saveTags = useCallback(async (t: TagPrefs) => { setTags(t); await db.putTags(t).catch(() => {}); }, []);
  return { get, save, reload, tags, saveTags };
}
export type SettingsStore = ReturnType<typeof useSettings>;
