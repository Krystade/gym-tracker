import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { defaultProfile, type Profile } from '../domain/profile';

export function useProfile() {
  const db = useDb();
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  useEffect(() => { void db.getProfile().then((p) => { if (p) setProfile({ ...defaultProfile(), ...p }); }).catch(() => {}); }, []);
  const save = useCallback(async (p: Profile) => { setProfile(p); await db.putProfile(p); }, []);
  return { profile, save };
}
export type ProfileStore = ReturnType<typeof useProfile>;
