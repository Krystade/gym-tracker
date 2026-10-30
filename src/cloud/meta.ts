import { getGyms, type ProfileDb } from '../db/db';
import type { MetaItems } from '../domain/cloud';

/**
 * Everything of yours on this phone apart from the log and photos: priorities, program, day plans, lift settings, name mappings,
 * gyms, tags, Crew status, the day achievements count from, Gym Buddies'. A sync saves them back item by item with db applySyncedMeta, which
 * reads each the same way.
 */
export async function readMeta(db: ProfileDb): Promise<MetaItems> {
  const [profile, program, plans, settings, aliases, gyms, tags, status, achievements] = await Promise.all([db.getProfile(), db.getProgram(), db.getDayPlans(), db.getAllSettings(), db.getAliases(), getGyms(), db.getTags(), db.getStatus(), db.getAchStart()]);
  const out: MetaItems = {};
  if (profile) out.profile = profile;
  if (program) out.program = program;
  for (const p of plans) out[p.key] = p; // 'day:YYYY-MM-DD'
  for (const s of settings) out[`settings:${s.key}`] = s;
  for (const [from, to] of Object.entries(aliases)) out[`alias:${from}`] = to;
  if (gyms.gyms.length) out.gyms = gyms;
  if (tags) out.tags = tags;
  if (status !== undefined) out.status = status;
  if (achievements) out.achievements = achievements;
  return { ...out, ...(await readBuddyMeta(db)) };
}

/** Gym Buddies' items alone (domain/buddies/kept), as readMeta has them: what the backup file carries of the settings. */
export async function readBuddyMeta(db: Pick<ProfileDb, 'getBuddyPrefs' | 'getBuddyLead' | 'getBuddyStart' | 'getSpends'>): Promise<MetaItems> {
  const [prefs, lead, start, spends] = await Promise.all([db.getBuddyPrefs(), db.getBuddyLead(), db.getBuddyStart(), db.getSpends()]);
  const out: MetaItems = {};
  if (Object.keys(prefs).length) out.buddies = prefs;
  if (lead) out['buddy-lead'] = lead;
  if (start) out['buddy-start'] = start;
  for (const s of spends) out[`spend:${s.id}`] = s;
  return out;
}
