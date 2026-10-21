import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// Owner, 2026-10-19: the app left open over Sunday night showed the week just gone as "This week" on Monday morning, until he
// logged something. A phone asleep runs no timers and may send no event on the way back; the day must still move on.
test.use({ serviceWorkers: 'block' });

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,duration_s,distance_mi';
// Synthetic: the week before (Sep 28–Oct 4) one session; the week of Oct 5–11 two sessions, 6 sets.
const ROWS = [
  '2026-09-29,Bench Press,,1,135,8,,,,sample,,',
  '2026-10-06,Bench Press,,1,145,8,,,,sample,,', '2026-10-06,Bench Press,,2,140,8,,,,sample,,', '2026-10-06,Bench Press,,3,140,8,,,,sample,,',
  '2026-10-09,Leg Press,,1,200,10,,,,sample,,', '2026-10-09,Leg Press,,2,200,10,,,,sample,,', '2026-10-09,Leg Press,,3,200,10,,,,sample,,',
];

/** Sunday night, the week's sessions in, the app open on Stats. */
async function sundayNight(page: Page) {
  await page.clock.install({ time: new Date('2026-10-11T21:00:00') });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  await goto(page, 'Stats');
  await expect(thisWeek(page).locator('.st-rc')).toContainText('2/2');
  await expect(thisWeek(page)).toContainText(/Sets\s*6/);
  // From here no timer runs unless the test says so: the phone is asleep.
  await page.clock.pauseAt(new Date('2026-10-11T23:30:00'));
}
const thisWeek = (page: Page) => page.getByRole('region', { name: 'This week', exact: true }).filter({ has: page.locator('.st-week') });

/** Monday's Stats and Today: a new week with nothing in it, and the week just gone as last week. */
async function monday(page: Page) {
  await expect(thisWeek(page).locator('.st-rc')).toContainText('0/2');
  await expect(thisWeek(page)).toContainText(/Sets\s*0/);
  await goto(page, 'Today');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mon, Oct 12');
  const last = page.getByRole('region', { name: 'Last week' });
  await expect(last.getByRole('heading', { level: 2 })).toHaveText(/Last week\s*· Oct 5–11/);
  await expect(last).toContainText(/Sessions\s*2 of 2/);
  await expect(page.getByRole('region', { name: 'This week' })).toHaveCount(0);
}

test('woken on Monday with no timer run and no event, the first tap moves every week-based number on', async ({ page }) => {
  await sundayNight(page);
  await page.clock.setSystemTime(new Date('2026-10-12T07:30:00')); // the clock moves, nothing fires
  await page.getByRole('heading', { name: 'Stats', level: 1 }).click(); // a tap anywhere
  await monday(page);
});

test('woken on Monday, the app coming back into view moves it on', async ({ page }) => {
  await sundayNight(page);
  await page.clock.setSystemTime(new Date('2026-10-12T07:30:00'));
  await page.evaluate(() => { window.dispatchEvent(new Event('pageshow')); });
  await monday(page);
});

test('left open on screen across midnight into Monday, the minute tick moves it on', async ({ page }) => {
  await sundayNight(page);
  await page.clock.runFor(45 * 60_000); // 00:15 Monday, every minute's timer run
  await monday(page);
});
