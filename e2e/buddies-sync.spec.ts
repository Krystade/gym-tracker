import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';
import { dataSettled } from './settle';
import { BUDDIES } from '../src/domain/buddies/roster';

// Gym Buddies stage 2 (plan §16.10): each profile's buddies (prefs, lead, start, spends) are its own, go to its own folder of the
// GitHub backup as buddies.json, and come back onto a new phone with that profile. No UI yet: the items are put straight into
// each profile's database, as the stage 4 and 5 screens will.

const TOKEN = 'fake-e2e-token-not-real';
const ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`;
test.use({ serviceWorkers: 'block' }); // the mocked GitHub must see every request

const [c0, c1] = BUDDIES.filter((b) => b.rarity === 0).map((b) => b.id);
const spend = (id: string, got: string, at: number) => ({ id, at, day: '2026-10-29', kind: 'starter', banner: 'buddy', cost: 0, got, rarity: 0, refund: 0 });
const ME = { buddies: { [c0]: { name: 'Rex', at: 5 } }, lead: { id: c0, at: 6 }, start: '2026-10-28', spend: spend('me-s', c0, 7) };
const SAM = { buddies: { [c1]: { name: 'Bee', at: 8 } }, lead: { id: c1, at: 9 }, start: '2026-10-29', spend: spend('sam-s', c1, 10) };
type Kept = typeof ME;

/** The profile databases on this phone: main's is `gym-tracker`, another's `gym-tracker~<id>`. */
const dbNames = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name!).filter((n) => n === 'gym-tracker' || n.startsWith('gym-tracker~')).sort());
const idb = <T,>(page: Page, name: string, fn: string, arg?: unknown) => page.evaluate(async ([name, fn, arg]) => {
  const d = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(name as string); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = d.transaction('config', 'readwrite').objectStore('config');
  const req = <R,>(r: IDBRequest<R>) => new Promise<R>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const out = await (new Function('store', 'req', 'arg', `return (${fn as string})(store, req, arg)`))(store, req, arg);
  d.close();
  return out as T;
}, [name, fn, arg] as const);
const seed = (page: Page, name: string, k: Kept) => idb(page, name, `async (s, req, k) => {
  await req(s.put({ key: 'buddies', map: k.buddies })); await req(s.put({ key: 'buddy-lead', ...k.lead }));
  await req(s.put({ key: 'buddy-start', since: k.start })); await req(s.put({ key: 'spends', map: { [k.spend.id]: k.spend } }));
}`, k);
const kept = (page: Page, name: string) => idb<unknown>(page, name, `async (s, req) => {
  const [b, l, st, sp] = await Promise.all(['buddies', 'buddy-lead', 'buddy-start', 'spends'].map((k) => req(s.get(k))));
  return { buddies: b?.map, lead: l && { id: l.id, at: l.at }, start: st?.since, spend: sp && Object.values(sp.map)[0], spends: sp ? Object.keys(sp.map).length : 0 };
}`);

async function phone(browser: Browser, files: Map<string, string>) {
  const ctx = await browser.newContext({ baseURL: ORIGIN, serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin: ORIGIN, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const p = decodeURIComponent(new URL(req.url()).pathname.replace(/^\/repos\/someone\/backup\/contents\//, ''));
    if (req.method() === 'GET') {
      const f = files.get(p);
      return f != null ? route.fulfill({ json: { encoding: 'base64', content: Buffer.from(f).toString('base64'), sha: `${p}:${f.length}` } }) : route.fulfill({ status: 404, json: {} });
    }
    files.set(p, Buffer.from((req.postDataJSON() as { content: string }).content, 'base64').toString('utf8'));
    return route.fulfill({ status: 201, json: {} });
  });
  await page.goto('/');
  // Sam, backed up to profiles/sam/; then the backup's repo and token (shared by both).
  await goto(page, 'People');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  const bar = page.getByRole('group', { name: 'Who’s training' });
  await expect(bar.getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await goto(page, 'Backup');
  await dataSettled(page);
  const card = page.getByRole('region', { name: 'Private backup' });
  await card.getByRole('textbox', { name: 'Repository' }).fill('someone/backup');
  await card.getByLabel('Access token').fill(TOKEN);
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText('Token saved');
  const syncAs = async (who: 'Me' | 'Sam') => {
    await bar.getByRole('button', { name: new RegExp(who) }).click();
    await expect(bar.getByRole('button', { name: new RegExp(who) })).toHaveAttribute('aria-pressed', 'true');
    await card.getByRole('button', { name: 'Sync now' }).click();
    await expect(card.getByRole('status')).toContainText('Synced:');
  };
  const names = await dbNames(page);
  expect(names).toHaveLength(2);
  return { ctx, page, syncAs, main: 'gym-tracker', sam: names.find((n) => n !== 'gym-tracker')! };
}

test('two profiles’ buddies: each to its own buddies.json, and back onto a new phone with that profile', async ({ browser }) => {
  const files = new Map<string, string>();
  const a = await phone(browser, files);
  await seed(a.page, a.main, ME);
  await seed(a.page, a.sam, SAM);
  await a.syncAs('Me');
  await a.syncAs('Sam');
  const items = (p: string) => (JSON.parse(files.get(p)!) as { v: number; items: Record<string, unknown> }).items;
  expect(items('app/buddies.json')).toEqual({ buddies: ME.buddies, 'buddy-lead': ME.lead, 'buddy-start': ME.start, 'spend:me-s': ME.spend });
  expect(items('profiles/sam/buddies.json')).toEqual({ buddies: SAM.buddies, 'buddy-lead': SAM.lead, 'buddy-start': SAM.start, 'spend:sam-s': SAM.spend });

  // A new phone: each profile gets its own back, and nothing of the other's.
  const b = await phone(browser, files);
  expect(await kept(b.page, b.sam)).toMatchObject({ spends: 0 });
  await b.syncAs('Sam');
  await b.syncAs('Me');
  expect(await kept(b.page, b.main)).toEqual({ ...ME, spends: 1 });
  expect(await kept(b.page, b.sam)).toEqual({ ...SAM, spends: 1 });

  // A spend made on the new phone and one on the old add up on both, with the old phone's later rename kept.
  await idb(b.page, b.main, `async (s, req, x) => { const r = await req(s.get('spends')); await req(s.put({ key: 'spends', map: { ...r.map, [x.id]: x } })); }`, spend('me-b', c1, 20));
  await b.syncAs('Me');
  await idb(a.page, a.main, `async (s, req) => { await req(s.put({ key: 'buddies', map: { ${JSON.stringify(c0)}: { name: 'Rexy', at: 30 } } })); }`);
  await a.syncAs('Me');
  await b.syncAs('Me');
  for (const p of [a, b]) expect(await kept(p.page, p.main)).toMatchObject({ buddies: { [c0]: { name: 'Rexy', at: 30 } }, spends: 2 });
  expect(Object.keys(items('app/buddies.json')).filter((k) => k.startsWith('spend:')).sort()).toEqual(['spend:me-b', 'spend:me-s']);
  expect(await kept(a.page, a.sam)).toEqual({ ...SAM, spends: 1 });
  await a.ctx.close(); await b.ctx.close();
});
