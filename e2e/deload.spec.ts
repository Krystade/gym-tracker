import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';
import { deloadLog, SIM_LIFTS, simDay } from '../src/domain/learn/deloadSim.sample';

// Item 06 on Today: eight weeks of synthetic training, every lift about 6 % down in the last week (a known whole-body shift),
// energy below his usual: a light week is offered, never started by itself. Start it: one line says so, each card's target is
// the light week's (half the sets, ~10 % lighter), and a set logged is marked light. Not now: it stays away. Synthetic only.
// At the 13 mini's 375×812 with its notch (insets faked as in e2e/rotation).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/deload';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

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

/** Nothing off the side, and every button in the offer or the line a 44 px target. */
async function fits(page: Page, sel: string) {
  const bad = await page.evaluate((sel) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button`)) if (el.offsetHeight < 44) out.push(`${el.textContent} is ${el.offsetHeight}px tall`);
    for (const el of document.querySelectorAll(`${sel} *`)) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.textContent}`);
    }
    return out;
  }, sel);
  expect(bad).toEqual([]);
}

const WEEKS = 8, TODAY = simDay(WEEKS * 7);
const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
const SETS = deloadLog(1, SIM_LIFTS, { weeks: WEEKS, shift: (w) => (w === WEEKS - 1 ? -0.06 : 0) })
  .map((e) => `${e.date},${e.exercise},,${e.setNo},${e.weight},${e.reps},,,,sample`);
// His usual energy (4) on two early days, 2 three days ago; today's he taps.
const BODY = ['date,weight_lb,calories,protein_g,energy,edited_at', `${simDay(10)},,,,4,`, `${simDay(20)},,,,4,`, `${simDay(WEEKS * 7 - 3)},,,,2,`].join('\n');

async function setUp(page: Page) {
  await notched(page);
  await page.clock.install({ time: new Date(`${TODAY}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles([
    { name: 'sets.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...SETS].join('\n')) },
    { name: 'body.csv', mimeType: 'text/csv', buffer: Buffer.from(BODY) },
  ]);
  await expect(page.getByText(`✓ Imported ${SETS.length} new sets`)).toBeVisible();
  await expect(page.getByText(/Body data: 3 days/)).toBeVisible();
  await goto(page, 'Today');
  await page.getByRole('group', { name: 'Energy' }).getByRole('button', { name: '2', exact: true }).click();
}
const offer = (page: Page) => page.getByRole('group', { name: 'Light week' });

test('down across lifts with low energy: a light week is offered; started, the targets are the light week’s and sets are marked light', async ({ page }) => {
  await setUp(page);
  await expect(offer(page)).toBeVisible();
  await expect(offer(page)).toContainText('Down across your lifts');
  await expect(offer(page)).toContainText('energy is lower than usual (2 against 4)');
  await offer(page).scrollIntoViewIfNeeded();
  await fits(page, '.deload-suggest');
  await page.screenshot({ path: `${SHOTS}/offer.png` });

  await offer(page).getByRole('button', { name: 'Start light week' }).click();
  await expect(offer(page)).toBeHidden();
  const line = page.getByRole('status').filter({ hasText: 'Light week' });
  await expect(line).toContainText('half the sets');
  await fits(page, '.light-week');
  await line.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/light-line.png` });

  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  const card = page.locator('[data-card="bench press"]');
  const target = card.getByLabel('Target');
  await expect(target).toContainText('Light week:');
  await expect(target).toContainText('stop about 3 short');
  await page.screenshot({ path: `${SHOTS}/light-card.png` });
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.locator('.tag.light')).toHaveText('light week');

  // A reload keeps the week on (the tap is kept on this phone, and the log has a light set).
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Light week' })).toBeVisible();
  await expect(offer(page)).toBeHidden();
  // Ended early: the line goes, and the offer stays away as after Not now (he chose his normal training).
  await page.getByRole('status').filter({ hasText: 'Light week' }).getByRole('button', { name: 'End it' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Light week' })).toBeHidden();
  await expect(offer(page)).toBeHidden();
});

test('Not now hides the offer, and it stays hidden after a reload', async ({ page }) => {
  await setUp(page);
  await offer(page).getByRole('button', { name: 'Not now' }).click();
  await expect(offer(page)).toBeHidden();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Energy' })).toBeVisible();
  await expect(offer(page)).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Light week' })).toBeHidden();
});
