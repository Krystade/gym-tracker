import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// A build with no push Worker configured (src/push/config.ts empty, as shipped until the owner fills it in) shows no
// notification controls anywhere and never calls a Worker, even signed in, from the Home Screen, with a rest running.
const T = new Date('2026-10-02T18:00:00');
const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();
const WORKER_ROUTES = /\/(subscribe|prefs|timer|activity|test|status)(\/|$)/;

// Once worker/SETUP.md has filled in src/push/config.ts, builds have push and this case no longer exists.
const configured = /\|\| '[^']+';/.test(readFileSync('src/push/config.ts', 'utf8'));

test('with no Worker configured there is no Notifications card and no push request', async ({ page }) => {
  test.skip(configured, 'src/push/config.ts names a Worker');
  // Look like the installed Home Screen app, where the card would otherwise show.
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? { ...mm(q), matches: true, media: q } as MediaQueryList : mm(q));
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  const calls: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (WORKER_ROUTES.test(u.pathname) || u.hostname.endsWith('workers.dev')) calls.push(r.url()); });
  await page.clock.install({ time: T });
  await page.goto('/');

  await nav(page, 'More');
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`push${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@test.local`);
  await account.getByLabel('Password').fill('synthetic-pass-1');
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByText(/^Signed in as/)).toBeVisible();

  // A set starts the rest timer, which would ask the Worker for a lock-screen alert.
  await nav(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill('135');
  await page.getByRole('textbox', { name: 'Reps' }).first().fill('8');
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText('Tap to close');

  await nav(page, 'More');
  await expect(page.getByRole('region', { name: 'Account' })).toBeVisible();
  await page.clock.runFor(5000); // past the 3 s activity debounce
  await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);
  await expect(page.getByText(/notification/i)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('gym-tracker:push'))).toBeNull();
  expect(calls).toEqual([]);
  await page.screenshot({ path: 'test-results/push-off-data.png', fullPage: true });
});
