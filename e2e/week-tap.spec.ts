import { expect, test, type Locator, type Page } from '@playwright/test';
import { goto, openProgram } from './nav';

// Owner, 2026-10-23: "When tapping a day in my week line, it should move from today to that day so I can review what I did."
// A past day: its lifts and sets, read only (no set form, no rest, no next set). A future day: its plan. Back to today, or
// today's letter, returns; the app always opens on today. The day shown has the pill; each day is a 44 × 44 tap.
test.use({ serviceWorkers: 'block' });

// This week (Mon 19 to Sun 25 Oct 2026, today Friday 23): Monday and Wednesday trained, Tuesday and Thursday not.
const CSV = ['date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity',
  '2026-10-12,Squat,,1,205,5,,,,sample,,', '2026-10-14,Bench Press,,1,125,8,,,,sample,,',
  '2026-10-19,Squat,,1,225,5,,,,sample,,', '2026-10-19,Squat,,2,225,5,,,,sample,,',
  '2026-10-21,Bench Press,,1,135,8,,,,sample,,', '2026-10-21,Bench Press,,2,145,6,,,,sample,,'].join('\n');

async function start(page: Page) {
  await page.clock.install({ time: new Date('2026-10-23T18:00:00') });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'week.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('3');
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await goto(page, 'Weekly goal');
  await page.getByRole('textbox', { name: 'Sessions per week goal' }).fill('3');
  await goto(page, 'Today');
}
const week = (page: Page) => page.getByRole('list', { name: 'This week' });
const day = (page: Page, name: string) => week(page).getByRole('button', { name: new RegExp(`^${name}\\b`) });
const big = async (l: Locator) => { const b = (await l.boundingBox())!; expect(Math.min(b.width, b.height), await l.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(44); };

test('a past day in the week row opens read only, a future day its plan, and Back to today or today’s letter return', async ({ page }) => {
  await start(page);
  const h1 = page.locator('.today-head h1');
  const todayTitle = (await h1.textContent())!;
  await expect(page.getByRole('region', { name: 'Ready' })).toBeVisible();
  const days = week(page).getByRole('button');
  await expect(days).toHaveCount(7);
  for (let i = 0; i < 7; i++) await big(days.nth(i));
  await expect(day(page, 'Fri')).toHaveAttribute('aria-pressed', 'true');

  // Wednesday: its lift and sets, read only.
  await day(page, 'Wed').click();
  await expect(h1).not.toHaveText(todayTitle);
  await expect(h1).toContainText('Wed');
  await expect(day(page, 'Wed')).toHaveAttribute('aria-pressed', 'true');
  await expect(day(page, 'Fri')).toHaveAttribute('aria-pressed', 'false');
  const bench = page.getByRole('region', { name: 'Bench Press' });
  await expect(bench).toContainText('135 × 8');
  await expect(bench).toContainText('145 × 6');
  await expect(page.getByRole('region', { name: 'Squat' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Add (set|exercise)/ })).toHaveCount(0);
  await expect(page.getByLabel('Next set')).toHaveCount(0);
  await expect(page.locator('.rest-timer')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Ready' })).toHaveCount(0);
  const back = page.getByRole('button', { name: 'Back to today' });
  await big(back);

  // Back to today.
  await back.click();
  await expect(h1).toHaveText(todayTitle);
  await expect(page.getByRole('region', { name: 'Ready' })).toBeVisible();

  // Monday, then today's own letter.
  await day(page, 'Mon').click();
  await expect(page.getByRole('region', { name: 'Squat' })).toContainText('225 × 5');
  await day(page, 'Fri').click();
  await expect(h1).toHaveText(todayTitle);

  // Tuesday: nothing logged.
  await day(page, 'Tue').click();
  await expect(page.getByText('Nothing logged that day.')).toBeVisible();

  // The days after today: each its plan, a session's lifts or the rest day's reason, nothing to log. The goal 3 with 2 done
  // and Friday not trained: Saturday or Sunday trains unless today does.
  const plan = page.getByRole('region', { name: /^Plan for/ });
  const marks: string[] = [];
  for (const [i, name] of [[5, 'Sat'], [6, 'Sun']] as const) {
    await day(page, name).click();
    await expect(h1).toContainText(name);
    await expect(plan).toBeVisible();
    const mark = (await week(page).getByRole('listitem').nth(i).getAttribute('data-mark'))!;
    marks.push(mark);
    if (mark === 'rest') await expect(plan.getByRole('heading', { name: 'Rest' })).toBeVisible();
    else await expect(plan.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveCount(0);
  }
  const fri = (await week(page).getByRole('listitem').nth(4).getAttribute('data-mark'))!;
  expect([fri, ...marks].some((m) => m === 'train' || m === 'light'), `Fri ${fri}, Sat/Sun ${marks}`).toBe(true);

  // The app always opens on today.
  await page.reload();
  await goto(page, 'Today');
  await expect(h1).toHaveText(todayTitle);
  await expect(page.getByRole('region', { name: 'Ready' })).toBeVisible();
});
