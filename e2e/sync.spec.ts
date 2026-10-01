import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const HISTORY = readFileSync(path.join(import.meta.dirname, 'fixtures', 'history.sample.csv'), 'utf8');
const TOKEN = 'fake-e2e-token-not-real';

// Requests made through the service worker bypass page.route, and this test must never reach the real GitHub.
test.use({ serviceWorkers: 'block' });

test('private backup: save settings, sync through a mocked GitHub, token stays hidden', async ({ page }) => {
  const files = new Map<string, { text: string; sha: string }>([['history.csv', { text: HISTORY, sha: 'h0' }]]);
  const puts: { path: string; auth: string; message: string }[] = [];
  let reject = false;
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    if (reject) return route.fulfill({ status: 401, json: {} });
    const p = decodeURIComponent(new URL(req.url()).pathname.replace(/^\/repos\/someone\/backup\/contents\//, ''));
    if (req.method() === 'GET') {
      const f = files.get(p);
      return f ? route.fulfill({ json: { encoding: 'base64', content: Buffer.from(f.text).toString('base64'), sha: f.sha } }) : route.fulfill({ status: 404, json: {} });
    }
    const body = req.postDataJSON() as { content: string; message: string };
    puts.push({ path: p, auth: req.headers().authorization, message: body.message });
    files.set(p, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `s${puts.length}` });
    return route.fulfill({ status: 201, json: {} });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as unknown as { copied: string }).copied = t; } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  const card = page.getByRole('region', { name: 'Private backup' });
  await card.getByText('How to make a token').click();
  const link = card.getByRole('link', { name: 'Open GitHub’s token form' });
  await expect(link).toHaveAttribute('href', /^https:\/\/github\.com\/settings\/personal-access-tokens\/new\?.*contents=write/);
  await expect(link).toHaveAttribute('target', '_blank');
  await card.getByRole('textbox', { name: 'Repository' }).fill('someone/backup');
  await card.getByLabel('Access token').fill(TOKEN);
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText('Token saved');
  expect(await page.content()).not.toContain(TOKEN);

  await card.getByRole('button', { name: 'Sync now' }).click();
  await expect(card.getByRole('status')).toContainText('Synced: 6 sets');
  await expect(page.getByText(/^6 sets/)).toBeVisible();
  expect(puts.map((x) => x.path).sort()).toEqual(['app/body.csv', 'app/sets.csv']);
  for (const x of puts) { expect(x.auth).toBe(`Bearer ${TOKEN}`); expect(x.message).toMatch(/^Backup from phone /); }
  expect(files.get('app/sets.csv')!.text.split(/\r?\n/).filter(Boolean)).toHaveLength(7);
  await expect(card).toContainText('Last synced');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/13-sync.png', fullPage: true });

  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await expect(page.getByText('Copied the CSV to the clipboard')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).not.toContain(TOKEN);

  reject = true;
  await card.getByRole('button', { name: 'Sync now' }).click();
  await expect(card.getByRole('status')).toContainText('GitHub rejected the token');
  expect(await page.content()).not.toContain(TOKEN);
});
