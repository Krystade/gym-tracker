import { getGyms, type ProfileDb } from '../db/db';
import type { MetaItems } from '../domain/cloud';

/**
 * Everything of yours on this phone apart from the log and photos: priorities, program, day plans, lift settings, name mappings,
 * gyms, tags, Crew status. A sync saves them back item by item with db applySyncedMeta, which reads each the same way.
 */
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
