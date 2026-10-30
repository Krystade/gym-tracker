import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { goto } from './nav';
import { dataSettled } from './settle';

// The backup file (domain/backup): the log, the buddies and the photos in one JSON file, saved through the share sheet and
// restored onto a fresh phone. The share sheet is stood in for; generated images and the synthetic sample history only.

const card = (page: Page) => page.getByRole('region', { name: 'Backup file' });
const nudge = (page: Page) => page.getByRole('group', { name: 'Backup' });
const WALKED = { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] };

/** The share sheet, stood in for: each file handed to it, with its text. `refuse`: the next share wants a tap of its own. */
async function sharing(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { shared: { name: string; text: string }[]; refuse: boolean };
    w.shared = []; w.refuse = false;
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', { value: async (d: { files: File[] }) => {
      if (w.refuse) { w.refuse = false; throw new DOMException('no activation', 'NotAllowedError'); }
      w.shared.push({ name: d.files[0].name, text: await d.files[0].text() });
    } });
  });
}
const shared = (page: Page) => page.evaluate(() => (window as unknown as { shared: { name: string; text: string }[] }).shared);

// A generated image: no photo file is ever committed to this public repo.
async function png(page: Page, colour: string): Promise<Buffer> {
  const url = await page.evaluate((c) => {
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 400;
    const g = cv.getContext('2d')!; g.fillStyle = c; g.fillRect(0, 0, 300, 400);
    return cv.toDataURL('image/png');
  }, colour);
  return Buffer.from(url.split(',')[1], 'base64');
}
async function addPhoto(page: Page, date: string, colour: string) {
  await page.getByLabel('Photo date').fill(date);
  await page.getByLabel('From library').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await png(page, colour) });
  await expect(page.getByRole('img', { name: `Front, ${date}` }).first()).toBeVisible();
}

test('nudged on Photos at 3, saved through the share sheet, restored whole onto a fresh phone, and again without doubling', async ({ browser, page }) => {
  await sharing(page);
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'history.sample.csv'));
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await expect(card(page)).toContainText('No backup yet');

  await goto(page, 'Photos');
  await addPhoto(page, '2026-08-01', '#446');
  await addPhoto(page, '2026-09-20', '#664');
  await expect(nudge(page)).toHaveCount(0);
  await addPhoto(page, '2026-09-27', '#646');
  await expect(nudge(page)).toContainText('3 photos not backed up. Photos live only on this phone. Deleting the app or clearing website data and cookies wipes them.');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'screenshots/13-backup-nudge.png' });
  await nudge(page).getByRole('button', { name: 'Download backup' }).click();
  await expect(nudge(page).getByRole('status')).toContainText(/^✓ Saved gym-backup-\d{4}-\d{2}-\d{2}\.json/);
  await expect(nudge(page).getByRole('button')).toHaveCount(0);
  const [file] = await shared(page);
  const b = JSON.parse(file.text) as { sets: unknown[]; photos: { full: string; thumb: string }[] };
  expect([b.sets.length, b.photos.length]).toEqual([6, 3]);
  for (const p of b.photos) for (const img of [p.full, p.thumb]) expect([...Buffer.from(img, 'base64').subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]); // JPEGs

  await goto(page, 'Backup');
  await expect(card(page)).toContainText(/Last backup today .+ · 3 photos/);
  await page.screenshot({ path: 'screenshots/14-backup.png', fullPage: true });

  // A fresh phone: everything comes back; the same file again adds nothing.
  const ctx = await browser.newContext({ storageState: WALKED });
  const fresh = await ctx.newPage();
  await fresh.goto('/');
  await goto(fresh, 'Backup');
  const upload = { name: file.name, mimeType: 'application/json', buffer: Buffer.from(file.text) };
  await fresh.getByLabel('Restore from backup').setInputFiles(upload);
  await expect(card(fresh).getByRole('status')).toContainText(/^✓ Restored 6 sets, 3 photos/);
  await expect(fresh.getByText(/^6 sets ·/)).toBeVisible();
  await expect(card(fresh)).toContainText(/Last backup today .+ · 3 photos/); // the file restored counts as the last backup
  await fresh.getByLabel('Restore from backup').setInputFiles(upload);
  await expect(card(fresh).getByRole('status')).toHaveText('✓ Nothing new: it’s all here already.');
  await expect(fresh.getByText(/^6 sets ·/)).toBeVisible();
  await goto(fresh, 'Photos');
  await expect(fresh.getByRole('region', { name: 'Timeline' }).getByRole('img')).toHaveCount(3);
  await expect(nudge(fresh)).toHaveCount(0);
  await ctx.close();
});

test('a share sheet that wants its own tap gets Save; a file that isn’t a backup is refused; the GitHub token left from before goes', async ({ page }) => {
  await sharing(page);
  await page.goto('/');
  await goto(page, 'Backup');
  await dataSettled(page);
  await page.evaluate(() => { (window as unknown as { refuse: boolean }).refuse = true; });
  await card(page).getByRole('button', { name: 'Download backup' }).click();
  await expect(card(page).getByRole('status')).toContainText('Backup ready');
  await card(page).getByRole('button', { name: 'Save backup file' }).click();
  await expect(card(page).getByRole('status')).toContainText('Saved gym-backup-');
  expect(await shared(page)).toHaveLength(1);

  await page.getByLabel('Restore from backup').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from('{"tiers":{}}') });
  await expect(card(page).getByRole('status')).toHaveText('That isn’t a backup file.');

  // The GitHub backup's settings, as a phone that used it still has them: gone at the next launch.
  const token = (put: boolean) => page.evaluate((put) => new Promise((ok, no) => {
    const r = indexedDB.open('gym-tracker-shared');
    r.onerror = () => no(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', put ? 'readwrite' : 'readonly'), kv = tx.objectStore('kv');
      const q = put ? kv.put({ key: 'sync', repo: 'someone/backup', token: 'fake-e2e-token-not-real', branch: 'main' }) : kv.get('sync');
      tx.oncomplete = () => { r.result.close(); ok(put ? true : q.result ?? null); };
    };
  }), put);
  await token(true);
  expect(await token(false)).not.toBeNull();
  await page.reload();
  await expect.poll(() => token(false)).toBeNull();
  await goto(page, 'Backup');
  await expect(page.getByText(/GitHub|token/i)).toHaveCount(0);
});
