import { describe, expect, it } from 'vitest';
import { fromB64, parseBuddiesFile, parseDeletedCsv, pathsFor, toBuddiesFile, repoClient, slugError, sync, SyncError, toB64, toDeletedCsv, TOKEN_URL, type SyncConfig } from './sync';
import { parseCsv, toCsv } from './csv';
import { parseBodyFile, toBodyCsv, type BodyDay } from './body';
import type { SetEntry } from './types';
import { setId } from './ids';
import { replacements, type Replaced, type Taken } from './replaced';
import { BUDDIES } from './buddies/roster';
import { choose, starter } from './buddies/gacha';
import type { MetaItems } from './cloud';

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

/** The phone's side when nothing changed on it during the pull: takes it all, handing each part to `on`; `fail` throws as a full disk would. */
const taking = (on: { sets?: (e: SetEntry[]) => void; body?: (d: BodyDay[]) => void; fail?: boolean } = {}) =>
  async (_base: unknown, taken: Taken) => {
    if (on.fail) throw new Error('disk full');
    on.sets?.(taken.importSets); on.body?.(taken.importBody);
    return { taken, replaced: [] as Replaced[], skipped: 0 };
  };

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
  it('retries once when GitHub answers 422 because another device created the file first', async () => {
    // Scripted: GET 404, PUT (no sha) 422, GET 200 with a sha, PUT (with sha) 201.
    const script: Response[] = [
      new Response('{}', { status: 404 }),
      new Response('{"message":"Invalid request.\\n\\n\\"sha\\" wasn\'t supplied."}', { status: 422 }),
      Response.json({ encoding: 'base64', content: toB64('theirs'), sha: 'abc' }),
      Response.json({}, { status: 201 }),
    ];
    const puts: { sha?: string }[] = [];
    const fetchFn = async (_url: string, init: RequestInit = {}): Promise<Response> => {
      if (init.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return script.shift()!;
    };
    await repoClient(CFG, fetchFn).upsert('app/new.csv', 'mine', 'm');
    expect(puts).toHaveLength(2);
    expect(puts[0].sha).toBeUndefined();
    expect(puts.at(-1)!.sha).toBe('abc');
  });
  it('does not retry a 422 that is not the sha race, and says what GitHub said', async () => {
    const script: Response[] = [new Response('{}', { status: 404 }), new Response('{"message":"path is too long"}', { status: 422 })];
    let puts = 0;
    const fetchFn = async (_url: string, init: RequestInit = {}): Promise<Response> => { if (init.method === 'PUT') puts++; return script.shift()!; };
    const err = await repoClient(CFG, fetchFn).upsert('app/new.csv', 'mine', 'm').then(() => null, (e: SyncError) => e);
    expect(err?.kind).toBe('other');
    expect(err?.message).toContain('422');
    expect(puts).toBe(1);
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
      apply: taking({ sets: (e) => got.sets.push(...e), body: (d) => got.body.push(...d) }), now: new Date('2026-09-30T12:00:00Z'),
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
    apply: taking(), now: new Date('2026-09-30T12:00:00Z'), ...over,
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
    await sync(deps(gh, [mine], { apply: taking({ sets: (e) => imported.push(...e) }) }));
    expect(ids(parseCsv(gh.store.get('app/sets.csv')!.text).entries)).toEqual(ids([theirs, mine]));
    expect(ids(imported)).toEqual([theirs.id]);
  });

  it('stops before pushing when the phone couldn’t save what was pulled', async () => {
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([set('2026-09-01')]), 'app/body.csv': toBodyCsv([{ date: '2026-09-01', weight: 180 }]) });
    await expect(sync(deps(gh, [], { apply: taking({ fail: true }) }))).rejects.toThrow(/saving/i);
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
    expect(pathsFor(null)).toEqual({ sets: 'app/sets.csv', body: 'app/body.csv', deleted: 'app/deleted.csv', history: 'history.csv', buddies: 'app/buddies.json' });
  });
  it('backs another profile up under profiles/<slug>/ and never reads history.csv', async () => {
    const gh = fakeGitHub({ 'history.csv': toCsv([set('2025-01-01', 'notes')]), 'app/sets.csv': toCsv([set('2026-09-01')]) });
    const got: SetEntry[] = [];
    const r = await sync({
      client: repoClient(CFG, gh.fetchFn), sets: [set('2026-09-29')], body: [{ date: '2026-09-29', weight: 120 }], deleted: new Set(),
      apply: taking({ sets: (e) => got.push(...e) }), now: new Date('2026-09-30T12:00:00Z'), paths: pathsFor('sam'),
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

describe('energy in the backup', () => {
  it('pulls energy for a day the phone has no energy for', async () => {
    const gh = fakeGitHub({ 'app/body.csv': 'date,weight_lb,calories,protein_g,energy\r\n2026-09-29,,,,3\r\n' });
    const got: BodyDay[] = [];
    await sync({ client: repoClient(CFG, gh.fetchFn), sets: [], body: [{ date: '2026-09-29', weight: 180 }], deleted: new Set(),
      apply: taking({ body: (d) => got.push(...d) }), now: new Date('2026-09-30T12:00:00Z') });
    expect(got).toEqual([{ date: '2026-09-29', energy: 3 }]);
    expect(gh.store.get('app/body.csv')!.text).toContain('2026-09-29,180,,,3');
  });
});

describe('edits in the backup (round 10)', () => {
  const run = async (gh: ReturnType<typeof fakeGitHub>, sets: SetEntry[], body: BodyDay[] = []) => {
    const got = { sets: [] as SetEntry[], body: [] as BodyDay[] };
    await sync({ client: repoClient(CFG, gh.fetchFn), sets, body, deleted: new Set(),
      apply: taking({ sets: (e) => got.sets.push(...e), body: (d) => got.body.push(...d) }), now: new Date('2026-09-30T12:00:00Z') });
    return got;
  };
  it('a set edited on another device since wins over the phone’s older copy, keeping its place in the day', async () => {
    const mine = { ...set('2026-09-29'), seq: 1_759_000_000_000 };
    const theirs = { ...mine, weight: 55, editedAt: Date.parse('2026-09-30T08:00:00Z') };
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([theirs]) });
    const got = await run(gh, [mine]);
    expect(got.sets).toEqual([{ ...theirs, seq: mine.seq }]);
    expect(parseCsv(gh.store.get('app/sets.csv')!.text).entries.map((x) => x.weight)).toEqual([55]);
  });
  it('the phone’s newer edit wins over the backup’s older one', async () => {
    const mine = { ...set('2026-09-29'), weight: 60, editedAt: Date.parse('2026-09-30T09:00:00Z') };
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([{ ...mine, weight: 55, editedAt: Date.parse('2026-09-30T08:00:00Z') }]) });
    const got = await run(gh, [mine]);
    expect(got.sets).toEqual([]);
    expect(parseCsv(gh.store.get('app/sets.csv')!.text).entries.map((x) => x.weight)).toEqual([60]);
  });
  it('a body field entered more recently on another device wins; an unstamped one only fills in', async () => {
    const gh = fakeGitHub({ 'app/body.csv': toBodyCsv([{ date: '2026-09-29', weight: 181, protein: 140, at: { weight: Date.parse('2026-09-30T08:00:00Z') } }]) });
    const got = await run(gh, [], [{ date: '2026-09-29', weight: 182, protein: 150, at: { weight: Date.parse('2026-09-30T07:00:00Z') } }]);
    expect(got.body).toEqual([{ date: '2026-09-29', weight: 181, at: { weight: Date.parse('2026-09-30T08:00:00Z') } }]);
    expect(parseBodyFile(gh.store.get('app/body.csv')!.text).days).toEqual([{ date: '2026-09-29', weight: 181, protein: 150, at: { weight: Date.parse('2026-09-30T08:00:00Z') } }]);
  });
});

describe('the backup’s copies replacing this phone’s (round 10)', () => {
  it('hands over the phone as it read it with what it takes, so this phone’s set and body field are kept; nothing for the same values', async () => {
    const mine = { ...set('2026-09-29'), seq: 1_759_000_000_000 }, same = { ...set('2026-09-28'), seq: 1_758_000_000_000 };
    const theirs = { ...mine, weight: 55, editedAt: Date.parse('2026-09-30T08:00:00Z') };
    const gh = fakeGitHub({
      'app/sets.csv': toCsv([theirs, { ...same, editedAt: Date.parse('2026-09-30T08:00:00Z') }]),
      'app/body.csv': toBodyCsv([{ date: '2026-09-29', weight: 181, at: { weight: Date.parse('2026-09-30T08:00:00Z') } }]),
    });
    const kept: Replaced[] = [];
    await sync({ client: repoClient(CFG, gh.fetchFn), sets: [mine, same], body: [{ date: '2026-09-29', weight: 182 }], deleted: new Set(), now: new Date('2026-09-30T12:00:00Z'),
      // As db applySynced does it, with nothing changed on the phone meanwhile.
      apply: async (base, taken, now) => { const replaced = replacements(base, taken, now); kept.push(...replaced); return { taken, replaced, skipped: 0 }; } });
    expect(kept.map((r) => [r.kind, r.mine])).toEqual([['set', mine], ['body', { weight: 182 }]]);
  });
});

describe('deleted.csv', () => {
  const T = Date.parse;
  it('holds each deleted set’s id and when it went, whatever the id’s text, oldest first', () => {
    const d = { 'notes|2025-01-01|curl, hammer|1': T('2026-09-02T10:00:00.123Z'), 'app|2026-09-02|bench "wide"|2': T('2026-09-01T10:00:00Z') };
    const text = toDeletedCsv(d);
    expect(text).toBe('id,deleted_at\r\n"app|2026-09-02|bench ""wide""|2",2026-09-01T10:00:00.000Z\r\n"notes|2025-01-01|curl, hammer|1",2026-09-02T10:00:00.123Z\r\n');
    expect(parseDeletedCsv(text)).toEqual({ deleted: d, errors: [] });
    expect(toDeletedCsv({})).toBe('id,deleted_at\r\n');
  });
  it('reads an id listed twice as its latest delete, and a file with nothing in it as no deletes', () => {
    expect(parseDeletedCsv('id,deleted_at\nx|1,2026-09-03T00:00:00Z\nx|1,2026-09-01T00:00:00Z\ny|1,2026-09-01T00:00:00Z\ny|1,2026-09-03T00:00:00Z\n').deleted)
      .toEqual({ 'x|1': T('2026-09-03T00:00:00Z'), 'y|1': T('2026-09-03T00:00:00Z') });
    expect(parseDeletedCsv('')).toEqual({ deleted: {}, errors: [] });
    expect(parseDeletedCsv('id,deleted_at\r\n')).toEqual({ deleted: {}, errors: [] });
  });
  it('reports a row it can’t read, and a header without both columns', () => {
    expect(parseDeletedCsv('id,deleted_at\nx|1,yesterday\n').errors).toEqual([{ row: 2, message: 'Bad deleted_at "yesterday"' }]);
    expect(parseDeletedCsv('id,deleted_at\n,2026-09-01T00:00:00Z\n').errors).toEqual([{ row: 2, message: 'Missing id' }]);
    expect(parseDeletedCsv('id,when\nx|1,2026-09-01T00:00:00Z\n').errors).toEqual([{ row: 1, message: 'Missing column deleted_at' }]);
  });
});

describe('deletes in the backup (round 10, 2b)', () => {
  const NOW = new Date('2026-09-30T12:00:00Z');
  const T1 = Date.parse('2026-09-10T08:00:00Z'), T2 = Date.parse('2026-09-20T08:00:00Z');
  type Opts = { deleted?: string[]; tombAt?: Record<string, number>; paths?: ReturnType<typeof pathsFor> };
  /** A sync whose phone side takes everything, keeping what it replaces as db applySynced does. */
  const run = async (gh: ReturnType<typeof fakeGitHub>, sets: SetEntry[], o: Opts = {}) => {
    const got = { sets: [] as SetEntry[], deleted: [] as string[], replaced: [] as Replaced[] };
    const r = await sync({
      client: repoClient(CFG, gh.fetchFn), sets, body: [], deleted: new Set(o.deleted ?? []), tombAt: o.tombAt, now: NOW, paths: o.paths,
      apply: async (base, taken, now) => {
        const replaced = replacements(base, taken, now);
        got.sets.push(...taken.importSets); got.deleted.push(...taken.deleteIds); got.replaced.push(...replaced);
        return { taken, replaced, skipped: 0 };
      },
    });
    return { r, got };
  };
  const inBackup = (gh: ReturnType<typeof fakeGitHub>, path = 'app/sets.csv') => ids(parseCsv(gh.store.get(path)!.text).entries);
  const deletesIn = (gh: ReturnType<typeof fakeGitHub>, path = 'app/deleted.csv') => { const f = gh.store.get(path); return f ? parseDeletedCsv(f.text).deleted : null; };
  const putsTo = (gh: ReturnType<typeof fakeGitHub>, path: string) => gh.calls.filter((x) => x.method === 'PUT' && x.url.includes(`/contents/${path}`)).length;

  it('a backup with no deleted.csv syncs as before, and gets none while nothing was deleted', async () => {
    const history = [set('2025-01-01', 'notes')], other = set('2026-09-01'), mine = set('2026-09-29');
    const gh = fakeGitHub({ 'history.csv': toCsv(history), 'app/sets.csv': toCsv([other]) });
    const { r, got } = await run(gh, [mine]);
    expect(ids(got.sets)).toEqual(ids([...history, other]));
    expect(r).toMatchObject({ pulledSets: 2, removedSets: 0, pushedSets: 3 });
    expect(gh.store.has('app/deleted.csv')).toBe(false);
    expect(putsTo(gh, 'app/deleted.csv')).toBe(0);
  });

  it('a set deleted on this phone goes into deleted.csv at the time it went, next to the deletes already there, and not twice', async () => {
    const gone = set('2026-09-20'), kept = set('2026-09-21'), before = set('2025-03-01', 'notes');
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([gone, kept]), 'app/deleted.csv': toDeletedCsv({ [before.id]: T1 }) });
    const { got } = await run(gh, [kept], { deleted: [gone.id], tombAt: { [gone.id]: T2 } });
    expect(got.sets).toEqual([]);
    expect(inBackup(gh)).toEqual([kept.id]);
    expect(deletesIn(gh)).toEqual({ [before.id]: T1, [gone.id]: T2 });
    const puts = putsTo(gh, 'app/deleted.csv');
    await run(gh, [kept], { deleted: [gone.id], tombAt: { [gone.id]: T2 } });
    expect(putsTo(gh, 'app/deleted.csv')).toBe(puts); // nothing new: the file stays as it is
  });

  it('a restore onto a fresh phone leaves out every set deleted elsewhere, from history.csv and sets.csv alike, and doesn’t push them back', async () => {
    const [h1, h2, h3] = [set('2025-01-01', 'notes'), set('2025-01-02', 'notes'), set('2025-01-03', 'notes')];
    const [s1, s2] = [set('2026-09-01'), set('2026-09-02')];
    const gh = fakeGitHub({ 'history.csv': toCsv([h1, h2, h3]), 'app/sets.csv': toCsv([h2, h3, s1, s2]), 'app/deleted.csv': toDeletedCsv({ [h1.id]: T1, [h2.id]: T1, [s1.id]: T2 }) });
    const { r, got } = await run(gh, []);
    expect(ids(got.sets)).toEqual(ids([h3, s2]));
    expect(r).toMatchObject({ pulledSets: 2, pushedSets: 2 });
    expect(inBackup(gh)).toEqual(ids([h3, s2]));
    expect(deletesIn(gh)).toEqual({ [h1.id]: T1, [h2.id]: T1, [s1.id]: T2 });
  });

  it('a set another device deleted goes from this phone, kept under Replaced by sync, and isn’t pushed back', async () => {
    const gone = set('2026-09-05'), kept = set('2026-09-06');
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([kept]), 'app/deleted.csv': toDeletedCsv({ [gone.id]: T1 }) });
    const { r, got } = await run(gh, [gone, kept]);
    expect(got.deleted).toEqual([gone.id]);
    expect(got.replaced.map((x) => [x.kind, x.kind === 'set' && x.mine, x.kind === 'set' && x.theirs])).toEqual([['set', gone, null]]);
    expect(r).toMatchObject({ pulledSets: 0, removedSets: 1, pushedSets: 1 });
    expect(inBackup(gh)).toEqual([kept.id]);
  });

  it('an edit made on this phone after another device deleted the set wins: the set stays and goes back up', async () => {
    const x = { ...set('2026-09-05'), weight: 60, editedAt: T2 };
    const gh = fakeGitHub({ 'app/deleted.csv': toDeletedCsv({ [x.id]: T1 }) });
    const { got } = await run(gh, [x]);
    expect(got.deleted).toEqual([]);
    expect(inBackup(gh)).toEqual([x.id]);
    expect(deletesIn(gh)).toEqual({ [x.id]: T1 }); // kept, so a device still holding the delete sees the edit is newer
    // That device, deleted at T1 with the set gone, takes the edited set back.
    const { got: other } = await run(gh, [], { deleted: [x.id], tombAt: { [x.id]: T1 } });
    expect(other.sets.map((s) => [s.id, s.weight])).toEqual([[x.id, 60]]);
  });

  it('a delete made on this phone after the backup’s last edit of the set wins over that edit', async () => {
    const x = { ...set('2026-09-05'), weight: 60, editedAt: T1 };
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([x]) });
    const { got } = await run(gh, [], { deleted: [x.id], tombAt: { [x.id]: T2 } });
    expect(got.sets).toEqual([]);
    expect(inBackup(gh)).toEqual([]);
    expect(deletesIn(gh)).toEqual({ [x.id]: T2 });
  });

  it('a set this phone still has in its old copy takes the backup’s edit made after another device’s delete, not the delete', async () => {
    const x = set('2026-09-05');
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([{ ...x, weight: 65, editedAt: T2 }]), 'app/deleted.csv': toDeletedCsv({ [x.id]: T1 }) });
    const { got } = await run(gh, [x]);
    expect(got.deleted).toEqual([]);
    expect(got.sets.map((s) => [s.id, s.weight])).toEqual([[x.id, 65]]);
  });

  it('a restore takes the edited copy of a set edited after its delete, over history.csv’s', async () => {
    const h = set('2025-01-01', 'notes');
    const gh = fakeGitHub({ 'history.csv': toCsv([h]), 'app/sets.csv': toCsv([{ ...h, weight: 65, editedAt: T2 }]), 'app/deleted.csv': toDeletedCsv({ [h.id]: T1 }) });
    const { got } = await run(gh, []);
    expect(got.sets.map((s) => [s.id, s.weight])).toEqual([[h.id, 65]]);
  });

  it('a set logged again under a deleted set’s id survives the old delete, on a fresh phone and on the phone that logged it', async () => {
    const relogged = { ...set('2026-09-15'), loggedAt: new Date(T2).toISOString(), seq: T2 };
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([relogged]), 'app/deleted.csv': toDeletedCsv({ [relogged.id]: T1 }) });
    expect((await run(gh, [])).got.sets.map((s) => s.id)).toEqual([relogged.id]); // the file has no seq: logged_at tells
    const { got } = await run(gh, [relogged], { deleted: [relogged.id], tombAt: { [relogged.id]: T1 } });
    expect(got.deleted).toEqual([]);
    expect(inBackup(gh)).toEqual([relogged.id]);
  });

  it('a set pulled from the backup and logged again under a deleted id keeps its logged time against the old delete', async () => {
    // Pulled earlier from another device's sets.csv, so its seq is a row number, not a time.
    const pulled = { ...set('2026-09-15'), loggedAt: new Date(T2).toISOString(), seq: 3 };
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([pulled]), 'app/deleted.csv': toDeletedCsv({ [pulled.id]: T1 }) });
    expect((await run(gh, [pulled])).got.deleted).toEqual([]);
  });

  it('a set Undo put back after its delete reached the backup goes up newer than that delete', async () => {
    const back = { ...set('2026-09-05'), restoredAt: T2 };
    const gh = fakeGitHub({ 'app/deleted.csv': toDeletedCsv({ [back.id]: T1 }) });
    expect((await run(gh, [back])).got.deleted).toEqual([]);
    expect(parseCsv(gh.store.get('app/sets.csv')!.text).entries.map((s) => [s.id, s.editedAt])).toEqual([[back.id, T2]]);
    expect((await run(gh, [])).got.sets.map((s) => s.id)).toEqual([back.id]);
  });

  it('a delete from before delete times goes up at the backup’s time for it, or else this sync’s', async () => {
    const a = set('2025-01-01', 'notes'), b = set('2025-01-02', 'notes');
    const gh = fakeGitHub({ 'history.csv': toCsv([a, b]), 'app/deleted.csv': toDeletedCsv({ [b.id]: T1 }) });
    const { got } = await run(gh, [], { deleted: [a.id, b.id] });
    expect(got.sets).toEqual([]);
    expect(deletesIn(gh)).toEqual({ [a.id]: NOW.getTime(), [b.id]: T1 });
  });

  it('refuses to overwrite a deleted.csv it can’t fully read', async () => {
    for (const text of ['id,deleted_at\r\nx|1,soon\r\n', 'id,when\r\nx|1,2026-09-01T00:00:00Z\r\n']) {
      const gh = fakeGitHub({ 'app/deleted.csv': text });
      await expect(run(gh, [set('2026-09-29')], { deleted: ['x|2'] })).rejects.toThrow(/app\/deleted\.csv/);
      expect(gh.calls.some((x) => x.method === 'PUT')).toBe(false);
    }
  });

  it('another profile keeps its own deleted.csv under profiles/<slug>/', async () => {
    const gone = set('2026-09-20');
    const gh = fakeGitHub({ 'app/deleted.csv': toDeletedCsv({ 'app|2026-01-01|squat|1': T1 }), 'profiles/sam/deleted.csv': toDeletedCsv({ [gone.id]: T1 }) });
    const { got } = await run(gh, [gone, set('2026-09-21')], { paths: pathsFor('sam') });
    expect(got.deleted).toEqual([gone.id]);
    expect(pathsFor('sam').deleted).toBe('profiles/sam/deleted.csv');
    expect(deletesIn(gh)).toEqual({ 'app|2026-01-01|squat|1': T1 });
    expect(gh.calls.some((x) => x.url.includes('/app/'))).toBe(false);
  });

  it('on a conflict, pulls again and keeps both the other writer’s deletes and this phone’s', async () => {
    const mineGone = set('2026-09-20'), theirsGone = set('2026-09-21'), kept = set('2026-09-22');
    const gh = fakeGitHub({ 'app/sets.csv': toCsv([mineGone, theirsGone, kept]) }, {}, (store) => {
      // Another device's sync lands between this one's read and its first write.
      store.set('app/deleted.csv', { text: toDeletedCsv({ [theirsGone.id]: T1 }), sha: 'other-1' });
      store.set('app/sets.csv', { text: toCsv([mineGone, kept]), sha: 'other-2' });
    });
    const { r, got } = await run(gh, [theirsGone, kept], { deleted: [mineGone.id], tombAt: { [mineGone.id]: T2 } });
    expect(got.deleted).toEqual([theirsGone.id]);
    expect(r).toMatchObject({ removedSets: 1, pushedSets: 1 });
    expect(inBackup(gh)).toEqual([kept.id]);
    expect(deletesIn(gh)).toEqual({ [theirsGone.id]: T1, [mineGone.id]: T2 });
  });
});

describe('history.csv, once and without twins (round 20)', () => {
  // A day pasted in on the phone ('notes') that history.csv also holds, from a converter run over the same notes ('log-csv').
  const row = (source: string, date: string, exercise: string, setNo: number, weight: number): SetEntry =>
    ({ id: setId(source, date, exercise, setNo), date, seq: seq++, exercise, setNo, weight, reps: 10, flags: [], source });
  const D = '2026-04-03';
  const pasted = [row('notes', D, 'Cable Curl', 1, 50), row('notes', D, 'Cable Curl', 2, 55), row('notes', D, 'Hanging Leg Raise', 1, 0)];
  const converted = [row('log-csv', D, 'Cable Curl', 1, 50), row('log-csv', D, 'Cable Curl', 2, 55), row('log-csv', D, 'Leg Raise', 1, 0)];
  const elsewhere = row('log-csv', '2026-04-10', 'Cable Curl', 1, 60);
  const run = async (gh: ReturnType<typeof fakeGitHub>, sets: SetEntry[], o: { deleted?: string[]; tombAt?: Record<string, number>; historySeen?: string } = {}) => {
    const got = { sets: [] as SetEntry[], deleted: [] as string[] };
    const r = await sync({
      client: repoClient(CFG, gh.fetchFn), sets, body: [], deleted: new Set(o.deleted ?? []), tombAt: o.tombAt, now: new Date('2026-10-20T12:00:00Z'), historySeen: o.historySeen,
      apply: async (_b, taken) => { got.sets.push(...taken.importSets); got.deleted.push(...taken.deleteIds); return { taken, replaced: [], skipped: 0 }; },
    });
    return { r, got };
  };

  it('leaves out history rows on a day and lift the phone already has from another import, renamed lifts too, and says how many', async () => {
    const gh = fakeGitHub({ 'history.csv': toCsv([...converted, elsewhere]) });
    const { r, got } = await run(gh, pasted);
    expect(ids(got.sets)).toEqual([elsewhere.id]);
    expect(r).toMatchObject({ pulledSets: 1, heldBack: 3, pushedSets: 4 });
    expect(ids(parseCsv(gh.store.get('app/sets.csv')!.text).entries)).toEqual(ids([...pasted, elsewhere]));
  });

  it('checks against the backup’s copy of the log too, on a phone that has nothing yet', async () => {
    const gh = fakeGitHub({ 'history.csv': toCsv(converted), 'app/sets.csv': toCsv(pasted) });
    const { r, got } = await run(gh, []);
    expect(ids(got.sets)).toEqual(ids(pasted));
    expect(r.heldBack).toBe(3);
  });

  it('pulls a history.csv once: the same file again brings back nothing the phone no longer has; a changed one is read again', async () => {
    const gh = fakeGitHub({ 'history.csv': toCsv([elsewhere]) });
    const first = await run(gh, []);
    expect(ids(first.got.sets)).toEqual([elsewhere.id]);
    expect(first.r.historySha).toBe('sha-history.csv-0');
    gh.store.delete('app/sets.csv'); // only history.csv could bring it back now
    const again = await run(gh, [], { historySeen: first.r.historySha });
    expect(again.got.sets).toEqual([]);
    gh.store.set('history.csv', { text: toCsv([elsewhere, row('log-csv', '2026-04-11', 'Cable Curl', 1, 65)]), sha: 'sha-history.csv-1' });
    gh.store.delete('app/sets.csv');
    const changed = await run(gh, [], { historySeen: first.r.historySha });
    expect(changed.got.sets.map((s) => s.date)).toEqual(['2026-04-10', '2026-04-11']);
    expect(changed.r.historySha).toBe('sha-history.csv-1');
  });

  it('after the duplicates are removed, neither history.csv nor an old backup still holding them brings them back, and deleted.csv lists them', async () => {
    const T = Date.parse('2026-10-20T11:00:00Z');
    const gh = fakeGitHub({ 'history.csv': toCsv(converted), 'app/sets.csv': toCsv([...pasted, ...converted]) });
    const tomb = Object.fromEntries(converted.map((e) => [e.id, T]));
    const { got } = await run(gh, pasted, { deleted: converted.map((e) => e.id), tombAt: tomb });
    expect(got.sets).toEqual([]);
    expect(ids(parseCsv(gh.store.get('app/sets.csv')!.text).entries)).toEqual(ids(pasted));
    expect(parseDeletedCsv(gh.store.get('app/deleted.csv')!.text).deleted).toEqual(tomb);
    // A fresh phone restoring from that backup gets the paste and none of the twins.
    expect(ids((await run(gh, [])).got.sets)).toEqual(ids(pasted));
  });
});

describe('Gym Buddies in the backup (buddies.json, plan §16 stage 2)', () => {
  const NOW = new Date('2026-10-29T12:00:00Z');
  const [b0, b1] = BUDDIES.filter((b) => b.rarity === 0).map((b) => b.id);
  const s1 = starter(b0, 1000, '2026-10-28', 'phone-a-s'), s2 = choose('buddy', b1, 2000, '2026-10-29', 'phone-b-c');
  const run = async (gh: ReturnType<typeof fakeGitHub>, local: MetaItems | null, paths = pathsFor(null)) => {
    const pulls: MetaItems[] = [];
    const r = await sync({ client: repoClient(CFG, gh.fetchFn), sets: [], body: [], deleted: new Set(), now: NOW, paths, apply: taking(),
      ...(local && { buddies: { local, apply: async (_b: MetaItems, p: MetaItems) => { pulls.push(p); } } }) });
    return { r, pulls };
  };
  const buddyPuts = (gh: ReturnType<typeof fakeGitHub>) => gh.calls.filter((c) => c.method === 'PUT' && c.url.includes('buddies.json')).length;
  it('a profile without buddies gets no file, and a sync that passes none leaves the backup’s alone', async () => {
    const gh = fakeGitHub();
    await run(gh, {});
    expect(gh.store.has('app/buddies.json')).toBe(false);
    const kept = toBuddiesFile({ 'buddy-start': '2026-10-01' });
    const gh2 = fakeGitHub({ 'app/buddies.json': kept });
    await run(gh2, null);
    expect(gh2.store.get('app/buddies.json')!.text).toBe(kept);
    expect(buddyPuts(gh2)).toBe(0);
  });
  it('two phones’ spends add up; the earliest start and the later lead win; per buddy, the later prefs', async () => {
    const theirs = { 'buddy-start': '2026-10-20', 'buddy-lead': { id: b1, at: 50 }, [`spend:${s2.id}`]: s2,
      buddies: { [b0]: { name: 'Old', at: 1 }, [b1]: { name: 'Bee', at: 5 } } };
    const mine = { 'buddy-start': '2026-10-28', 'buddy-lead': { id: b0, at: 40 }, [`spend:${s1.id}`]: s1, buddies: { [b0]: { name: 'Rex', at: 9 } } };
    const gh = fakeGitHub({ 'profiles/sam/buddies.json': toBuddiesFile(theirs) });
    const { r, pulls } = await run(gh, mine, pathsFor('sam'));
    const want = { 'buddy-start': '2026-10-20', 'buddy-lead': { id: b1, at: 50 }, [`spend:${s1.id}`]: s1, [`spend:${s2.id}`]: s2,
      buddies: { [b0]: { name: 'Rex', at: 9 }, [b1]: { name: 'Bee', at: 5 } } };
    expect(parseBuddiesFile(gh.store.get('profiles/sam/buddies.json')!.text)).toEqual(want);
    expect(pulls).toEqual([{ 'buddy-start': '2026-10-20', 'buddy-lead': { id: b1, at: 50 }, [`spend:${s2.id}`]: s2, buddies: want.buddies }]);
    expect(r.pulledBuddies).toBe(4);
    expect(gh.store.has('app/buddies.json')).toBe(false);
  });
  it('the same items again: nothing pulled, nothing written', async () => {
    const mine = { 'buddy-start': '2026-10-28', [`spend:${s1.id}`]: s1 };
    const gh = fakeGitHub({ 'app/buddies.json': toBuddiesFile(mine) });
    const { r, pulls } = await run(gh, mine);
    expect(pulls).toEqual([]);
    expect(r.pulledBuddies).toBe(0);
    expect(buddyPuts(gh)).toBe(0);
  });
  it('a malformed item in the backup is neither taken nor passed on; a file it can’t read stops the sync unchanged', async () => {
    const gh = fakeGitHub({ 'app/buddies.json': toBuddiesFile({ 'spend:x': { id: 'x', cost: -1 }, 'buddy-start': 'soon', [`spend:${s2.id}`]: { ...s2, id: 'other' } }) });
    const { pulls } = await run(gh, { [`spend:${s1.id}`]: s1 });
    expect(pulls).toEqual([]);
    expect(parseBuddiesFile(gh.store.get('app/buddies.json')!.text)).toEqual({ [`spend:${s1.id}`]: s1 });
    const bad = fakeGitHub({ 'app/buddies.json': '{"v":2}' });
    await expect(run(bad, { [`spend:${s1.id}`]: s1 })).rejects.toThrow(/Can’t read app\/buddies.json/);
    expect(bad.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
});
