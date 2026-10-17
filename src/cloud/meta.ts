import { getGyms, putGyms, type ProfileDb } from '../db/db';
import type { MetaItems } from '../domain/cloud';
import type { ExerciseSettings } from '../domain/progression';
import type { Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import type { Gym } from '../domain/equipment';
import type { TagPrefs } from '../domain/tags';
import { cleanStatus } from '../domain/orbit';

/** Everything of yours on this phone apart from the log and photos: priorities, program, day plans, lift settings, name mappings, gyms, tags, Orbit status. */
export async function readMeta(db: ProfileDb): Promise<MetaItems> {
  const [profile, program, plans, settings, aliases, gyms, tags, status] = await Promise.all([db.getProfile(), db.getProgram(), db.getDayPlans(), db.getAllSettings(), db.getAliases(), getGyms(), db.getTags(), db.getStatus()]);
  const out: MetaItems = {};
  if (profile) out.profile = profile;
  if (program) out.program = program;
  for (const p of plans) out[p.key] = p; // 'day:YYYY-MM-DD'
  for (const s of settings) out[`settings:${s.key}`] = s;
  for (const [from, to] of Object.entries(aliases)) out[`alias:${from}`] = to;
  if (gyms.gyms.length) out.gyms = gyms;
  if (tags) out.tags = tags;
  if (status !== undefined) out.status = status;
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
    else if (k === 'tags') await db.putTags(v as TagPrefs);
    else if (k === 'status') await db.putStatus(cleanStatus(v));
  }
  if (Object.keys(aliases).length) await db.putAliases({ ...(await db.getAliases()), ...aliases });
}

/** Deletes what another phone deleted (see mergeMeta): a lift's settings, a day plan, a name mapping, or the last gym. */
export async function removeMeta(db: ProfileDb, keys: string[]): Promise<void> {
  const aliases: string[] = [];
  for (const k of keys) {
    if (k.startsWith('settings:')) await db.deleteSettings(k.slice(9));
    else if (k.startsWith('day:')) await db.deleteDayPlan(k);
    else if (k.startsWith('alias:')) aliases.push(k.slice(6));
    else if (k === 'gyms') await putGyms({ gyms: [] });
  }
  if (aliases.length) {
    const map = { ...(await db.getAliases()) };
    for (const a of aliases) delete map[a];
    await db.putAliases(map);
  }
}
