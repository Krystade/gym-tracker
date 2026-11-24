import { expect, test } from '@playwright/test';
import { goto } from './nav';

// Days since the lift (owner, 2026-11-23; learn/away): a per-day term on the rep rule, learned from his log, shown on the card's
// target and as its own line in "Why this weight". Synthetic lift and numbers only.
test.use({ serviceWorkers: 'block' });
const DAY0 = '2026-10-20';
const LIFT = 'Seated Row';
const add = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** 20 sessions of 3 × 100 lb, 12 and 2 days apart by turns, the last 12 days before DAY0: 10 reps a set after a long gap, 8 after a short one. */
function csv(): string {
  const rows = ['date,exercise,set,weight_lb,reps,rir,flags,source'];
  const gaps: number[] = [];
  for (let i = 1; i < 20; i++) gaps.push(i % 2 ? 12 : 2);
  let d = add(DAY0, -12 - gaps.reduce((a, b) => a + b, 0)), reps = 8;
  for (let i = 0; i < 20; i++) {
    if (i > 0) { d = add(d, gaps[i - 1]); reps += gaps[i - 1] === 12 ? 2 : -2; }
    for (let k = 1; k <= 3; k++) rows.push([d, LIFT, k, 100, reps, '', '', 'sample'].join(','));
  }
  return rows.join('\n');
}

test('12 days since a lift his log says he beats the rule after: the target goes up, and Why this weight says why', async ({ page }) => {
  await page.clock.install({ time: new Date(`${DAY0}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'away.csv', mimeType: 'text/csv', buffer: Buffer.from(csv()) });
  await expect(page.getByText('✓ Imported 60 new sets')).toBeVisible();
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(LIFT);
  await page.getByRole('button', { name: new RegExp(`^${LIFT}`) }).first().click();
  const target = page.locator(`[data-card="${LIFT.toLowerCase()}"]`).getByLabel('Target');
  // Last time 10 · 10 · 10, 12 days ago: the rule alone repeats it; his log adds 2 a set.
  await expect(target).toContainText('12 · 12 · 12');
  await target.getByRole('button', { name: 'Why this weight' }).click();
  const sheet = page.getByRole('dialog', { name: 'Why this weight' });
  const line = sheet.locator('[data-input="away"]');
  await expect(line).toContainText('12 days since last time');
  await expect(line).toContainText('+2 reps a set');
  await expect(line).toContainText('b · Learned');
  await page.screenshot({ path: 'screenshots/r70-days-away-why.png' });
  await line.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/r70-days-away-line.png' });
});
