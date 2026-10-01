import { useCallback, useEffect, useState } from 'react';
import { deletePersonData, getPeople, MAIN, putPeople, setProfileDb, type Person } from '../db/db';

/** Who uses this phone and who is training now. Switching points the database at that person before anything reads it. */
export function usePeople() {
  const [state, setState] = useState<{ people: Person[]; active: string; retired: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getPeople()
      .then((x) => { const ok = x.people.some((p) => p.id === x.active) ? x.active : MAIN; setProfileDb(ok); setState({ ...x, active: ok }); })
      .catch((e) => { setProfileDb(MAIN); setState({ people: [{ id: MAIN, name: 'Me', slug: 'me' }], active: MAIN, retired: [] }); setError(`Could not load profiles: ${String(e)}`); });
  }, []);
  const commit = useCallback(async (people: Person[], active: string, retired: string[]): Promise<boolean> => {
    setProfileDb(active);
    setState({ people, active, retired });
    try { await putPeople(people, active, retired); setError(null); return true; }
    catch (e) { setError(`Saving profiles failed: ${String(e)}`); return false; }
  }, []);
  const people = state?.people ?? [];
  const retired = state?.retired ?? [];
  const active = people.find((p) => p.id === state?.active) ?? people[0] ?? null;
  return {
    people, active, retired, error,
    switchTo: (id: string) => commit(people, id, retired),
    add: (name: string, slug: string) => { const id = `p${Date.now().toString(36)}`; return commit([...people, { id, name, slug }], id, retired); },
    rename: (id: string, name: string) => commit(people.map((p) => (p.id === id ? { ...p, name } : p)), active?.id ?? MAIN, retired),
    /** Switches away first, so nothing on screen still reads the database being deleted. */
    remove: async (id: string): Promise<boolean> => {
      if (id === MAIN) return false;
      const gone = people.find((p) => p.id === id);
      if (!(await commit(people.filter((p) => p.id !== id), active?.id === id ? MAIN : (active?.id ?? MAIN), gone ? [...retired, gone.slug] : retired))) return false;
      try { await deletePersonData(id); return true; }
      catch (e) { setError(`Deleting that profile’s data failed: ${String(e)}`); return false; }
    },
  };
}
export type PeopleStore = ReturnType<typeof usePeople>;
