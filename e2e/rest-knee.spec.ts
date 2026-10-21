import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { goto } from './nav';

// Item 17: the rest timer's "?" once his own knee is in use, and when his timed sets point outside the rests he has timed.
// Synthetic logs (coreSim.sample, seed 3, every set timed): rest-knee from a true knee of 1:30 at ~1:30 rests; rest-long
// from ~5:00 rests and little fatigue. On the 13 mini's 375×812 with its notch (insets faked as in e2e/rest-why).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/rest-knee';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);
const fx = (n: string) => path.join(import.meta.dirname, 'fixtures', n);

async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? BOTTOM : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) return route.abort();
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}

async function logBench(page: Page, file: string, day: string, rows: number) {
  await notched(page);
  await page.clock.install({ time: new Date(`${day}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(fx(file));
  // An import this size takes ~7 s (410 rows) to ~18 s (1098) on main as on this branch.
  await expect(page.getByText(`✓ Imported ${rows} new sets`)).toBeVisible({ timeout: 60_000 });
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  const card = page.locator('[data-card="bench press"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('200');
  await card.getByRole('textbox', { name: 'Reps' }).fill('8');
  await page.clock.pauseAt(new Date(`${day}T18:30:00`));
  await card.getByRole('button', { name: /^Add set/ }).click();
  return card;
}

test('his own knee, once in use, is the rest, and the “?” says it was learned, past it what 30 s more is worth, and its band', async ({ page }) => {
  const card = await logBench(page, 'rest-knee.sample.csv', '2024-08-28', 1098);
  const timer = page.getByRole('timer', { name: 'Rest' }), time = timer.locator('.rest-main b');
  const why = page.getByRole('dialog', { name: 'Why this rest' });
  await expect(time).toHaveText('1:25');
  await timer.getByRole('button', { name: 'Why this rest is 1:25' }).click();
  await expect(why.locator('li')).toHaveText([
    'Learned from your setspast it, 30 s more gains under 0.3 rep · likely 0:43–1:421:25',
  ]);
  await page.screenshot({ path: `${SHOTS}/1-learned-375.png` });
  await page.keyboard.press('Escape');

  // A set at RIR 0 after it: more to recover, said as his effort, not the research ±30 s.
  await card.getByRole('group', { name: 'RIR' }).getByRole('button', { name: '0' }).click();
  await card.getByRole('button', { name: /^Add set/ }).click();
  await timer.getByRole('button', { name: /^Why this rest is / }).click();
  await expect(why.locator('li').first()).toContainText('Learned from your sets');
  await expect(why.locator('li').nth(1)).toContainText('RIR 0');
  await expect(why.locator('li').nth(1)).toContainText('nearer failure: more to recover');
  await page.screenshot({ path: `${SHOTS}/2-learned-rir0-375.png` });
});

test('timed sets that point below every rest he has timed leave the research default, and the “?” says why', async ({ page }) => {
  await logBench(page, 'rest-long.sample.csv', '2024-03-30', 410);
  const timer = page.getByRole('timer', { name: 'Rest' }), time = timer.locator('.rest-main b');
  const why = page.getByRole('dialog', { name: 'Why this rest' });
  await expect(time).toHaveText('3:00');
  await timer.getByRole('button', { name: 'Why this rest is 3:00' }).click();
  await expect(why.locator('li')).toHaveText([
    'Research defaultbig lift · your sets point to under 3:06, shorter than the rests you’ve timed3:00',
  ]);
  await page.screenshot({ path: `${SHOTS}/3-default-375.png` });
});
