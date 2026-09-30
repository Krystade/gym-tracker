import { useCallback, useEffect, useState } from 'react';
import { getProfile, putProfile } from '../db/db';
import { defaultProfile, type Profile } from '../domain/profile';

export function useProfile() {
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  useEffect(() => { void getProfile().then((p) => { if (p) setProfile({ ...defaultProfile(), ...p }); }).catch(() => {}); }, []);
  const save = useCallback(async (p: Profile) => { setProfile(p); await putProfile(p); }, []);
  return { profile, save };
}
export type ProfileStore = ReturnType<typeof useProfile>;
