import { expect, test } from '@playwright/test';

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
// Synthetic: a chest-and-back week, legs last trained three weeks ago.
const rows = [
  ...['2026-09-30', '2026-10-02', '2026-10-03'].flatMap((d) => [1, 2, 3].flatMap((n) => [
    `${d},Machine Chest Press,,${n},120,10,,,,sample`, `${d},Lat Pulldown,,${n},100,10,,,,sample`])),
  '2026-09-14,Leg Press,,1,200,10,,,,sample', '2026-09-14,Seated Leg Curl,,1,80,10,,,,sample',
];

test('a Quick day fits the minutes given and goes to what the week has missed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText(`✓ Imported ${rows.length} new sets`)).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();

  const plan = page.getByRole('region', { name: 'Today’s plan' });
  await plan.getByRole('group', { name: 'Program day' }).getByRole('button', { name: 'Quick' }).click();
  await plan.getByRole('textbox', { name: 'Minutes' }).fill('20');
  await expect(plan.getByRole('button', { name: /Today’s plan · Quick/ })).toBeVisible();
  const names = plan.getByRole('list', { name: 'Planned exercises' }).locator('.plan-name b');
  // The day is rebuilt for 20 once the typing lands: wait for it rather than read the 30-minute day.
  const length = async () => Number((await plan.getByLabel('Plan length').innerText()).match(/≈ (\d+) min/)![1]);
  await expect.poll(length).toBeLessThanOrEqual(20);
  const mins = await length();
  expect(mins).toBeGreaterThanOrEqual(12);
  const lifts = await names.allInnerTexts();
  expect(lifts).not.toContain('Machine Chest Press');
  expect(lifts).not.toContain('Lat Pulldown');

  // Kept for the day, and Day A is still a tap away.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Today’s plan' }).getByRole('group', { name: 'Program day' }).getByRole('button', { name: 'Quick' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.plan-name b')).toHaveText(lifts);
});
