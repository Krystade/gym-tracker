import { describe, expect, it } from 'vitest';
import { fromB64, pathsFor, repoClient, slugError, sync, SyncError, toB64, TOKEN_URL, type SyncConfig } from './sync';
import { parseCsv, toCsv } from './csv';
import { parseBodyFile, toBodyCsv, type BodyDay } from './body';
import type { SetEntry } from './types';
import { setId } from './ids';

const CFG: SyncConfig = { key: 'sync', repo: 'someone/private-data', token: 'test-token-123', branch: 'main' };

/** An in-memory stand-in for the Contents API. */
function fakeGitHub(files: Record<string, string> = {}, fail: Partial<Record<string, number>> = {}, beforeFirstPut?: (store: Map<string, { text: string; sha: string }>) => void) {
  const store = new Map(Object.entries(files).map(([p, t]) => [p, { text: t, sha: `sha-${p}-0` }]));
  const calls: { method: string; url: string; headers: Record<string, string>; cache?: RequestCache; body?: { message: string; content: string; sha?: string; branch: string } }[] = [];
  let conflictOnce = fail.conflictOnce === 1;
  const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: init.headers as Record<string, string>, cache: init.cache, body });
    const path = decodeURIComponent(new URL(url).pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    const code = fail[`${method} ${path}`];
    if (code === -1) throw new TypeError('Failed to fetch');
    if (code) return new Response('{}', { status: code });
    if (method === 'GET') {
      const f = store.get(path);
      return f ? Response.json({ encoding: 'base64', content: toB64(f.text).replace(/(.{60})/g, '$1\n'), sha: f.sha }) : new Response('{}', { status: 404 });
    }
    if (beforeFirstPut) { const f = beforeFirstPut; beforeFirstPut = undefined; f(store); }
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
      importSets: async (e) => { got.sets.push(...e); return { added: e.length, updated: 0 }; }, importBody: async (d) => { got.body.push(...d); return true; },
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

  it('still backs up a set re-logged under a deleted set’s id', async () => {
    const relogged = set('2026-09-29');
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([{ ...relogged, weight: 99 }]) });
    await run(gh, [relogged], [], new Set([relogged.id]));
    const pushed = parseCsv(gh.store.get('app/sets.csv')!.text).entries;
    expect(pushed.map((x) => [x.id, x.weight])).toEqual([[relogged.id, 50]]);
  });

  it('pushes nothing when the pull fails', async () => {
    const gh = fakeGitHub({ 'history.csv': 'x' }, { 'GET app/sets.csv': 401 });
    await expect(run(gh, [set('2026-09-29')])).rejects.toMatchObject({ kind: 'auth' });
    expect(gh.calls.some((x) => x.method === 'PUT')).toBe(false);
  });
});

describe('Phase 8 review fixes', () => {
  const deps = (gh: ReturnType<typeof fakeGitHub>, sets: SetEntry[], over: Partial<Parameters<typeof sync>[0]> = {}) => ({
    client: repoClient(CFG, gh.fetchFn), sets, body: [] as BodyDay[], deleted: new Set<string>(),
    importSets: async () => ({ added: 0, updated: 0 }), importBody: async () => true, now: new Date('2026-09-30T12:00:00Z'), ...over,
  });

  it('never answers from the browser cache, so a second sync sees the sha the first one wrote', async () => {
    const gh = fakeGitHub({ 'app/sets.csv': 'a' });
    const c = repoClient(CFG, gh.fetchFn);
    await c.get('app/sets.csv');
    await c.upsert('app/sets.csv', 'b', 'm');
    expect(gh.calls.length).toBeGreaterThan(0);
    for (const x of gh.calls) expect(x.cache).toBe('no-store');
  });

  it('refuses to overwrite a backup file it can’t fully read', async () => {
    const good = set('2026-09-01');
    const badRow = toCsv([good]) + '2026-09-02,Cable Curl,,1,50,10,,superset,,backup,,\r\n';
    for (const files of <Record<string, string>[]>[
      { 'app/sets.csv': badRow },
      { 'app/sets.csv': toCsv([good]).replace('weight_lb', 'kilos') },
      { 'app/body.csv': 'date,mass\n2026-09-01,180\n' },
      { 'app/body.csv': 'date,weight_lb,calories,protein_g\n2026-09-01,abc,,\n' },
    ]) {
      const gh = fakeGitHub(files);
      await expect(sync(deps(gh, [set('2026-09-29')]))).rejects.toThrow(/app\/(sets|body)\.csv/);
      expect(gh.calls.some((x) => x.method === 'PUT')).toBe(false);
    }
  });

  it('on a conflict, pulls again and keeps what the other writer added', async () => {
    const theirs = set('2026-09-15'), mine = set('2026-09-29');
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([]) }, {}, (store) => {
      const cur = store.get('app/sets.csv')!;
      store.set('app/sets.csv', { text: toCsv([theirs]), sha: `${cur.sha}-other` });
    });
    const imported: SetEntry[] = [];
    await sync(deps(gh, [mine], { importSets: async (e) => { imported.push(...e); return { added: e.length, updated: 0 }; } }));
    expect(ids(parseCsv(gh.store.get('app/sets.csv')!.text).entries)).toEqual(ids([theirs, mine]));
    expect(ids(imported)).toEqual([theirs.id]);
  });

  it('stops before pushing when the phone couldn’t save what was pulled', async () => {
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([set('2026-09-01')]), 'app/body.csv': toBodyCsv([{ date: '2026-09-01', weight: 180 }]) });
    await expect(sync(deps(gh, [], { importSets: async () => null }))).rejects.toThrow(/saving/i);
    await expect(sync(deps(gh, [], { importBody: async () => false }))).rejects.toThrow(/saving/i);
    expect(gh.calls.some((x) => x.method === 'PUT')).toBe(false);
  });
});

describe('token link', () => {
  it('opens GitHub’s new-token form with a name, a year’s expiry and only Contents: write', () => {
    const u = new URL(TOKEN_URL);
    expect(u.origin + u.pathname).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(Object.fromEntries(u.searchParams)).toEqual({ name: 'Gym Tracker backup', description: 'Sync from the Gym Tracker app', expires_in: '366', contents: 'write' });
  });
});

describe('sync per profile', () => {
  it('keeps the first profile on app/ with history.csv', () => {
    expect(pathsFor(null)).toEqual({ sets: 'app/sets.csv', body: 'app/body.csv', history: 'history.csv' });
  });
  it('backs another profile up under profiles/<slug>/ and never reads history.csv', async () => {
    const gh = fakeGitHub({ 'history.csv': toCsv([set('2025-01-01', 'notes')]), 'app/sets.csv': toCsv([set('2026-09-01')]) });
    const got: SetEntry[] = [];
    const r = await sync({
      client: repoClient(CFG, gh.fetchFn), sets: [set('2026-09-29')], body: [{ date: '2026-09-29', weight: 120 }], deleted: new Set(),
      importSets: async (e) => { got.push(...e); return { added: e.length, updated: 0 }; }, importBody: async () => true,
      now: new Date('2026-09-30T12:00:00Z'), paths: pathsFor('sam'),
    });
    expect(got).toEqual([]);
    expect(r).toMatchObject({ pulledSets: 0, pushedSets: 1, pushedBody: 1 });
    expect([...gh.store.keys()].sort()).toEqual(['app/sets.csv', 'history.csv', 'profiles/sam/body.csv', 'profiles/sam/sets.csv']);
    expect(gh.calls.some((x) => x.url.includes('history.csv') || x.url.includes('/app/'))).toBe(false);
  });
  it('accepts only short, unique, lower-case slugs that aren’t app', () => {
    expect(slugError('sam', ['me'])).toBeNull();
    expect(slugError('sam-2', ['me', 'sam'])).toBeNull();
    for (const bad of ['', 'Sam', 'sam/..', 'a b', 'x'.repeat(31), 'app', 'profiles', 'me']) expect(slugError(bad, ['me']), bad).not.toBeNull();
  });
});

describe('Phase 11 review fixes', () => {
  it('refuses a deleted profile’s folder, which still holds its backup', () => {
    expect(slugError('sam', ['me'], ['sam'])).toMatch(/still holds an old backup/);
    expect(slugError('sam-2', ['me'], ['sam'])).toBeNull();
  });
});
