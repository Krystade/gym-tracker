import { createContext, useContext, type ReactNode } from 'react';
import { boundDb, MAIN, type ProfileDb } from '../db/db';

// The database of the profile whose screens these are. Bound once per mount, so a call that finishes after a switch still
// writes to the person it started for.
const Ctx = createContext<ProfileDb>(boundDb(MAIN));
const IdCtx = createContext<string>(MAIN);
export const ProfileDbProvider = ({ id, children }: { id: string; children: ReactNode }) =>
  <IdCtx.Provider value={id}><Ctx.Provider value={boundDb(id)}>{children}</Ctx.Provider></IdCtx.Provider>;
export const useDb = (): ProfileDb => useContext(Ctx);
export const useProfileId = (): string => useContext(IdCtx);
