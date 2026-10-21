import { useMemo, useState } from 'react';
import type { FriendData } from '../cloud/friends';
import { defaultProfile, type Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import { defaultSettings, settingsKey, type ExerciseSettings } from '../domain/progression';
import { defaultTags, type TagPrefs } from '../domain/tags';
import { useFittedProfile } from '../state/useFittedProfile';
import type { SetsStore } from '../state/useSets';
import type { BodyStore } from '../state/useBody';
import type { ProgramStore } from '../state/useProgram';
import type { SettingsStore } from '../state/useSettings';
import type { GymsStore } from '../state/useGyms';
import { HistoryScreen } from './HistoryScreen';
import { LiftsScreen } from './LiftsScreen';
import { StatsScreen } from './StatsScreen';
import { ExerciseScreen } from './ExerciseScreen';
import type { Gym } from '../domain/equipment';
import { copyGym } from '../domain/share';

export type FriendTab = 'history' | 'lifts' | 'stats';
const noop = async () => {};

/** A friend's whole log on your own screens, read-only (opened from their page: readFriend reads it then). */
export function Screens({ name, data, tab, exercise, today, gyms, onOpen, onExerciseBack }: {
  /** Their username: every heading and line names them, never "your". */ name: string; data: FriendData; tab: FriendTab; exercise: string | null; today: string; gyms: GymsStore; onOpen: (n: string) => void; onExerciseBack: () => void;
}) {
  // Stand-ins for the phone's stores, built from what they synced; nothing on them writes.
  const { store, body, programs, settings, raw } = useMemo(() => {
    const m = data.meta;
    const plans = Object.entries(m).filter(([k]) => k.startsWith('day:')).map(([, v]) => v as DayPlan);
    const lifts = new Map(Object.entries(m).filter(([k]) => k.startsWith('settings:')).map(([, v]) => [(v as ExerciseSettings).key, v as ExerciseSettings]));
    return {
      store: { entries: data.sets, loading: false, error: null } as unknown as SetsStore,
      body: { days: data.body, error: null } as unknown as BodyStore,
      programs: { program: (m.program as Program | undefined) ?? null, plans, error: null, save: noop, savePlan: noop, reload: noop } as unknown as ProgramStore,
      settings: { get: (n: string, hold?: boolean) => lifts.get(settingsKey(n)) ?? defaultSettings(n, hold), save: noop, reload: noop, tags: (m.tags as TagPrefs | undefined) ?? defaultTags(), saveTags: noop } as unknown as SettingsStore,
      raw: { profile: { ...defaultProfile(), ...(m.profile as Profile | undefined) }, save: noop },
    };
  }, [data]);
  const profile = useFittedProfile(raw, programs.program, store.entries, today);
  if (exercise) return <ExerciseScreen readOnly name={exercise} store={store} settings={settings} gyms={gyms} programs={programs} date={today} onLog={() => {}} onBack={onExerciseBack} onRenamed={() => {}} />;
  if (tab === 'history') return <HistoryScreen who={name} store={store} onOpen={onOpen} />;
  if (tab === 'lifts') return <LiftsScreen who={name} loggedOnly store={store} onOpen={onOpen} />;
  return (<>
    <StatsScreen readOnly who={name} store={store} profile={profile} programs={programs} body={body} today={today} settings={settings} />
    <TheirGyms list={(data.meta.gyms as { gyms?: Gym[] } | undefined)?.gyms ?? []} gyms={gyms} />
  </>);
}

/** A friend's gyms, each one copyable into yours (a new gym; theirs is untouched). */
function TheirGyms({ list, gyms }: { list: Gym[]; gyms: GymsStore }) {
  const [added, setAdded] = useState<string | null>(null);
  if (!list.length) return null;
  return (
    <section className="card" aria-label="Their gyms">
      <h2>Their gyms</h2>
      <ul className="friend-list">
        {list.map((g) => (
          <li key={g.id}>
            <span>{g.name}<span className="muted small"> · {g.equipment.length} {g.equipment.length === 1 ? 'piece' : 'pieces'} of gear</span></span>
            <button className="mini" onClick={() => {
              const n = copyGym(g, gyms.gyms);
              void gyms.save([...gyms.gyms, n], gyms.active?.id ?? n.id).then((ok) => { if (ok) setAdded(n.name); });
            }}>Add to my gyms</button>
          </li>
        ))}
      </ul>
      {added && <p className="muted small" role="status">Added {added} to your gyms.</p>}
    </section>
  );
}
