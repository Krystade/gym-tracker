import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from './nav';
import { DOCS } from './emu';
import { account, put, signedIn } from './seed';
import { asSets, convertedRows, DIFFERING, IDENTICAL, MONTH, PASTE, PASTE_ONLY, pasteRows, toCsv, TWINS } from './fixtures/dupes';

// Round 20: the same notes log imported twice. The import guards hold the second copy back; More → Duplicate imports removes
// one that got in anyway, through the store's delete, so it stays gone on every phone and through every re-import.
// Synthetic users, lifts and numbers only.
test.use({ serviceWorkers: 'block' });

const ALL = TWINS * 2 + PASTE_ONLY, KEPT = TWINS + PASTE_ONLY;
const file = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
const card = (page: Page) => page.getByRole('region', { name: 'Duplicate imports' });
const setCount = (page: Page, n: number) => expect(page.getByText(new RegExp(`^${n} sets ·`))).toBeVisible();
/** This phone's stored sets' sources, and its tombstones (the main profile's database). */
const stored = (page: Page) => page.evaluate(() => new Promise<{ sources: string[]; restored: number; tombs: string[] }>((ok, no) => {
  const r = indexedDB.open('gym-tracker');
  r.onerror = () => no(r.error);
  r.onsuccess = () => {
    const tx = r.result.transaction(['sets', 'config']);
    const sets = tx.objectStore('sets').getAll(), tomb = tx.objectStore('config').get('deleted');
    tx.oncomplete = () => {
      const xs = sets.result as { source: string; restoredAt?: number }[];
      ok({ sources: xs.map((x) => x.source).sort(), restored: xs.filter((x) => x.restoredAt).length, tombs: ((tomb.result as { ids?: string[] } | undefined)?.ids ?? []).sort() });
    };
  };
}));
const convertedIds = asSets(convertedRows).map((s) => s.id).sort();

test('Import CSV holds back a second import of the same days; Duplicate imports removes what got in anyway, and Undo puts it back', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as unknown as { copied: string }).copied = t; } } });
  });
  await page.clock.install({ time: new Date('2026-10-20T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(file('pasted.csv', toCsv(pasteRows)));
  await expect(page.getByText(`✓ Imported ${TWINS + PASTE_ONLY} new sets`)).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  // The converter's copy of the same days: held back, with the days and lifts named, renamed lift and all.
  await page.getByLabel('Import CSV').setInputFiles(file('converted.csv', toCsv(convertedRows)));
  const ask = page.getByRole('alert');
  await expect(ask).toContainText(`${TWINS} sets in this file are on days and lifts your log already has from another import`);
  await expect(ask).toContainText('Leg Raise (2 sets; in your log from notes as Hanging Leg Raise)');
  await expect(ask.getByRole('button', { name: 'Leave them out' })).toBeFocused();
  await ask.getByRole('button', { name: 'Leave them out' }).click();
  await expect(page.getByText('Nothing imported', { exact: true })).toBeVisible();
  await expect(page.getByText(`${TWINS} sets held back: already in your log from another import`)).toBeVisible();
  await setCount(page, KEPT);

  // Added anyway: now the log holds every set twice, and Duplicate imports finds them.
  await page.getByLabel('Import CSV').setInputFiles(file('converted.csv', toCsv(convertedRows)));
  await page.getByRole('alert').getByRole('button', { name: 'Add anyway' }).click();
  await expect(page.getByText(`✓ Imported ${TWINS} new sets`)).toBeVisible();
  await setCount(page, ALL);
  await expect(card(page)).toContainText(`${TWINS} sets came in twice, from two imports of the same 2 days.`);
  await expect(card(page)).toContainText(`${IDENTICAL} pairs match exactly; ${DIFFERING} differ`);
  await card(page).getByText(`${DIFFERING} that differ`).click();
  const pairs = card(page).getByRole('list', { name: 'Copies that differ' }).getByRole('listitem');
  await expect(pairs).toHaveCount(DIFFERING);
  await expect(pairs.first().locator('.replaced-pair p')).toHaveText([/^Keep · notes.*Incline Bench Press #1.*warm-up/, /^Remove · log-csv.*Incline Bench Press #1/]);
  await expect(pairs.nth(1).locator('.replaced-pair p')).toHaveText([/Keep · notes.*Hanging Leg Raise #1/, /Remove · log-csv.*Leg Raise #1/]);

  // Back up first: the whole log, both copies.
  await card(page).getByRole('button', { name: 'Back up first (export CSV)' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied?: string }).copied?.trim().split(/\r?\n/).length)).toBe(ALL + 1);

  // Nothing goes on the first tap; the second removes the converter's copies, each with its tombstone.
  await card(page).getByRole('button', { name: `Remove ${TWINS} duplicates` }).click();
  await setCount(page, ALL);
  await card(page).getByRole('alert').getByRole('button', { name: `Remove ${TWINS}` }).click();
  await expect(card(page).getByRole('status')).toContainText(`Removed ${TWINS} duplicate sets`);
  await setCount(page, KEPT);
  let db = await stored(page);
  expect(db.sources).toEqual(Array(KEPT).fill(PASTE));
  expect(db.tombs).toEqual(convertedIds);

  // Undo, after a trip to another tab: every set back, stamped, no tombstone left; and the card offers the removal again.
  await goto(page, 'History');
  await goto(page, 'Backup');
  await card(page).getByRole('button', { name: `Undo: put ${TWINS} sets back` }).click();
  await setCount(page, ALL);
  db = await stored(page);
  expect(db).toMatchObject({ restored: TWINS, tombs: [] });
  await expect(card(page).getByRole('button', { name: `Remove ${TWINS} duplicates` })).toBeVisible();
});

// ---- Two phones on one account (the private emulator): the removal sticks everywhere. ----

const T = new Date('2026-10-20T18:00:00');
const acct = (page: Page) => page.getByRole('region', { name: 'Account' });
async function syncNow(page: Page) {
  await goto(page, 'Account');
  await acct(page).getByRole('button', { name: 'Sync now' }).click();
  await expect(acct(page).getByRole('status')).toHaveText(/^Synced/);
  await goto(page, 'Backup'); // the counts and Duplicate imports are Backup's
}
type Value = { stringValue?: string; mapValue?: { fields?: Record<string, Value> }; arrayValue?: { values?: Value[] } };
/** The account's month as the cloud has it: its sets' sources and the ids its deletes list. */
async function cloudMonth(request: APIRequestContext, uid: string) {
  const res = await request.get(`${DOCS}/users/${uid}/months/${MONTH}`, { headers: { Authorization: 'Bearer owner' } });
  const f = ((await res.json()) as { fields: Record<string, Value> }).fields;
  return {
    sources: (f.sets.arrayValue?.values ?? []).map((v) => v.mapValue!.fields!.source.stringValue!).sort(),
    deleted: Object.keys(f.deleted.mapValue?.fields ?? {}).sort(),
  };
}

test('removed on one phone: gone on the other, never sent back up by it, and not brought back by a CSV re-import', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const me = await account(request);
  const at = Date.now();
  await put(request, `users/${me.uid}/months/${MONTH}`, { sets: asSets([...pasteRows, ...convertedRows]), body: [], deleted: {}, updatedAt: at });
  await put(request, `users/${me.uid}/meta/index`, { months: { [MONTH]: at } });
  const a = await signedIn(browser, me, T), b = await signedIn(browser, me, T);
  for (const p of [a, b]) { await goto(p, 'Backup'); await setCount(p, ALL); }

  await card(a).getByRole('button', { name: `Remove ${TWINS} duplicates` }).click();
  await card(a).getByRole('alert').getByRole('button', { name: `Remove ${TWINS}` }).click();
  await setCount(a, KEPT);
  await syncNow(a);
  expect(await cloudMonth(request, me.uid)).toEqual({ sources: Array(KEPT).fill(PASTE), deleted: convertedIds });

  // B, still holding every set in its database, syncs: it takes the deletes rather than sending its copies back up.
  await syncNow(b);
  await setCount(b, KEPT);
  await expect(card(b)).toHaveCount(0);
  for (const p of [b, a]) { await p.reload(); await syncNow(p); await setCount(p, KEPT); }
  expect(await cloudMonth(request, me.uid)).toEqual({ sources: Array(KEPT).fill(PASTE), deleted: convertedIds });
  expect((await stored(b)).tombs).toEqual(convertedIds);

  // A CSV of the converter's rows: held back. Added anyway, the next sync takes them out again (the cloud's delete is newer).
  await b.getByLabel('Import CSV').setInputFiles(file('converted.csv', toCsv(convertedRows)));
  await b.getByRole('alert').getByRole('button', { name: 'Leave them out' }).click();
  await setCount(b, KEPT);
  await b.getByLabel('Import CSV').setInputFiles(file('converted.csv', toCsv(convertedRows)));
  await b.getByRole('alert').getByRole('button', { name: 'Add anyway' }).click();
  await expect(b.getByText(`✓ Imported ${TWINS} new sets`)).toBeVisible(); // the count may already be back by the time it's read
  await syncNow(b);
  await setCount(b, KEPT);
  expect(await cloudMonth(request, me.uid)).toEqual({ sources: Array(KEPT).fill(PASTE), deleted: convertedIds });
});
