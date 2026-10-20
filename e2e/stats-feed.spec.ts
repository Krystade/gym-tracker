import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// Stats as answers (round 18): the week's ring, a new PR (confetti once), Getting stronger with a flat lift flagged, Next
// milestones, and Behind this week with a lift for each. Synthetic numbers only. Today: Thu 15 Oct 2026, 18:00.
const TODAY = '2026-10-15';
const SHOTS = 'screenshots/stats-feed';
mkdirSync(SHOTS, { recursive: true });
const TOP = 47;
const add = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** 11 weeks: squats climbing 5 lb a week (a PR today), bench stuck at 155 × 5 for two months (a flat fatigue-adjusted level, item 12), rows twice a week, a goal of 3. */
function csv(): string {
  const rows = ['date,exercise,set,weight_lb,reps,flags,duration_s'];
  for (let w = 10; w >= 1; w--) {
    const mon = add('2026-10-12', -7 * w), wed = add(mon, 2);
    for (let s = 1; s <= 3; s++) rows.push(`${mon},Barbell Squat,${s},${200 - 5 * w},5,,`);
    for (let s = 1; s <= 3; s++) rows.push(`${mon},Bench Press,${s},${w > 8 ? 150 : 155},5,,`);
    for (let s = 1; s <= 3; s++) rows.push(`${wed},Barbell Row,${s},${120 + (10 - w) * 2},8,,`);
  }
  // This week, only today: the squat PR.
  for (let s = 1; s <= 3; s++) rows.push(`${TODAY},Barbell Squat,${s},${s === 3 ? 210 : 200},5,,`);
  return rows.filter((r) => !/,Barbell Squat,\d,0,/.test(r)).join('\n');
}

async function seed(page: Page, reduce = false, width = 375) {
  await page.setViewportSize({ width, height: 812 });
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? 34 : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
  await page.clock.install({ time: new Date(`${TODAY}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv()) });
  await expect(page.getByText(/Imported \d+ new/)).toBeVisible();
  await goto(page, 'Stats');
  // Goal 3.
  const goal = page.getByRole('textbox', { name: 'Sessions per week goal' });
  await goal.fill('3');
  await goal.blur();
  await page.evaluate(() => window.scrollTo(0, 0));
}
test.use({ serviceWorkers: 'block' });

test('Stats answers: the week’s ring, the new PR, who’s getting stronger and what’s flat, the next milestones, what’s behind', async ({ page }) => {
  await seed(page);
  const week = page.getByRole('region', { name: 'This week', exact: true });
  await expect(week).toContainText(/Sessions\s*1 of 3/);
  await expect(week.locator('.st-ring-c')).toHaveText('1/3sessions');
  await expect(week).toContainText(/Sets\s*3/);
  await expect(week).toContainText(/PRs\s*\d new/);
  await expect(week.locator('.st-nudge')).toContainText('2 more sessions');

  const pr = page.getByRole('region', { name: 'New PR' });
  await expect(pr).toContainText('New PR · today');
  await expect(pr).toContainText('Barbell Squat 210 × 5');
  await expect(pr).toContainText(/e1RM 245 lb, up \d+ lb on your best/);
  await expect(pr.locator('.st-confetti i')).toHaveCount(16);

  const strong = page.getByRole('region', { name: 'Getting stronger' });
  await expect(strong.getByRole('button', { name: /^Barbell Squat: up \d+ lb e1RM$/ })).toBeVisible();
  await expect(strong.getByRole('button', { name: 'Bench Press: flat' })).toBeVisible();
  await expect(strong.getByRole('button', { name: 'Bench Press: flat' })).toContainText(/weeks, no change/);
  const miles = page.getByRole('region', { name: 'Next milestones' });
  // Milestones read the fatigue-adjusted level (item 04), a little under today's 245 lb top set.
  await expect(miles.getByRole('img', { name: /^2[34]\d of 250 lb$/ })).toBeVisible();

  const behind = page.getByRole('region', { name: 'Behind this week' });
  await expect(behind.locator('li').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.getByRole('heading', { name: 'Stats', level: 1 }).boundingBox())!.y).toBeGreaterThanOrEqual(TOP);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${SHOTS}/stats-375.png` });
  await page.screenshot({ path: `${SHOTS}/stats-375-full.png`, fullPage: true });

  // The confetti is once per PR: back on Stats, the card stays and nothing falls.
  await goto(page, 'Today');
  await goto(page, 'Stats');
  await expect(pr).toBeVisible();
  await expect(pr.locator('.st-confetti')).toHaveCount(0);

  // A lift on Getting stronger opens its screen.
  await strong.getByRole('button', { name: 'Bench Press: flat' }).click();
  await expect(page.getByRole('heading', { name: 'Bench Press', level: 1 })).toBeVisible();
});

test('Stats under reduced motion: no draw, no confetti, nothing moving', async ({ page }) => {
  await seed(page, true);
  await expect(page.getByRole('region', { name: 'New PR' })).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('Stats at 320 wide: nothing spills sideways', async ({ page }) => {
  await seed(page, false, 320);
  await expect(page.getByRole('region', { name: 'Getting stronger' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${SHOTS}/stats-320-full.png`, fullPage: true });
});
