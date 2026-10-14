import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const index = JSON.parse(readFileSync('public/characters/index.json', 'utf8')) as { sources: { group: string }[]; chars: { name: string; group: string }[] };

test('the Data tab opens a preview of every character, grouped by pack, each one drawn', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('button', { name: 'Characters (preview)' }).click();
  await expect(page.getByRole('heading', { name: 'Characters', exact: true })).toBeVisible();
  for (const s of index.sources) {
    const group = page.getByRole('region', { name: s.group });
    const names = index.chars.filter((c) => c.group === s.group).map((c) => c.name);
    await expect(group.getByRole('listitem')).toHaveCount(names.length);
    for (const n of names) await expect(group.getByText(n, { exact: true })).toBeVisible();
  }
  // Every canvas has drawn something: a missing or misnamed PNG leaves one blank.
  await expect.poll(() => page.locator('.char canvas').evaluateAll((cs) => (cs as HTMLCanvasElement[]).filter((c) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
    return true;
  }).length)).toBe(0);
  await expect(page.locator('.char canvas')).toHaveCount(index.chars.length);
  await expect(page.getByRole('link', { name: 'Kenney' }).first()).toBeVisible();
  await page.screenshot({ path: 'screenshots/80-characters.png', fullPage: true });
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByRole('button', { name: 'Characters (preview)' })).toBeVisible();
});
