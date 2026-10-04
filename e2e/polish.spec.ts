import { expect, test, type Page } from '@playwright/test';

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
const day = (i: number) => new Date(Date.UTC(2026, 7, 19 + i * 3)).toISOString().slice(0, 10); // Aug 19 … Wed, Sep 30

// Synthetic Bench Press history, heavy enough that its next target comes with warm-ups.
async function seed(page: Page, now = '2026-10-02T18:00:00') {
  await page.clock.install({ time: new Date(now) });
  await page.goto('/');
  const rows = Array.from({ length: 15 }, (_, i) => `${day(i)},Bench Press,,1,${135 + 5 * i},8,,,,sample`);
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText('✓ Imported 15 new sets')).toBeVisible();
}

const box = async (page: Page, sel: ReturnType<Page['locator']>) => (await sel.boundingBox())!;

test('a typed name to add as a new lift comes after the lifts it matches, not before them', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('bench');
  const list = page.locator('.picker-list');
  await expect(list.getByRole('button').first()).toHaveText(/^Bench Press/);
  const add = list.getByRole('button', { name: 'Add “bench” as a new lift' });
  await expect(add).toBeVisible();
  await expect(add).not.toHaveClass(/primary/);
  // With nothing matching, it is the one thing to do, so it leads.
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('zzqx');
  await expect(list.getByRole('button').first()).toHaveText('Add “zzqx” as a new lift');
  await expect(list.getByRole('button').first()).toHaveClass(/primary/);
});

test('the program builder describes days that vary their lifts', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await expect(page.getByText(/different lift/)).toBeVisible();
  await expect(page.getByText(/repeats on every day/)).toHaveCount(0);
});

test('dates this year leave the year off on Lifts, the lift’s history and Today’s last line', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Lifts' }).click();
  await expect(page.getByRole('button', { name: /Bench Press/ })).toContainText('last Wed, Sep 30');
  await expect(page.getByRole('button', { name: /Bench Press/ })).not.toContainText('2026');
  await page.getByRole('button', { name: /Bench Press/ }).click();
  await expect(page.locator('p > b', { hasText: /^Wed, Sep 30$/ })).toBeVisible(); // the session heading in History
  await expect(page.getByText('Sep 30, 2026')).toHaveCount(0);
  await page.getByRole('button', { name: 'Log it today' }).click();
  await expect(page.getByText(/^Last \(Wed, Sep 30\):/)).toBeVisible();
});

test('a date from another year keeps its year', async ({ page }) => {
  await seed(page, '2027-01-05T18:00:00');
  await page.getByRole('button', { name: 'Lifts' }).click();
  await expect(page.getByRole('button', { name: /Bench Press/ })).toContainText('last Sep 30, 2026');
});

test('the rep-max chips sit under the estimate they change, above the other tiles', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Bench Press/ }).click();
  const est = await box(page, page.locator('.tile', { hasText: 'Est. 6RM' }));
  const chips = await box(page, page.getByRole('group', { name: 'Rep max' }));
  const best = await box(page, page.locator('.tile', { hasText: 'Best set' }));
  expect(chips.y).toBeGreaterThan(est.y + est.height - 1);
  expect(chips.y + chips.height).toBeLessThan(best.y);
});

test('the warm-up goes on its own line under the target', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Bench Press/ }).click();
  await page.getByRole('button', { name: 'Log it today' }).click();
  const target = page.getByLabel('Target');
  const warm = target.getByText(/^warm-up /);
  await expect(warm).toBeVisible();
  const t = await box(page, target.locator('> span'));
  const w = await box(page, warm);
  expect(w.y).toBeGreaterThan(t.y + 5); // a line of its own, not the end of the first
});

test('the plan header has no dead space, folded or open', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  const plan = page.getByRole('region', { name: 'Today’s plan' });
  const toggle = plan.locator('.plan-toggle');
  // Open: the length line follows the title closely.
  const len = await box(page, plan.getByLabel('Plan length'));
  const title = await box(page, toggle.locator('> span').first()); // the text, not the 44 px tap area around it
  expect(len.y - (title.y + title.height)).toBeLessThanOrEqual(6);
  // Folded: the card ends at its padding below the title.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const card = await box(page, plan);
  const t = await box(page, toggle);
  expect(card.y + card.height - (t.y + t.height)).toBeLessThanOrEqual(14);
});
