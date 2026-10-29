import { parseCsv, parseRows, toCsv, type CsvError } from './csv';
import { BODY_FIELDS, mergeBody, parseBodyFile, toBodyCsv, type BodyDay } from './body';
import type { SetEntry } from './types';
import { editStamp, lifeStamp, metaHash, type MetaItems } from './cloud';
import { mergeBuddyMeta } from './buddies/kept';
import { importOverlap } from './duplicates';
import type { Replaced, Taken } from './replaced';

// The spec's one deliberate network exception: sets and body data to the user's own private repo,
// only when they tap Sync, with a token they pasted in. Photos never come through here.

/** `historySha`: the content sha of the history.csv this phone last pulled; the same file isn't pulled again. */
export interface SyncConfig { key: 'sync'; repo: string; token: string; branch: string; lastSync?: string; historySha?: string }
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class SyncError extends Error {
  /** Set on a push conflict: the merged state, so a retry doesn't pull the same rows in twice. */
  pulled?: { sets: SetEntry[]; body: BodyDay[]; counts: [number, number, number] };
  constructor(public kind: 'auth' | 'access' | 'network' | 'conflict' | 'other', message: string) { super(message); }
}

export function toB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function fromB64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function repoClient(cfg: SyncConfig, fetchFn: Fetch) {
  const base = `https://api.github.com/repos/${cfg.repo.split('/').map(encodeURIComponent).join('/')}/contents/`;
  const url = (path: string, ref = true) => `${base}${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(cfg.branch)}` : ''}`;
  const headers = (accept = 'application/vnd.github+json') => ({ Authorization: `Bearer ${cfg.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' });

  async function call(u: string, init: RequestInit): Promise<Response> {
    let r: Response;
    // no-store: GitHub's responses are cacheable for a minute, and a cached GET hands back a sha we've already replaced.
    try { r = await fetchFn(u, { ...init, cache: 'no-store' }); } catch { throw new SyncError('network', 'Couldn’t reach GitHub — check the connection and try again.'); }
    if (r.status === 401) throw new SyncError('auth', 'GitHub rejected the token — it may have expired. Paste a new one.');
    if (r.status === 403) throw new SyncError('access', 'The token can’t write to that repo — give it Contents: Read and write on it.');
    if (r.status === 409) throw new SyncError('conflict', 'The backup changed while syncing — try again.');
    return r;
  }

  async function get(path: string): Promise<{ text: string; sha: string } | null> {
    const r = await call(url(path), { headers: headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new SyncError('other', `GitHub answered ${r.status} reading ${path}.`);
    const j = (await r.json()) as { content?: string; encoding?: string; sha: string };
    if (j.encoding === 'base64' && j.content != null) return { text: fromB64(j.content), sha: j.sha };
    // Over 1 MB the JSON carries no content: fetch the raw file.
    const raw = await call(url(path), { headers: headers('application/vnd.github.raw+json') });
    if (!raw.ok) throw new SyncError('other', `GitHub answered ${raw.status} reading ${path}.`);
    return { text: await raw.text(), sha: j.sha };
  }

  async function put(path: string, text: string, sha: string | undefined, message: string): Promise<void> {
    const r = await call(url(path, false), { method: 'PUT', headers: headers(), body: JSON.stringify({ message, content: toB64(text), branch: cfg.branch, ...(sha && { sha }) }) });
    if (r.status === 404) throw new SyncError('access', 'Repo not found — check the name, and that the token can see it.');
    if (r.status === 422) {
      // "sha wasn't supplied": another device created the file between our GET and PUT. Same race as 409.
      // Any other 422 is a request GitHub will never accept, so retrying can't help: pass its reason on.
      const why = ((await r.json().catch(() => ({}))) as { message?: string }).message ?? '';
      if (/\bsha\b/.test(why)) throw new SyncError('conflict', 'The backup changed while syncing — try again.');
      throw new SyncError('other', `GitHub answered 422 writing ${path}${why ? `: ${why}` : '.'}`);
    }
    if (!r.ok) throw new SyncError('other', `GitHub answered ${r.status} writing ${path}.`);
  }

  /** Create or replace a file; one retry with a fresh sha if it moved underneath us. */
  async function upsert(path: string, text: string, message: string, sha?: string | null): Promise<void> {
    const known = sha === undefined ? (await get(path))?.sha : sha ?? undefined;
    try { await put(path, text, known, message); }
    catch (e) {
      if (!(e instanceof SyncError && e.kind === 'conflict')) throw e;
      await put(path, text, (await get(path))?.sha, message);
    }
  }
  return { get, put, upsert };
}

export interface SyncPaths { sets: string; body: string; deleted: string; history?: string; /** Gym Buddies' settings items (domain/buddies/kept). */ buddies?: string }
/** The first profile keeps app/ and reads history.csv (its imported notes); every other profile has its own folder and no history. */
export const pathsFor = (slug: string | null): SyncPaths =>
  slug == null ? { sets: 'app/sets.csv', body: 'app/body.csv', deleted: 'app/deleted.csv', history: 'history.csv', buddies: 'app/buddies.json' }
    : { sets: `profiles/${slug}/sets.csv`, body: `profiles/${slug}/body.csv`, deleted: `profiles/${slug}/deleted.csv`, buddies: `profiles/${slug}/buddies.json` };

/**
 * deleted.csv: the sets deleted from a profile's log, one row each (`id,deleted_at`, an ISO time), so a restore or another
 * device doesn't bring them back from sets.csv or history.csv. A backup from before it has none, which reads as no deletes.
 */
const DELETED_HEADER = ['id', 'deleted_at'];
const csvField = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function toDeletedCsv(deleted: Record<string, number>): string {
  const rows = Object.entries(deleted).sort(([a, x], [b, y]) => x - y || (a < b ? -1 : a > b ? 1 : 0));
  return [DELETED_HEADER.join(','), ...rows.map(([id, at]) => `${csvField(id)},${new Date(at).toISOString()}`)].join('\r\n') + '\r\n';
}
/** An id listed twice keeps its latest time. */
export function parseDeletedCsv(text: string): { deleted: Record<string, number>; errors: CsvError[] } {
  const rows = parseRows(text).filter((r) => r.some((c) => c.trim() !== ''));
  const deleted: Record<string, number> = {}, errors: CsvError[] = [];
  if (!rows.length) return { deleted, errors };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = DELETED_HEADER.find((c) => !header.includes(c));
  if (missing) return { deleted, errors: [{ row: 1, message: `Missing column ${missing}` }] };
  const [ic, tc] = DELETED_HEADER.map((c) => header.indexOf(c));
  rows.slice(1).forEach((r, i) => {
    const id = (r[ic] ?? '').trim(), raw = (r[tc] ?? '').trim(), at = Date.parse(raw);
    if (!id) errors.push({ row: i + 2, message: 'Missing id' });
    else if (!Number.isFinite(at)) errors.push({ row: i + 2, message: `Bad deleted_at "${raw}"` });
    else deleted[id] = Math.max(deleted[id] ?? 0, at);
  });
  return { deleted, errors };
}

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
/**
 * The newest thing known to have happened to a set, for a delete to beat: logged, edited or put back (cloud lifeStamp). A row
 * read from a file has its row number for a seq, so when it was logged or entered stands in: a set logged again under a deleted
 * set's id is newer than that delete.
 */
const setStamp = (s: SetEntry) => Math.max(lifeStamp(s), ms(s.loggedAt), ms(s.enteredAt));
/** sets.csv has no restored_at: a set Undo put back goes up as edited then, so it beats the delete it undid on other devices too. */
const forFile = (s: SetEntry): SetEntry => ((s.restoredAt ?? 0) > (s.editedAt ?? 0) ? { ...s, editedAt: s.restoredAt } : s);
/** Why a profile's backup folder name can't be used, or null. `taken`: the other profiles' slugs; `retired`: deleted profiles', whose files stay in the repo. */
export function slugError(slug: string, taken: string[], retired: string[] = []): string | null {
  if (!/^[a-z0-9-]{1,30}$/.test(slug)) return 'Use 1–30 lower-case letters, digits or dashes.';
  if (['app', 'profiles'].includes(slug)) return `“${slug}” is used by the backup itself.`;
  if (taken.includes(slug)) return 'Another profile already uses that folder.';
  if (retired.includes(slug)) return `profiles/${slug}/ still holds an old backup from a deleted profile — pick another folder.`;
  return null;
}

/** buddies.json: `{ v: 1, items }`, Gym Buddies' settings items by key, as the account sync has them. */
export const toBuddiesFile = (items: MetaItems): string => `${JSON.stringify({ v: 1, items }, null, 1)}
`;
/** The items, or undefined when the file isn't one (never overwritten then). Each item is still read as untrusted on merge. */
export function parseBuddiesFile(text: string): MetaItems | undefined {
  try {
    const j = JSON.parse(text) as { v?: unknown; items?: unknown };
    return j && j.v === 1 && j.items && typeof j.items === 'object' && !Array.isArray(j.items) ? (j.items as MetaItems) : undefined;
  } catch { return undefined; }
}

/** A file this build can't fully read is never overwritten: its unreadable rows would vanish from the backup. */
function unreadable(path: string, errors: { row: number; message: string }[]): never {
  const e = errors[0];
  throw new SyncError('other', `Can’t read ${path}${e.row ? ` row ${e.row}` : ''}: ${e.message}. Nothing was changed — fix it on GitHub, or update the app.`);
}

type SyncDeps = {
  client: ReturnType<typeof repoClient>; sets: SetEntry[]; body: BodyDay[];
  /** This phone's tombstones, and when each delete made here went, where known (db getSyncSnapshot). */
  deleted: Set<string>; tombAt?: Record<string, number>;
  now: Date; paths?: SyncPaths;
  /** The sha of the history.csv a sync last pulled (SyncConfig historySha): a file with that same content is not pulled again. */
  historySeen?: string;
  /**
   * Saves what the pull takes onto this phone, keeping first this phone's values it replaces (domain/replaced): only what's still
   * as `base` had it, so an edit made here while the pull was out stays for the next sync (db applySynced). Throws if it couldn't.
   */
  apply: (base: { sets: SetEntry[]; body: BodyDay[] }, taken: Taken, now: number) => Promise<{ taken: Taken; replaced: Replaced[]; skipped: number }>;
  /**
   * Gym Buddies' items on this phone (cloud/meta readBuddyMeta), and how to save what the backup adds (db applySyncedMeta: only
   * what's still as `local` had it). None: the backup's buddies.json is left alone.
   */
  buddies?: { local: MetaItems; apply: (base: MetaItems, pull: MetaItems) => Promise<unknown> };
};
/**
 * `historySha`: the history.csv this sync read, to pass back as `historySeen`. `heldBack`: its sets left out because the log
 * already has their day and lift from another import (the same sets imported twice).
 */
type SyncResult = { pulledSets: number; pulledBody: number; removedSets: number; pushedSets: number; pushedBody: number; historySha?: string; heldBack: number; /** Buddies items the backup added or changed here. */ pulledBuddies?: number };

/** Pull everything first (a failed pull pushes nothing), merge — the newer edit or delete wins — then push.
 *  If the backup moves underneath us, the whole pull→merge→push runs once more, so the other writer's rows are kept. */
export async function sync(deps: SyncDeps): Promise<SyncResult> {
  try { return await syncOnce(deps); }
  catch (e) {
    if (!(e instanceof SyncError && e.kind === 'conflict' && e.pulled)) throw e;
    // The deletes it took are in deleted.csv still (the file only grows), so the retry finds them there again.
    const { sets, body, counts } = e.pulled;
    const again = await syncOnce({ ...deps, sets, body });
    return { ...again, pulledSets: again.pulledSets + counts[0], pulledBody: again.pulledBody + counts[1], removedSets: again.removedSets + counts[2] };
  }
}

async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const { client } = deps;
  const { sets: SETS_PATH, body: BODY_PATH, deleted: DELETED_PATH, history: HISTORY_PATH } = deps.paths ?? pathsFor(null);
  const history = HISTORY_PATH ? await client.get(HISTORY_PATH) : null;
  const remoteSets = await client.get(SETS_PATH);
  const remoteDeleted = await client.get(DELETED_PATH);
  const remoteBody = await client.get(BODY_PATH);
  const BUDDIES_PATH = deps.buddies && (deps.paths ?? pathsFor(null)).buddies;
  const remoteBuddies = BUDDIES_PATH ? await client.get(BUDDIES_PATH) : null;

  const parsedSets = remoteSets ? parseCsv(remoteSets.text, 'backup') : null;
  if (parsedSets?.errors.length) unreadable(SETS_PATH, parsedSets.errors);
  const parsedBody = remoteBody?.text.trim() ? parseBodyFile(remoteBody.text) : null;
  if (parsedBody && parsedBody.kind !== 'body') unreadable(BODY_PATH, [{ row: 1, message: 'the header isn’t date,weight_lb,calories,protein_g' }]);
  if (parsedBody?.errors.length) unreadable(BODY_PATH, parsedBody.errors);
  const parsedDeleted = remoteDeleted ? parseDeletedCsv(remoteDeleted.text) : null;
  if (parsedDeleted?.errors.length) unreadable(DELETED_PATH, parsedDeleted.errors);
  const parsedBuddies = remoteBuddies ? parseBuddiesFile(remoteBuddies.text) : null;
  if (parsedBuddies === undefined) unreadable(BUDDIES_PATH!, [{ row: 0, message: 'it isn’t a buddies file this build reads' }]);

  const have = new Map(deps.sets.map((e) => [e.id, e]));
  // Deletes as the account's months keep them (cloud mergeMonth): the backup's and this phone's, the later time for each. A
  // tombstone under a set that's on the phone is an old delete of a reused id; one without a time is either the backup's
  // delete (that time) or one from before delete times (now). A delete beats a set only if it's newer than all that happened to it.
  const deleted: Record<string, number> = { ...parsedDeleted?.deleted };
  for (const id of deps.deleted) {
    if (have.has(id)) continue;
    deleted[id] = Math.max(deleted[id] ?? 0, deps.tombAt?.[id] ?? deleted[id] ?? deps.now.getTime());
  }
  const gone = (id: string, stamp: number) => id in deleted && stamp <= deleted[id];

  const incoming = new Map<string, SetEntry>();
  // history.csv is a one-time seed, only read, never written: pulled once per content (its sha), so a set removed from the log
  // isn't brought back by the next sync. Rows it can't parse are skipped rather than blocking the sync. New rows on a day and
  // lift the log (or the backup's copy of it) already has from another import are held back: the same sets twice.
  const fromHistory = history && history.sha !== deps.historySeen ? parseCsv(history.text, 'backup').entries : [];
  const backupSets = parsedSets?.entries ?? [];
  const historyNew = fromHistory.filter((e) => !have.has(e.id) && !gone(e.id, setStamp(e)));
  const held = new Set(importOverlap([...deps.sets, ...backupSets.filter((e) => !gone(e.id, setStamp(e)))], historyNew).held.map((e) => e.id));
  for (const entries of [fromHistory.filter((e) => !held.has(e.id)), backupSets]) {
    for (const e of entries) {
      const mine = have.get(e.id);
      if (!mine) { if (!gone(e.id, setStamp(e))) incoming.set(e.id, e); continue; }
      // Edited on another device since this phone's last change: theirs, in this phone's place in the day (a CSV row has no seq).
      if ((e.editedAt ?? 0) > editStamp(mine)) incoming.set(e.id, { ...e, seq: mine.seq, ...(mine.restoredAt != null && { restoredAt: mine.restoredAt }) });
    }
  }
  // A set on this phone that another device deleted later than anything done to it, here or in the backup's copy.
  const deleteIds = deps.sets.filter((s) => { const t = incoming.get(s.id); return gone(s.id, Math.max(setStamp(s), t ? setStamp(t) : 0)); }).map((s) => s.id);
  for (const id of deleteIds) incoming.delete(id);
  const bodyBy = new Map(deps.body.map((d) => [d.date, d]));
  const bodyIn: BodyDay[] = [];
  for (const d of parsedBody?.days ?? []) {
    const mine = bodyBy.get(d.date);
    const fill: BodyDay = { date: d.date };
    // Per field: fills what the phone lacks, or replaces what it has when entered more recently elsewhere.
    for (const k of BODY_FIELDS) {
      if (d[k] == null || (mine?.[k] != null && (d.at?.[k] ?? 0) <= (mine.at?.[k] ?? 0))) continue;
      Object.assign(fill, { [k]: d[k] });
      if (d.at?.[k] != null) fill.at = { ...fill.at, [k]: d.at[k] };
    }
    if (Object.keys(fill).length > 1) bodyIn.push(fill);
  }
  const saveFailed = () => new SyncError('other', 'Saving the pulled data on this phone failed — nothing was pushed. Try again.');
  // What the pull replaces of the phone's is kept first, so nothing is overwritten without a copy. A row the push below sends up
  // that the phone changed meanwhile goes up as the backup already had it; the phone's newer copy wins at the next sync.
  // A set another device deleted goes the same way (a copy kept, theirs: deleted).
  const none = { importSets: [], deleteIds: [], importBody: [] };
  const { taken } = incoming.size || bodyIn.length || deleteIds.length
    ? await deps.apply({ sets: deps.sets, body: deps.body }, { importSets: [...incoming.values()], deleteIds, importBody: bodyIn }, deps.now.getTime()).catch(() => { throw saveFailed(); })
    : { taken: none as Taken };

  // Buddies' items the backup has that this phone lacks or holds older: saved here first (only where still as read), then pushed.
  let pulledBuddies = 0, buddyText: string | null = null;
  if (deps.buddies) {
    const merged = mergeBuddyMeta(deps.buddies.local, parsedBuddies ?? {});
    const pull = Object.fromEntries(Object.entries(merged).filter(([k, v]) => deps.buddies!.local[k] === undefined || metaHash(v) !== metaHash(deps.buddies!.local[k])));
    if (Object.keys(pull).length) await deps.buddies.apply(deps.buddies.local, pull).catch(() => { throw saveFailed(); });
    pulledBuddies = Object.keys(pull).length;
    buddyText = toBuddiesFile(merged);
  }

  // A delete skipped because the set changed here meanwhile still goes: deleted.csv has it, and the newer set wins it next sync.
  const dropped = new Set(deleteIds);
  const sets = [...deps.sets.filter((e) => !incoming.has(e.id) && !dropped.has(e.id)), ...incoming.values()];
  const body = mergeBody(deps.body, bodyIn);
  const message = `Backup from phone ${deps.now.toISOString()}`;
  try {
    // Deletes first: should a later write fail, sets.csv still holding a deleted set can't bring it back. A backup that never
    // had a delete gets no file.
    const deletedText = toDeletedCsv(deleted);
    if (deletedText !== toDeletedCsv(parsedDeleted?.deleted ?? {})) await client.put(DELETED_PATH, deletedText, remoteDeleted?.sha, message);
    await client.put(SETS_PATH, toCsv(sets.map(forFile)), remoteSets?.sha, message);
    await client.put(BODY_PATH, toBodyCsv(body), remoteBody?.sha, message);
    // Buddies: the union, merged per item (domain/buddies/kept). Written only when it differs, so a backup without buddies gets no file.
    if (buddyText !== null && buddyText !== (remoteBuddies?.text ?? toBuddiesFile({}))) await client.put(BUDDIES_PATH!, buddyText, remoteBuddies?.sha, message);
  } catch (e) {
    // What was pulled is already on the phone; the retry starts from there.
    if (e instanceof SyncError && e.kind === 'conflict') e.pulled = { sets, body, counts: [taken.importSets.length, taken.importBody.length, taken.deleteIds.length]};
    throw e;
  }
  return { pulledSets: taken.importSets.length, pulledBody: taken.importBody.length, removedSets: taken.deleteIds.length, pushedSets: sets.length, pushedBody: body.length, historySha: history?.sha, heldBack: held.size, pulledBuddies };
}

/** GitHub's new-token form, pre-filled (template URL). The repository still has to be picked there: GitHub doesn't take it as a parameter. */
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Gym+Tracker+backup&description=Sync+from+the+Gym+Tracker+app&expires_in=366&contents=write';
