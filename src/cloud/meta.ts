import { getGyms, putGyms, type ProfileDb } from '../db/db';
import type { MetaItems } from '../domain/cloud';
import type { ExerciseSettings } from '../domain/progression';
import type { Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import type { Gym } from '../domain/equipment';

/** Everything of yours on this phone apart from the log and photos: priorities, program, day plans, lift settings, name mappings, gyms. */
export async function readMeta(db: ProfileDb): Promise<MetaItems> {
  const [profile, program, plans, settings, aliases, gyms] = await Promise.all([db.getProfile(), db.getProgram(), db.getDayPlans(), db.getAllSettings(), db.getAliases(), getGyms()]);
  const out: MetaItems = {};
  if (profile) out.profile = profile;
  if (program) out.program = program;
  for (const p of plans) out[p.key] = p; // 'day:YYYY-MM-DD'
  for (const s of settings) out[`settings:${s.key}`] = s;
  for (const [from, to] of Object.entries(aliases)) out[`alias:${from}`] = to;
  if (gyms.gyms.length) out.gyms = gyms;
  return out;
}

/** Saves what the cloud had that this phone didn't. */
export async function writeMeta(db: ProfileDb, pull: MetaItems): Promise<void> {
  const aliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(pull)) {
    if (k === 'profile') await db.putProfile(v as Profile);
    else if (k === 'program') await db.putProgram(v as Program);
    else if (k.startsWith('day:')) await db.putDayPlan(v as DayPlan);
    else if (k.startsWith('settings:')) await db.putSettings(v as ExerciseSettings);
    else if (k.startsWith('alias:')) aliases[k.slice(6)] = v as string;
    else if (k === 'gyms') await putGyms(v as { gyms: Gym[]; active?: string });
  }
  if (Object.keys(aliases).length) await db.putAliases({ ...(await db.getAliases()), ...aliases });
}
