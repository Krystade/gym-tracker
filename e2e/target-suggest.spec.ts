import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';

// Suggested goal and priorities on Stats: nothing changes by itself; a tap takes one, Dismiss hides it until it changes.
// At the 13 mini's 375×812 with its notch (insets faked as in e2e/records).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/target-suggest';
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
    for (const el of document.querySelectorAll<HTMLElement>('.target-suggest button')) if (el.offsetHeight < 44) out.push(`${el.textContent} is ${el.offsetHeight}px tall`);
    for (const el of document.querySelectorAll('.target-suggest *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.className}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Synthetic: the 8 whole weeks before 12 October, on the given weekdays (0 = Monday), three sets of each lift. */
function rows(days: Record<number, string[]>, weeks = 8): string[] {
  const out: string[] = [];
  for (let w = 1; w <= weeks; w++) for (const [d, lifts] of Object.entries(days)) {
    const date = iso(new Date(Date.UTC(2026, 9, 12 - 7 * w + Number(d))));
    for (const lift of lifts) for (let i = 1; i <= 3; i++) out.push(`${date},${lift},,${i},100,10,,,,sample`);
  }
  return out;
}
async function importRows(page: Page, r: string[], name: string) {
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...r].join('\n')) });
  await expect(page.getByText(`✓ Imported ${r.length} new sets`)).toBeVisible();
  await goto(page, 'Stats');
}

test('the weekly goal: suggested from the last 8 weeks, dismissed until it changes, then taken with a tap', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-14T18:00:00') });
  await page.goto('/');
  // Four sessions a week against the default goal of 2.
  await importRows(page, rows({ 0: ['Bench Press'], 1: ['Leg Press'], 3: ['Lat Pulldown'], 4: ['Cable Curl'] }), 'a.csv');
  const sug = page.getByRole('group', { name: 'Suggested goal' });
  const goal = page.getByRole('textbox', { name: 'Sessions per week goal' });
  await expect(goal).toHaveValue('2');
  await expect(sug).toContainText('Your last 8 weeks average 4 sessions a week.');
  await sug.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1-goal.png` });

  await sug.getByRole('button', { name: 'Dismiss' }).click();
  await expect(sug).toHaveCount(0);
  await expect(goal).toHaveValue('2'); // nothing changed by itself
  await page.reload();
  await goto(page, 'Stats');
  await expect(page.getByRole('heading', { name: 'Priorities' })).toBeVisible();
  await expect(sug).toHaveCount(0);

  // A fifth day a week: the suggestion is now 5, a new one, so it shows again.
  await importRows(page, rows({ 5: ['Cable Pushdown'] }), 'b.csv');
  await expect(sug).toContainText('average 5 sessions');
  await sug.getByRole('button', { name: 'Set goal to 5' }).click();
  await expect(goal).toHaveValue('5');
  await expect(sug).toHaveCount(0);
  await expect(page.getByText('Dashed line: your goal of 5 sessions.')).toBeVisible();
  await page.reload();
  await goto(page, 'Stats');
  await expect(goal).toHaveValue('5');
});

test('priorities: previewed from what was trained, applied with a tap, or dismissed until the suggestion changes', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-14T18:00:00') });
  await page.goto('/');
  await importRows(page, rows({ 0: ['Machine Chest Press', 'Lat Pulldown'], 2: ['Leg Extension', 'Cable Curl'] }), 'a.csv');
  const sug = page.getByRole('group', { name: 'Suggested priorities' });
  await expect(sug).toContainText(/priorities would change/);
  await expect(page.getByRole('combobox', { name: 'Chest', exact: true })).toHaveValue('3');

  // Preview first: the changes, and nothing applied yet.
  await sug.getByRole('button', { name: 'Fill from my history' }).click();
  const changes = sug.getByRole('list', { name: 'Priority changes' }).getByRole('listitem');
  await expect(changes.filter({ hasText: 'Chest' })).toHaveText(/Chest\s*3 → 1/);
  await expect(changes.filter({ hasText: 'Hamstrings' })).toHaveText(/Hamstrings\s*3 → 4/);
  await expect(page.getByRole('combobox', { name: 'Chest', exact: true })).toHaveValue('3');
  await sug.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/2-priorities-preview.png` });
  await sug.getByRole('button', { name: 'Cancel' }).click();
  await expect(changes).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Chest', exact: true })).toHaveValue('3');

  await sug.getByRole('button', { name: 'Fill from my history' }).click();
  await sug.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('combobox', { name: 'Chest', exact: true })).toHaveValue('1');
  await expect(page.getByRole('combobox', { name: 'Hamstrings' })).toHaveValue('4');
  await expect(sug).toHaveCount(0); // nothing left to suggest

  // Set one by hand: the same suggestion is back; dismissed, it stays gone through a reload and another edit.
  await page.getByRole('combobox', { name: 'Hamstrings' }).selectOption('1');
  await expect(sug).toContainText('1 priority would change.');
  await sug.getByRole('button', { name: 'Dismiss' }).click();
  await expect(sug).toHaveCount(0);
  await page.reload();
  await goto(page, 'Stats');
  await expect(page.getByRole('combobox', { name: 'Hamstrings' })).toHaveValue('1');
  await expect(sug).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Calves' }).selectOption('1');
  await expect(page.getByRole('combobox', { name: 'Calves' })).toHaveValue('1');
  await expect(sug).toHaveCount(0);
});
