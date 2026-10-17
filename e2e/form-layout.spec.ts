import { expect, test, type Locator, type Page } from '@playwright/test';

const T = new Date('2026-10-02T18:00:00');
const addLift = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}( · logged)?$`) }).click();
};
const box = async (l: Locator) => (await l.boundingBox())!;
/** `b` starts below where `a` ends: on a line of its own, not beside or over it. */
const below = async (a: Locator, b: Locator) => {
  const [x, y] = [await box(a), await box(b)];
  expect(y.y).toBeGreaterThanOrEqual(x.y + x.height - 0.5);
};

test('Delete has its own line in the set editor, apart from Cancel and Save, and Undo still brings the set back', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Bench Press');
  await page.getByRole('textbox', { name: 'Weight' }).fill('135');
  await page.getByRole('button', { name: 'Add set' }).click();
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  await rows.first().getByRole('button').click();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  const del = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(page.locator('.form-actions').getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await below(save, del);
  await below(page.getByRole('button', { name: 'Cancel' }), del);
  await page.screenshot({ path: 'screenshots/r7-edit-delete.png' });
  await del.click();
  await expect(rows).toHaveCount(0);
  await page.getByRole('status').filter({ hasText: 'Set 1 deleted' }).getByRole('button', { name: 'Undo' }).click();
  await expect(rows).toHaveCount(1);
});

test('Delete has its own line in the cardio editor too', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Treadmill');
  await page.getByRole('button', { name: 'Log cardio' }).click();
  const rows = page.getByRole('list', { name: 'Sessions for Treadmill' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button').click();
  const del = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(page.locator('.form-actions').getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await below(page.getByRole('button', { name: 'Save', exact: true }), del);
  await page.screenshot({ path: 'screenshots/r7-cardio-delete.png' });
  await del.click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Session deleted' })).toBeVisible();
});

test('a brand-new card says "Enter a weight" as help, and only as an error once the field is touched', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Bench Press');
  const help = page.getByRole('status').filter({ hasText: 'Enter a weight' });
  await expect(help).toBeVisible();
  await expect(help).toHaveClass(/muted/);
  await expect(help).not.toHaveClass(/err/);
  await page.screenshot({ path: 'screenshots/r7-new-card-help.png' });
  const weight = page.getByRole('textbox', { name: 'Weight' });
  await weight.fill('5');
  await weight.fill('');
  await expect(help).toHaveClass(/err/);
});

test('the When hint sits under the time field, which keeps to the form width', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Bench Press');
  // With a set logged a time is suggested, and its hint is short enough to have sat beside the field.
  await page.getByRole('textbox', { name: 'Weight' }).fill('135');
  await page.getByRole('button', { name: 'Add set' }).click();
  await page.clock.setFixedTime(new Date('2026-10-02T18:20:00'));
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  const form = page.locator('.set-form').first();
  const when = form.getByRole('textbox', { name: 'When' });
  await expect(when).not.toHaveValue('');
  await below(when, form.getByText('A guess is fine'));
  const [w, f] = [await box(when), await box(form)];
  expect(w.width).toBeGreaterThan(f.width - 1);
  await page.screenshot({ path: 'screenshots/r7-when.png' });
});

test('the cardio When hint sits under its time field too', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Treadmill');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  const form = page.locator('.cardio-form');
  const when = form.getByRole('textbox', { name: 'When' });
  const hint = form.getByText('Leave empty if you don’t know');
  await below(when, hint);
  const [w, f] = [await box(when), await box(form)];
  expect(w.width).toBeGreaterThan(f.width - 1);
  await page.screenshot({ path: 'screenshots/r7-cardio-when.png' });
  // At 375 px this hint wraps anyway; on a wider screen it had room to sit beside the field.
  await page.setViewportSize({ width: 768, height: 1024 });
  await below(when, hint);
});

test('nothing scrolled shows through the status bar', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  // The phone's inset, which a desktop browser reports as 0.
  await page.evaluate(() => document.documentElement.style.setProperty('--sat', '47px'));
  await addLift(page, 'Bench Press');
  await addLift(page, 'Barbell Squat');
  await page.evaluate(() => window.scrollTo(0, 400));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const top = await page.evaluate(() => {
    // Taps pass through the backdrop, and so would hit-testing: let it be hit, to see what paints on top there.
    document.querySelectorAll<HTMLElement>('.status-backdrop').forEach((b) => { b.style.pointerEvents = 'auto'; });
    const el = document.elementFromPoint(187, 20)!;
    return { cls: el.className, bg: getComputedStyle(el).backgroundColor, body: getComputedStyle(document.body).backgroundColor };
  });
  expect(top.cls).toContain('status-backdrop');
  expect(top.bg).toBe(top.body);
  // Below the inset, the page is as before.
  expect(await page.evaluate(() => document.elementFromPoint(187, 60)!.className)).not.toContain('status-backdrop');
  await page.screenshot({ path: 'screenshots/r7-status-bar.png' });
});
