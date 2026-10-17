import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';

// Suggested today: a profile with history and no program, at the 13 mini's 375×812 with its notch (insets faked as in e2e/records).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/suggested';
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

async function fits(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll('input:not([type=hidden], [type=checkbox], [type=radio], [type=range]), select, textarea')) {
      if (el.getBoundingClientRect().width && parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`${el.getAttribute('aria-label')} under 16px`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('.suggested button')) if (el.offsetHeight < 44) out.push(`${el.textContent} is ${el.offsetHeight}px tall`);
    for (const el of document.querySelectorAll('.suggested *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.className}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
// Synthetic: upper-body days this week, nothing for legs, so legs lead.
const ROWS = ['2026-10-12', '2026-10-14'].flatMap((d) => ['Bench Press,,1,135,8', 'Bench Press,,2,135,8', 'Lat Pulldown,,1,120,10', 'Lat Pulldown,,2,120,10',
  'Cable Curl,,1,40,12', 'Cable Pushdown,,1,50,12'].map((r) => `${d},${r},,,,sample`));

test('no program: Today suggests a session from what the week is behind on; a tap starts a lift; not on a past day', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  await goto(page, 'Today');

  const card = page.getByRole('region', { name: 'Suggested today' });
  const rows = card.getByRole('list', { name: 'Suggested exercises' }).getByRole('listitem');
  await expect(card.getByRole('textbox', { name: 'Minutes' })).toHaveValue('45'); // no timed sessions to go by
  await expect(rows.first()).toBeVisible();
  const names = await rows.locator('b').allTextContents();
  expect(names.length).toBeGreaterThan(1);
  // The week trained chest, back and arms: it's behind on everything else (delts, legs, core), and suggests none of its lifts.
  for (const done of ['Bench Press', 'Lat Pulldown', 'Cable Curl', 'Cable Pushdown']) expect(names).not.toContain(done);
  expect(names).toContain('Leg Press');
  await expect(rows.first()).toContainText(/0\/2 · \d+–\d+ reps/);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1-suggested.png` });

  // Fewer minutes, fewer lifts.
  await card.getByRole('textbox', { name: 'Minutes' }).fill('15');
  await expect.poll(() => rows.count()).toBeLessThan(names.length);
  await card.getByRole('textbox', { name: 'Minutes' }).fill('45');
  await expect(rows).toHaveCount(names.length);

  // A tap opens that lift's card; a set logged counts on the row, and the list holds still.
  await rows.first().getByRole('button').click();
  const lift = page.locator(`[data-card="${names[0].toLowerCase()}"]`);
  await expect(lift).toBeVisible();
  await lift.getByRole('textbox', { name: 'Weight' }).fill('100');
  await lift.getByRole('textbox', { name: 'Reps' }).fill('10');
  await lift.getByRole('button', { name: /^Add set/ }).click();
  await expect(rows.first()).toContainText('1/2');
  expect(await rows.locator('b').allTextContents()).toEqual(names);
  await card.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/2-started.png` });

  // A past day has no suggestion.
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('Logging to a past day')).toBeVisible();
  await expect(card).toHaveCount(0);

  // With a program, the plan takes its place.
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByRole('region', { name: 'Today’s plan' })).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('a new profile with nothing logged gets no suggestion', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Suggested today' })).toHaveCount(0);
});
