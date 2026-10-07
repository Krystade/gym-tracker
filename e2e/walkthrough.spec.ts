import { expect, test, type Page } from '@playwright/test';

// The config marks the walkthrough as seen for every other spec; here the phone is new.
test.use({ storageState: { cookies: [], origins: [] } });

const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();

test('a first visit opens the walkthrough; Back and Next step through it, and Done closes it for good', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
  await expect(sheet).toContainText('1 of 5');
  await expect(sheet.getByRole('heading')).toHaveText('Today');
  await expect(sheet.getByRole('button', { name: 'Back' })).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/71-walkthrough.png' });
  await sheet.getByRole('button', { name: 'Next' }).click();
  await expect(sheet.getByRole('heading')).toHaveText('Log a set');
  await sheet.getByRole('button', { name: 'Back' }).click();
  await expect(sheet.getByRole('heading')).toHaveText('Today');
  for (const t of ['Log a set', 'The plan', 'History, Lifts and Stats', 'Your data']) {
    await sheet.getByRole('button', { name: 'Next' }).click();
    await expect(sheet.getByRole('heading')).toHaveText(t);
  }
  await expect(sheet).toContainText('5 of 5');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

test('Skip closes it for good, and the Data tab opens it again from the start', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
  await sheet.getByRole('button', { name: 'Next' }).click();
  await sheet.getByRole('button', { name: 'Skip' }).click();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await nav(page, 'Data');
  await page.getByRole('button', { name: 'Show walkthrough' }).click();
  await expect(sheet.getByRole('heading')).toHaveText('Today');
});

test('the sheet leaves the screen above it usable', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBeGreaterThan(812 / 2); // a sheet at the bottom, not a modal over the middle
  await page.getByRole('button', { name: 'Add exercise' }).click(); // nothing blocks the page behind it
  await expect(page.getByRole('searchbox', { name: 'Search exercises' })).toBeVisible();
});

test.describe('the spotlight', () => {
  test.use({ reducedMotion: 'reduce' }); // where the ring ends up, not where it is mid-glide
  type B = { x: number; y: number; width: number; height: number };
  const around = (outer: B, inner: B) =>
    outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
  const union = (bs: B[]) => {
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y };
  };
  const tabs = (page: Page, ...ts: string[]) => Promise.all(ts.map(async (t) => (await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).boundingBox())!));

  test('rings what each card talks about, clear of the sheet', async ({ page }) => {
    await page.goto('/');
    const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
    const ring = page.locator('.spotlight');
    const targets: (() => Promise<B[]>)[] = [
      async () => [(await page.locator('.day-switch').boundingBox())!],
      async () => [(await page.getByRole('button', { name: 'Add exercise' }).boundingBox())!],
      async () => [(await page.getByRole('button', { name: 'Program', exact: true }).boundingBox())!],
      () => tabs(page, 'History', 'Lifts', 'Stats'),
      () => tabs(page, 'Data'),
    ];
    for (const [n, target] of targets.entries()) {
      if (n) await sheet.getByRole('button', { name: 'Next' }).click();
      await expect(sheet).toContainText(`${n + 1} of 5`);
      const t = union(await target()), r = (await ring.boundingBox())!, s = (await sheet.boundingBox())!;
      // Around the target, except where the screen's edge cuts it: the ring stays on screen.
      const onScreen = { x: Math.max(t.x, 3), y: t.y, width: Math.min(t.x + t.width, 372) - Math.max(t.x, 3), height: Math.min(t.y + t.height, 809) - t.y };
      expect(around(r, onScreen), `card ${n + 1}: ring ${JSON.stringify(r)} around ${JSON.stringify(t)}`).toBe(true);
      expect(r.x >= 0 && r.y >= 0 && r.x + r.width <= 375 && r.y + r.height <= 812, `card ${n + 1}: ring on screen`).toBe(true);
      expect(r.y + r.height <= s.y || r.y >= s.y + s.height, `card ${n + 1}: ring clear of the sheet`).toBe(true);
      expect(r.width * r.height, `card ${n + 1}: a ring, not the whole screen`).toBeLessThan(2 * (t.width + 16) * (t.height + 16));
      expect(t.y + t.height <= s.y || t.y >= s.y + s.height, `card ${n + 1}: the sheet covers its target`).toBe(true);
      await page.screenshot({ path: `screenshots/72-walkthrough-${n + 1}.png` });
    }
    // The Lifts and Stats tabs: History through Stats in one ring, Data left out of it.
    await sheet.getByRole('button', { name: 'Back' }).click();
    const [data] = await tabs(page, 'Data');
    expect(around((await ring.boundingBox())!, data)).toBe(false);
  });

  test('reopened from Data, it goes to Today and brings a target below the sheet up into view', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('dialog', { name: 'Walkthrough' }).getByRole('button', { name: 'Skip' }).click();
    for (const lift of ['Bench Press', 'Barbell Squat']) { // two open cards push Add exercise off the bottom
      await page.getByRole('button', { name: 'Add exercise' }).click();
      await page.getByRole('searchbox', { name: 'Search exercises' }).fill(lift);
      await page.getByRole('button', { name: lift, exact: true }).click();
    }
    const add = page.getByRole('button', { name: 'Add exercise' });
    await nav(page, 'Data');
    await page.getByRole('button', { name: 'Show walkthrough' }).click();
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
    expect((await add.boundingBox())!.y, 'Add exercise starts below the sheet').toBeGreaterThan((await sheet.boundingBox())!.y);
    await sheet.getByRole('button', { name: 'Next' }).click();
    const a = (await add.boundingBox())!, s = (await sheet.boundingBox())!;
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.y + a.height).toBeLessThanOrEqual(s.y);
    expect(around((await page.locator('.spotlight').boundingBox())!, a)).toBe(true);
  });
});
