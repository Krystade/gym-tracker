import { expect, test, type Page } from '@playwright/test';

const bar = (page: Page) => page.getByRole('group', { name: 'Who’s training' });
const addCurl = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Zercher Curl');
  await page.getByRole('button', { name: 'Add “Zercher Curl”' }).click();
};

test('two people on one phone: separate logs, one-tap switch, typed sets survive a switch', async ({ page }) => {
  await page.goto('/');
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await expect(page.getByText('Backed up to profiles/sam/')).toBeVisible();
  await page.getByRole('button', { name: 'Add Sam' }).click();
  await expect(bar(page).getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');

  // Sam logs a set.
  await page.getByRole('button', { name: 'Today' }).click();
  await addCurl(page);
  await page.getByRole('textbox', { name: 'Weight' }).fill('20');
  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/20 × 10/]);
  await page.screenshot({ path: 'screenshots/18-profiles.png', fullPage: true });

  // Me sees none of it.
  await bar(page).getByRole('button', { name: /Me/ }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' })).toHaveCount(0);
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Zercher Curl')).toHaveCount(0);

  // Me types a set, switches away and back before saving: it's still there.
  await page.getByRole('button', { name: 'Today' }).click();
  await addCurl(page);
  await page.getByRole('textbox', { name: 'Weight' }).fill('45');
  await page.getByRole('textbox', { name: 'Reps' }).fill('7');
  await bar(page).getByRole('button', { name: /Sam/ }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/20 × 10/]);
  await bar(page).getByRole('button', { name: /Me/ }).click();
  await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('7');
  await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveValue('45');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/45 × 7/]);

  // The active profile survives a reload.
  await bar(page).getByRole('button', { name: /Sam/ }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/20 × 10/]);
  await expect.poll(() => page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('gym-tracker-shared');
    r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('people'); g.onsuccess = () => { ok(g.result?.active); r.result.close(); }; };
  }))).not.toBe('main');
  await page.reload();
  await expect(bar(page).getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/20 × 10/]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Deleting Sam needs the name typed.
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const del = page.getByRole('button', { name: 'Delete Sam' });
  await expect(del).toBeDisabled();
  await page.getByRole('textbox', { name: 'Type Sam to confirm' }).fill('Sam');
  await del.click();
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Zercher Curl').first()).toBeVisible(); // Me's set is untouched

  // A new person can't take over the deleted one's backup folder.
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await expect(page.getByText(/still holds an old backup/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Sam' })).toBeDisabled();
});

test('five people and a long name: chips sit side by side, none squashed, and the last one is scrolled into view', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  for (const n of ['Sam', 'Kim', 'Alexandria Montgomery', 'Jo']) {
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(n);
    await page.getByRole('button', { name: `Add ${n}` }).click();
    await expect(bar(page).getByRole('button', { name: new RegExp(n) })).toHaveAttribute('aria-pressed', 'true'); // saved before the next add
  }
  const chips = bar(page).getByRole('button');
  await expect(chips).toHaveCount(5);
  await expect(chips.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.nth(3)).toHaveAccessibleName(/Alexandria Montgomery/); // ellipsis is visual only
  const boxes = [];
  for (let i = 0; i < 5; i++) boxes.push((await chips.nth(i).boundingBox())!);
  for (let i = 1; i < 5; i++) expect(boxes[i - 1].x + boxes[i - 1].width).toBeLessThanOrEqual(boxes[i].x + 0.5);
  for (const b of boxes) expect(b.width).toBeLessThanOrEqual(0.45 * 375 + 1);
  // Squashed chips keep their box but spill their content over the neighbour: the badge must keep its size, and content must fit or be clipped with an ellipsis.
  for (let i = 0; i < 5; i++) {
    const r = await chips.nth(i).evaluate((el) => {
      const badge = el.querySelector('.initials')!.getBoundingClientRect();
      return { badge: badge.width, fits: el.scrollWidth <= el.clientWidth + 1, scrolled: el.scrollLeft, ellipsis: getComputedStyle(el.querySelector('.pname')!).textOverflow === 'ellipsis' };
    });
    expect(r.badge).toBeGreaterThanOrEqual(33.5);
    expect(r.fits).toBe(true); // the name is ellipsised inside the chip, not spilling out of it
    expect(r.scrolled).toBe(0);
    expect(r.ellipsis).toBe(true);
  }
  await expect(page.getByText('Loading…')).toHaveCount(0);
  // The active chip (the last) is on screen after the switch, not off to the right.
  const last = boxes[4];
  expect(last.x).toBeGreaterThanOrEqual(0);
  expect(last.x + last.width).toBeLessThanOrEqual(375 - 15);
  await page.screenshot({ path: 'screenshots/48-profile-bar.png' });
  await page.setViewportSize({ width: 320, height: 700 });
  await bar(page).getByRole('button', { name: /Sam/ }).click();
  await expect(bar(page).getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await bar(page).getByRole('button', { name: /Jo/ }).click();
  await expect(bar(page).getByRole('button', { name: /Jo/ })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'screenshots/48-profile-bar-320.png' });
  const jo = (await bar(page).getByRole('button', { name: /Jo/ }).boundingBox())!;
  expect(jo.x + jo.width).toBeLessThanOrEqual(320 - 15);
});

test('switching person goes back to today', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  await bar(page).getByRole('button', { name: /Me/ }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('Logging to a past day')).toBeVisible();
  await bar(page).getByRole('button', { name: /Sam/ }).click();
  await expect(bar(page).getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  await expect(page.getByText(/Logging to/)).toHaveCount(0);
});

test('a past day is forgotten after switching away and back', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  const pressed = (n: RegExp) => expect(bar(page).getByRole('button', { name: n })).toHaveAttribute('aria-pressed', 'true');
  await bar(page).getByRole('button', { name: /Me/ }).click();
  await pressed(/Me/);
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('Logging to a past day')).toBeVisible();
  await bar(page).getByRole('button', { name: /Sam/ }).click();
  await pressed(/Sam/);
  await bar(page).getByRole('button', { name: /Me/ }).click();
  await pressed(/Me/);
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  await expect(page.getByText(/Logging to/)).toHaveCount(0);
});

test('the exercise search stays visible below the profile bar when the list scrolls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(300);
  const barBox = (await bar(page).boundingBox())!;
  const search = (await page.getByRole('searchbox', { name: 'Search exercises' }).boundingBox())!;
  expect(search.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
  await page.screenshot({ path: 'screenshots/19-picker-profiles.png' });
});
