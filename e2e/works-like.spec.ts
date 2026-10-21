import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto, statsSheet } from './nav';

// Round 15, stage 4: "Works like…" on a custom lift's page makes it count as a catalog lift, in Stats too, and the choice
// syncs to the other phone. Local Auth and Firestore emulators; synthetic users only.
const T = new Date('2026-10-14T18:00:00');
const PASSWORD = 'synthetic-pass-1';
const email = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.local`;
const account = (page: Page) => page.getByRole('region', { name: 'Account' });
const quads = (page: Page) => page.locator('.mrow[aria-label^="Quads:"] .mval');
/** Stats, its Muscles sheet open. */
const stats = async (page: Page) => { await goto(page, 'Stats'); await statsSheet(page, 'muscles'); };

async function phone(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.clock.install({ time: T });
  await page.goto('/');
  return page;
}
async function enter(page: Page, mail: string, how: 'Create account' | 'Sign in') {
  await goto(page, 'Account');
  await account(page).getByRole('textbox', { name: 'Email' }).fill(mail);
  await account(page).getByLabel('Password').fill(PASSWORD);
  await account(page).getByRole('button', { name: how }).click();
  await expect(account(page).getByRole('status')).toHaveText(/^Synced/);
}

test('Works like… makes a custom lift count as the catalog lift, in Stats, and on the other phone after a sync', async ({ browser }) => {
  const a = await phone(browser);
  await a.getByRole('button', { name: 'Add exercise' }).click();
  await a.getByRole('searchbox', { name: 'Search exercises' }).fill('Zercher Wobble');
  await a.getByRole('button', { name: 'Add “Zercher Wobble” as a new lift' }).click();
  for (let i = 0; i < 2; i++) {
    await a.getByRole('textbox', { name: 'Weight' }).first().fill('95');
    await a.getByRole('textbox', { name: 'Reps' }).first().fill('8');
    await a.getByRole('button', { name: 'Add set' }).first().click();
  }
  await expect(a.getByRole('list', { name: 'Sets for Zercher Wobble' }).getByRole('listitem')).toHaveCount(2);
  await stats(a);
  await expect(quads(a)).toHaveText(/^0 /);

  await goto(a, 'Lifts');
  await a.getByRole('button', { name: /^Zercher Wobble/ }).click();
  await expect(a.getByText('Muscles unknown')).toBeVisible();
  await a.getByRole('button', { name: 'Works like…' }).click();
  await a.getByRole('searchbox', { name: 'Search lifts it works like' }).fill('front squat');
  await a.screenshot({ path: 'screenshots/r15-works-like-pick.png' });
  await a.getByRole('group', { name: 'Lifts it works like' }).getByRole('button', { name: 'Front Squat', exact: true }).click();
  await expect(a.getByText(/^Works like Front Squat: quads · glutes ½ · hamstrings ½ · squat/)).toBeVisible();
  await a.screenshot({ path: 'screenshots/r15-works-like-set.png' });
  await stats(a);
  await expect(quads(a)).toHaveText(/^2 /);

  const mail = email();
  await enter(a, mail, 'Create account');
  const b = await phone(browser);
  await enter(b, mail, 'Sign in');
  await stats(b);
  await expect(quads(b)).toHaveText(/^2 /);

  // Automatic gives it back to its name: unknown again.
  await goto(a, 'Lifts');
  await a.getByRole('button', { name: /^Zercher Wobble/ }).click();
  await a.getByRole('button', { name: 'Works like…' }).click();
  await a.getByRole('button', { name: 'Automatic' }).click();
  await expect(a.getByText('Muscles unknown')).toBeVisible();
});
