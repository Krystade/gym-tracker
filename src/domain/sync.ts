import { parseCsv, toCsv } from './csv';
import { parseBodyFile, toBodyCsv, type BodyDay } from './body';
import type { SetEntry } from './types';

// The spec's one deliberate network exception: sets and body data to the user's own private repo,
// only when they tap Sync, with a token they pasted in. Photos never come through here.

export interface SyncConfig { key: 'sync'; repo: string; token: string; branch: string; lastSync?: string }
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class SyncError extends Error {
  /** Set on a push conflict: the merged state, so a retry doesn't pull the same rows in twice. */
  pulled?: { sets: SetEntry[]; body: BodyDay[]; counts: [number, number] };
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

export interface SyncPaths { sets: string; body: string; history?: string }
/** The first profile keeps app/ and reads history.csv (its imported notes); every other profile has its own folder and no history. */
export const pathsFor = (slug: string | null): SyncPaths =>
  slug == null ? { sets: 'app/sets.csv', body: 'app/body.csv', history: 'history.csv' } : { sets: `profiles/${slug}/sets.csv`, body: `profiles/${slug}/body.csv` };
/** Why a profile's backup folder name can't be used, or null. `taken`: the other profiles' slugs; `retired`: deleted profiles', whose files stay in the repo. */
export function slugError(slug: string, taken: string[], retired: string[] = []): string | null {
  if (!/^[a-z0-9-]{1,30}$/.test(slug)) return 'Use 1–30 lower-case letters, digits or dashes.';
  if (['app', 'profiles'].includes(slug)) return `“${slug}” is used by the backup itself.`;
  if (taken.includes(slug)) return 'Another profile already uses that folder.';
  if (retired.includes(slug)) return `profiles/${slug}/ still holds an old backup from a deleted profile — pick another folder.`;
  return null;
}

/** A file this build can't fully read is never overwritten: its unreadable rows would vanish from the backup. */
function unreadable(path: string, errors: { row: number; message: string }[]): never {
  const e = errors[0];
  throw new SyncError('other', `Can’t read ${path}${e.row ? ` row ${e.row}` : ''}: ${e.message}. Nothing was changed — fix it on GitHub, or update the app.`);
}

type SyncDeps = {
  client: ReturnType<typeof repoClient>; sets: SetEntry[]; body: BodyDay[]; deleted: Set<string>;
  importSets: (e: SetEntry[]) => Promise<{ added: number; updated: number } | null>; importBody: (d: BodyDay[]) => Promise<boolean>; now: Date;
  paths?: SyncPaths;
};
type SyncResult = { pulledSets: number; pulledBody: number; pushedSets: number; pushedBody: number };

/** Pull everything first (a failed pull pushes nothing), merge — the phone wins where both sides have a value — then push.
 *  If the backup moves underneath us, the whole pull→merge→push runs once more, so the other writer's rows are kept. */
export async function sync(deps: SyncDeps): Promise<SyncResult> {
  try { return await syncOnce(deps); }
  catch (e) {
    if (!(e instanceof SyncError && e.kind === 'conflict' && e.pulled)) throw e;
    const again = await syncOnce({ ...deps, sets: e.pulled.sets, body: e.pulled.body });
    return { ...again, pulledSets: again.pulledSets + e.pulled.counts[0], pulledBody: again.pulledBody + e.pulled.counts[1] };
  }
}

async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const { client } = deps;
  const { sets: SETS_PATH, body: BODY_PATH, history: HISTORY_PATH } = deps.paths ?? pathsFor(null);
  const history = HISTORY_PATH ? await client.get(HISTORY_PATH) : null;
  const remoteSets = await client.get(SETS_PATH);
  const remoteBody = await client.get(BODY_PATH);

  const parsedSets = remoteSets ? parseCsv(remoteSets.text, 'backup') : null;
  if (parsedSets?.errors.length) unreadable(SETS_PATH, parsedSets.errors);
  const parsedBody = remoteBody?.text.trim() ? parseBodyFile(remoteBody.text) : null;
  if (parsedBody && parsedBody.kind !== 'body') unreadable(BODY_PATH, [{ row: 1, message: 'the header isn’t date,weight_lb,calories,protein_g' }]);
  if (parsedBody?.errors.length) unreadable(BODY_PATH, parsedBody.errors);

  const have = new Set(deps.sets.map((e) => e.id));
  const incoming = new Map<string, SetEntry>();
  // history.csv is only read, never written, so rows it can't parse are skipped rather than blocking the sync.
  for (const entries of [history ? parseCsv(history.text, 'backup').entries : [], parsedSets?.entries ?? []]) {
    for (const e of entries) if (!have.has(e.id) && !deps.deleted.has(e.id)) incoming.set(e.id, e);
  }
  const bodyBy = new Map(deps.body.map((d) => [d.date, d]));
  const bodyIn: BodyDay[] = [];
  for (const d of parsedBody?.days ?? []) {
    const mine = bodyBy.get(d.date);
    const fill: BodyDay = { date: d.date };
    for (const k of ['weight', 'calories', 'protein', 'energy'] as const) if (d[k] != null && mine?.[k] == null) Object.assign(fill, { [k]: d[k] });
    if (Object.keys(fill).length > 1) bodyIn.push(fill);
  }
  const saveFailed = () => new SyncError('other', 'Saving the pulled data on this phone failed — nothing was pushed. Try again.');
  if (incoming.size && (await deps.importSets([...incoming.values()])) == null) throw saveFailed();
  if (bodyIn.length && (await deps.importBody(bodyIn)) === false) throw saveFailed();

  // Tombstones only stop sets coming back in; anything still on the phone is live, even under a reused id.
  const sets = [...deps.sets, ...incoming.values()];
  const body = [...bodyBy.values()].map((d) => ({ ...d }));
  for (const d of bodyIn) { const cur = body.find((x) => x.date === d.date); if (cur) Object.assign(cur, d); else body.push(d); }
  const message = `Backup from phone ${deps.now.toISOString()}`;
  try {
    await client.put(SETS_PATH, toCsv(sets), remoteSets?.sha, message);
    await client.put(BODY_PATH, toBodyCsv(body), remoteBody?.sha, message);
  } catch (e) {
    // What was pulled is already on the phone; the retry starts from there.
    if (e instanceof SyncError && e.kind === 'conflict') e.pulled = { sets, body, counts: [incoming.size, bodyIn.length] };
    throw e;
  }
  return { pulledSets: incoming.size, pulledBody: bodyIn.length, pushedSets: sets.length, pushedBody: body.length };
}

/** GitHub's new-token form, pre-filled (template URL). The repository still has to be picked there: GitHub doesn't take it as a parameter. */
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Gym+Tracker+backup&description=Sync+from+the+Gym+Tracker+app&expires_in=366&contents=write';
