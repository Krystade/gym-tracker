import { createContext, useContext, type ReactNode } from 'react';
import { boundDb, MAIN, type ProfileDb } from '../db/db';

// The database of the profile whose screens these are. Bound once per mount, so a call that finishes after a switch still
// writes to the person it started for.
const Ctx = createContext<ProfileDb>(boundDb(MAIN));
export const ProfileDbProvider = ({ id, children }: { id: string; children: ReactNode }) => <Ctx.Provider value={boundDb(id)}>{children}</Ctx.Provider>;
export const useDb = (): ProfileDb => useContext(Ctx);
