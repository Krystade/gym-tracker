import { describe, expect, it } from 'vitest';
import { fromB64, repoClient, sync, SyncError, toB64, type SyncConfig } from './sync';
import { parseCsv, toCsv } from './csv';
import { parseBodyFile, toBodyCsv, type BodyDay } from './body';
import type { SetEntry } from './types';
import { setId } from './ids';

const CFG: SyncConfig = { key: 'sync', repo: 'someone/private-data', token: 'test-token-123', branch: 'main' };

/** An in-memory stand-in for the Contents API. */
function fakeGitHub(files: Record<string, string> = {}, fail: Partial<Record<string, number>> = {}) {
  const store = new Map(Object.entries(files).map(([p, t]) => [p, { text: t, sha: `sha-${p}-0` }]));
  const calls: { method: string; url: string; headers: Record<string, string>; body?: { message: string; content: string; sha?: string; branch: string } }[] = [];
  let conflictOnce = fail.conflictOnce === 1;
  const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: init.headers as Record<string, string>, body });
    const path = decodeURIComponent(new URL(url).pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    const code = fail[`${method} ${path}`];
    if (code === -1) throw new TypeError('Failed to fetch');
    if (code) return new Response('{}', { status: code });
    if (method === 'GET') {
      const f = store.get(path);
      return f ? Response.json({ encoding: 'base64', content: toB64(f.text).replace(/(.{60})/g, '$1\n'), sha: f.sha }) : new Response('{}', { status: 404 });
    }
    const cur = store.get(path);
    if (conflictOnce && path === 'app/body.csv') { conflictOnce = false; store.set(path, { text: cur?.text ?? '', sha: `${cur?.sha ?? 'x'}-moved` }); return new Response('{}', { status: 409 }); }
    if (cur && body.sha !== cur.sha) return new Response('{}', { status: 409 });
    store.set(path, { text: fromB64(body.content), sha: `sha-${path}-${calls.length}` });
    return Response.json({}, { status: cur ? 200 : 201 });
  };
  return { fetchFn, calls, store };
}

let seq = 0;
// Ids follow the CSV's own rule (source, date, exercise, set), so they survive the round trip through a file.
const set = (date: string, source = 'app', setNo = 1): SetEntry => ({ id: setId(source, date, 'Cable Curl', setNo), date, seq: seq++, exercise: 'Cable Curl', setNo, weight: 50, reps: 10, flags: [], source });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe('base64', () => {
  it('round-trips UTF-8', () => {
    const t = 'note: 80 × 8 – felt it’s fine 💪\r\nnext';
    expect(fromB64(toB64(t))).toBe(t);
    expect(fromB64(toB64(t).replace(/(.{10})/g, '$1\n'))).toBe(t);
  });
});

describe('repoClient', () => {
  it('talks only to api.github.com with the bearer token', async () => {
    const gh = fakeGitHub({ 'app/sets.csv': 'a' });
    const c = repoClient(CFG, gh.fetchFn);
    expect(await c.get('app/sets.csv')).toEqual({ text: 'a', sha: 'sha-app/sets.csv-0' });
    expect(await c.get('missing.csv')).toBeNull();
    for (const x of gh.calls) {
      expect(new URL(x.url).origin).toBe('https://api.github.com');
      expect(x.url).toContain('/repos/someone/private-data/contents/');
      expect(x.url).toContain('ref=main');
      expect(x.headers.Authorization).toBe('Bearer test-token-123');
    }
  });
  it('creates without a sha, updates with it, and retries once on a conflict', async () => {
    const gh = fakeGitHub({ 'app/body.csv': 'old' }, { conflictOnce: 1 });
    const c = repoClient(CFG, gh.fetchFn);
    await c.upsert('app/new.csv', 'new', 'm');
    await c.upsert('app/body.csv', 'fresh', 'm');
    const puts = gh.calls.filter((x) => x.method === 'PUT');
    expect(puts[0].body).toMatchObject({ message: 'm', branch: 'main' });
    expect(puts[0].body!.sha).toBeUndefined();
    expect(gh.store.get('app/body.csv')!.text).toBe('fresh');
    expect(puts.at(-1)!.body!.sha).toBe('sha-app/body.csv-0-moved');
  });
  it('says what went wrong', async () => {
    const kind = async (code: number) => {
      const c = repoClient(CFG, fakeGitHub({}, { 'GET x.csv': code }).fetchFn);
      try { await c.get('x.csv'); return 'none'; } catch (e) { return (e as SyncError).kind; }
    };
    expect(await kind(401)).toBe('auth');
    expect(await kind(403)).toBe('access');
    expect(await kind(-1)).toBe('network');
    expect(await kind(500)).toBe('other');
  });
});

describe('sync', () => {
  const run = async (gh: ReturnType<typeof fakeGitHub>, local: SetEntry[], body: BodyDay[] = [], deleted = new Set<string>()) => {
    const got = { sets: [] as SetEntry[], body: [] as BodyDay[] };
    const r = await sync({
      client: repoClient(CFG, gh.fetchFn), sets: local, body, deleted,
      importSets: async (e) => { got.sets.push(...e); }, importBody: async (d) => { got.body.push(...d); },
      now: new Date('2026-09-30T12:00:00Z'),
    });
    return { r, got };
  };

  it('pulls new sets from the backup and history.csv, then pushes the union', async () => {
    const mine = [set('2026-09-29')];
    const history = [set('2025-01-01', 'notes'), set('2025-01-02', 'notes')];
    const other = set('2026-09-01');
    const gh = fakeGitHub({ 'history.csv': toCsv(history), 'app/sets.csv': toCsv([other, mine[0]]), 'app/body.csv': toBodyCsv([{ date: '2026-09-01', weight: 180 }]) });
    const { r, got } = await run(gh, mine, [{ date: '2026-09-29', weight: 182 }]);
    expect(ids(got.sets)).toEqual(ids([...history, other]));
    expect(r).toMatchObject({ pulledSets: 3, pulledBody: 1, pushedSets: 4, pushedBody: 2 });
    expect(ids(parseCsv(gh.store.get('app/sets.csv')!.text).entries)).toEqual(ids([...mine, ...history, other]));
    expect(parseBodyFile(gh.store.get('app/body.csv')!.text).days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-29']);
    expect(gh.calls.some((x) => x.method === 'PUT' && x.url.includes('history.csv'))).toBe(false);
    for (const x of gh.calls.filter((c) => c.method === 'PUT')) expect(x.body!.message).toBe('Backup from phone 2026-09-30T12:00:00.000Z');
  });

  it('keeps the phone’s value for a body field both sides have, and fills in the rest', async () => {
    const gh = fakeGitHub({ 'app/body.csv': toBodyCsv([{ date: '2026-09-29', weight: 175, protein: 150 }]) });
    const { got } = await run(gh, [], [{ date: '2026-09-29', weight: 182 }]);
    expect(got.body).toEqual([{ date: '2026-09-29', protein: 150 }]);
    expect(parseBodyFile(gh.store.get('app/body.csv')!.text).days).toEqual([{ date: '2026-09-29', weight: 182, protein: 150 }]);
  });

  it('never brings back a set deleted on the phone', async () => {
    const gone = set('2025-01-01', 'notes'), kept = set('2025-01-02', 'notes');
    const gh = fakeGitHub({ 'history.csv': toCsv([gone, kept]) });
    const { got } = await run(gh, [], [], new Set([gone.id]));
    expect(ids(got.sets)).toEqual([kept.id]);
    expect(ids(parseCsv(gh.store.get('app/sets.csv')!.text).entries)).toEqual([kept.id]);
  });

  it('pushes nothing when the pull fails', async () => {
    const gh = fakeGitHub({ 'history.csv': 'x' }, { 'GET app/sets.csv': 401 });
    await expect(run(gh, [set('2026-09-29')])).rejects.toMatchObject({ kind: 'auth' });
    expect(gh.calls.some((x) => x.method === 'PUT')).toBe(false);
  });
});
