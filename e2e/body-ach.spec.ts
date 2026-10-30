import { expect, test } from '@playwright/test';
import { goto } from './nav';
import { notched } from './layout';

// Your body (progress-photos plan S4, owner 2026-10-29): weigh-ins and photo days as achievements, only on your phone. A weigh-in
// today is the first Weigh-ins level; the group has no Shown to friends switch, and its foot says which families pay buddy
// points. Synthetic only.

test('a weigh-in is Your first weigh-in, in a group only you see', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-20T18:00:00') });
  await page.goto('/');
  const weigh = page.getByRole('group', { name: 'Weigh-in' });
  await weigh.getByRole('textbox', { name: 'Weigh-in (lb)' }).fill('181.4');
  await weigh.getByRole('button', { name: 'Save weight' }).click();
  await expect(weigh).toContainText('181.4 lb');

  // A set too: Stats shows its tiles once there's a session.
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  const card = page.locator('[data-card="cable curl"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('30');
  await card.getByRole('textbox', { name: 'Reps' }).fill('10');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await goto(page, 'Stats');
  await page.getByRole('button', { name: 'Achievements', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Achievements' });
  await expect(sheet.getByRole('region', { name: 'New today' })).toContainText('Your first weigh-in');
  const body = sheet.getByRole('region', { name: 'Your body' });
  await expect(body).toContainText('only you see these');
  for (const t of ['Weigh-ins', 'Steady weeks', 'Photo days', 'Photo season', 'Flexed and relaxed']) await expect(body.getByRole('button', { name: new RegExp(`^${t}`) })).toBeVisible();
  await expect(body.getByRole('button', { name: /^Goal weight/ })).toHaveCount(0);
  await expect(sheet).toContainText('Your body: only you see these, never shared with anyone');
  await body.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/40-body-ach.png' });

  await body.getByRole('button', { name: /^Weigh-ins/ }).click();
  const detail = page.getByRole('dialog', { name: 'Weigh-ins' });
  await expect(detail).toContainText('Days with a weigh-in.');
  await expect(detail).toContainText('Each level pays buddy points like any other.');
  await expect(detail.getByRole('switch')).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/41-body-ach-weighins.png' });
  await detail.getByRole('button', { name: 'Achievements' }).click();
  await page.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'Your body' }).getByRole('button', { name: /^Steady weeks/ }).click();
  const steady = page.getByRole('dialog', { name: 'Steady weeks' });
  await expect(steady).toContainText('No buddy points: only Weigh-ins and Photo days pay them.');
  await expect(steady.getByRole('switch')).toHaveCount(0);
});
