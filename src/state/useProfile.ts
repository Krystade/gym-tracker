import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { defaultProfile, type Profile } from '../domain/profile';

export function useProfile() {
  const db = useDb();
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const reload = useCallback(() => db.getProfile().then((p) => { if (p) setProfile({ ...defaultProfile(), ...p }); }).catch(() => {}), []);
  useEffect(() => { void reload(); }, [reload]);
  const save = useCallback(async (p: Profile) => { setProfile(p); await db.putProfile(p); }, []);
  return { profile, save, reload };
}
export type ProfileStore = Pick<ReturnType<typeof useProfile>, 'profile' | 'save'>;
