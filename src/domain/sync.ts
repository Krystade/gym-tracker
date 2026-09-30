import { parseCsv, toCsv } from './csv';
import { parseBodyFile, toBodyCsv, type BodyDay } from './body';
import type { SetEntry } from './types';

// The spec's one deliberate network exception: sets and body data to the user's own private repo,
// only when they tap Sync, with a token they pasted in. Photos never come through here.

export interface SyncConfig { key: 'sync'; repo: string; token: string; branch: string; lastSync?: string }
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class SyncError extends Error {
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
    try { r = await fetchFn(u, init); } catch { throw new SyncError('network', 'Couldn’t reach GitHub — check the connection and try again.'); }
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

export const SETS_PATH = 'app/sets.csv', BODY_PATH = 'app/body.csv', HISTORY_PATH = 'history.csv';

/** Pull everything first (a failed pull pushes nothing), merge — the phone wins where both sides have a value — then push. */
export async function sync(deps: {
  client: ReturnType<typeof repoClient>; sets: SetEntry[]; body: BodyDay[]; deleted: Set<string>;
  importSets: (e: SetEntry[]) => Promise<unknown>; importBody: (d: BodyDay[]) => Promise<unknown>; now: Date;
}): Promise<{ pulledSets: number; pulledBody: number; pushedSets: number; pushedBody: number }> {
  const { client } = deps;
  const history = await client.get(HISTORY_PATH);
  const remoteSets = await client.get(SETS_PATH);
  const remoteBody = await client.get(BODY_PATH);

  const have = new Set(deps.sets.map((e) => e.id));
  const incoming = new Map<string, SetEntry>();
  for (const f of [history, remoteSets]) {
    if (!f) continue;
    for (const e of parseCsv(f.text, 'backup').entries) if (!have.has(e.id) && !deps.deleted.has(e.id)) incoming.set(e.id, e);
  }
  const bodyBy = new Map(deps.body.map((d) => [d.date, d]));
  const bodyIn: BodyDay[] = [];
  for (const d of remoteBody ? parseBodyFile(remoteBody.text).days : []) {
    const mine = bodyBy.get(d.date);
    const fill: BodyDay = { date: d.date };
    for (const k of ['weight', 'calories', 'protein'] as const) if (d[k] != null && mine?.[k] == null) fill[k] = d[k];
    if (Object.keys(fill).length > 1) bodyIn.push(fill);
  }
  if (incoming.size) await deps.importSets([...incoming.values()]);
  if (bodyIn.length) await deps.importBody(bodyIn);

  const sets = [...deps.sets.filter((e) => !deps.deleted.has(e.id)), ...incoming.values()];
  const body = [...bodyBy.values()].map((d) => ({ ...d }));
  for (const d of bodyIn) { const cur = body.find((x) => x.date === d.date); if (cur) Object.assign(cur, d); else body.push(d); }
  const message = `Backup from phone ${deps.now.toISOString()}`;
  await client.upsert(SETS_PATH, toCsv(sets), message, remoteSets?.sha ?? null);
  await client.upsert(BODY_PATH, toBodyCsv(body), message, remoteBody?.sha ?? null);
  return { pulledSets: incoming.size, pulledBody: bodyIn.length, pushedSets: sets.length, pushedBody: body.length };
}
