import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto, statsSheet } from './nav';

// The weekly digest on Today and Stats, at the 13 mini's 375×812 with its notch (insets faked as in e2e/records).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/digest';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? BOTTOM : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) return route.abort();
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}

/** Nothing scrolls sideways, every field is 16px or more, and every button in the digest is a 44px tap. */
async function fits(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll('input:not([type=hidden], [type=checkbox], [type=radio], [type=range]), select, textarea')) {
      if (el.getBoundingClientRect().width && parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`${el.getAttribute('aria-label')} under 16px`);
    }
    // Laid-out height: a button just tapped can still be easing back from its press scale.
    for (const el of document.querySelectorAll<HTMLElement>('.digest button')) {
      if (el.offsetHeight < 44) out.push(`${el.textContent} is ${el.offsetHeight}px tall`);
    }
    for (const el of document.querySelectorAll('.digest *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.className}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,duration_s,distance_mi';
// Synthetic. The week before (Sep 28–Oct 4): one session, 3 sets. Last week (Oct 5–11): 2 sessions (the default goal of 2),
// 8 sets, one PR (145 × 8 beats 135 × 8; a lift's first day is no PR), and 20 minutes on the treadmill.
const ROWS = [
  '2026-09-29,Bench Press,,1,135,8,,,,sample,,', '2026-09-29,Bench Press,,2,135,8,,,,sample,,', '2026-09-29,Bench Press,,3,135,8,,,,sample,,',
  '2026-10-06,Bench Press,,1,145,8,,,,sample,,', '2026-10-06,Bench Press,,2,140,8,,,,sample,,',
  '2026-10-06,Lat Pulldown,,1,120,10,,,,sample,,', '2026-10-06,Lat Pulldown,,2,120,10,,,,sample,,', '2026-10-06,Lat Pulldown,,3,120,10,,,,sample,,',
  '2026-10-09,Leg Press,,1,200,10,,,,sample,,', '2026-10-09,Leg Press,,2,200,10,,,,sample,,', '2026-10-09,Leg Press,,3,200,10,,,,sample,,',
  '2026-10-10,Treadmill,,1,0,,,cardio,,sample,1200,1.5',
];

async function seed(page: Page, at: string) {
  await notched(page);
  await page.clock.install({ time: new Date(at) });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
}

const line = (card: ReturnType<Page['getByRole']>, name: string) => card.locator('.digest-lines > div').filter({ has: card.page().getByRole('term').filter({ hasText: name }) });

const toggleOf = (page: Page) => page.getByRole('region', { name: 'Last week' }).getByRole('button', { name: /^Last week/ });

test('Today: last week from Monday, one line until tapped open; hides until next week, and comes back the week after', async ({ page }) => {
  await seed(page, '2026-10-12T18:00:00'); // a Monday
  await goto(page, 'Today');
  const card = page.getByRole('region', { name: 'Last week' });
  // Collapsed (IA A1, owner 2026-10-21): one line under the plan, the week's numbers after its name.
  const toggle = toggleOf(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveText(/^Last week · 2 of 2 sessions · 8 sets · 1 PR$/);
  await expect(card.locator('.digest-lines')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Hide until next week' })).toHaveCount(0);
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(60);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/2-today-folded.png` });

  // A tap opens it in place.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('heading', { level: 2 })).toHaveText(/Last week\s*· Oct 5–11/);
  await expect(line(card, 'Sessions')).toHaveText(/Sessions\s*2 of 2 \+ 1 cardio day\s*↑1/);
  await expect(line(card, 'Streak')).toHaveText(/1 week/);
  await expect(line(card, 'Sets')).toHaveText(/Sets\s*8\s*↑5/);
  await expect(line(card, 'PRs')).toHaveText(/PRs\s*1\s*↑1/);
  await expect(line(card, 'Cardio')).toHaveText(/Cardio\s*20 min\s*↑20/);
  await expect(card.getByLabel('1 more than the week before').first()).toBeVisible();
  await expect(card.getByRole('list', { name: 'By lift' }).getByRole('listitem')).toHaveText([
    /Lat Pulldown\s*3 sets$/, /Leg Press\s*3 sets$/, /Bench Press\s*2 sets · 1 PR$/, /Treadmill\s*1 bout$/]);
  await expect(card.getByRole('list', { name: 'Muscles furthest behind' }).getByRole('listitem')).toHaveCount(3);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1-today.png`, fullPage: true });

  // Hidden until next week: gone after a reload, and gone all week.
  await card.getByRole('button', { name: 'Hide until next week' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.clock.setSystemTime(new Date('2026-10-18T09:00:00')); // Sunday
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await expect(card).toHaveCount(0);

  // The next Monday: the week just gone, collapsed again, with nothing logged in it and no cardio line.
  await page.clock.setSystemTime(new Date('2026-10-19T07:00:00'));
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveText(/^Last week · 0 of 2 sessions · 0 sets · 0 PRs$/);
  await toggle.click();
  await expect(card.getByRole('heading', { level: 2 })).toHaveText(/Last week\s*· Oct 12–18/);
  await expect(line(card, 'Sessions')).toHaveText(/0 of 2\s*↓2/);
  await expect(line(card, 'Cardio')).toHaveCount(0);
  // Not on a past day.
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('Logging to a past day')).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('Today: opened or closed, the digest stays as left for that week, per profile; a new week starts collapsed', async ({ page }) => {
  await seed(page, '2026-10-12T18:00:00'); // a Monday: Me has last week
  // Sam, a second profile on this phone, with the same weeks.
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  const bar = page.getByRole('group', { name: 'Who’s training' });
  await expect(bar.getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
  const toggle = toggleOf(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await bar.getByRole('button', { name: /Me/ }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Me opens it: open after a reload and after a day away, all that week.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.clock.setSystemTime(new Date('2026-10-14T18:00:00')); // Wednesday
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Sam's is Sam's own: still collapsed. Back to Me: still open.
  await bar.getByRole('button', { name: /Sam/ }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await bar.getByRole('button', { name: /Me/ }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // Closed again: closed after a reload.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Opened late in the week, then the next Monday: a new week, collapsed.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.clock.setSystemTime(new Date('2026-10-19T07:00:00'));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Last week' })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.getByRole('region', { name: 'Last week' }).getByRole('heading', { level: 2 })).toHaveText(/Last week\s*· Oct 12–18/);
});

test('Today: a set logged today leaves last week as it was; a set gone from last week moves it', async ({ page }) => {
  await seed(page, '2026-10-12T18:00:00'); // a Monday
  await goto(page, 'Today');
  const card = page.getByRole('region', { name: 'Last week' });
  await toggleOf(page).click();
  await expect(line(card, 'Sets')).toHaveText(/Sets\s*8\s*↑5/);
  // A heavier bench today: a PR of today's, not last week's.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  const bench = page.locator('[data-card="bench press"]');
  await bench.getByRole('textbox', { name: 'Weight' }).fill('200');
  await bench.getByRole('textbox', { name: 'Reps' }).fill('8');
  await bench.getByRole('button', { name: /^Add set/ }).click();
  await expect(bench.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(1);
  await expect(line(card, 'Sets')).toHaveText(/Sets\s*8\s*↑5/);
  await expect(line(card, 'PRs')).toHaveText(/PRs\s*1\s*↑1/);
  // Friday's leg press, one set deleted: last week had 7.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { name: 'Fri, Oct 9' })).toBeVisible();
  await page.getByRole('list', { name: 'Sets for Leg Press' }).getByRole('listitem').first().getByRole('button').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Leg Press' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(line(card, 'Sets')).toHaveText(/Sets\s*7\s*↑4/);
});

test('Stats: last week next to this week, always open', async ({ page }) => {
  await seed(page, '2026-10-14T18:00:00');
  await goto(page, 'Stats');
  await statsSheet(page, 'week');
  const card = page.getByRole('dialog').getByRole('region', { name: 'Last week' });
  await expect(card.getByRole('heading', { level: 3 }).first()).toHaveText(/Last week\s*· Oct 5–11/);
  await expect(line(card, 'Sessions')).toHaveText(/2 of 2 \+ 1 cardio day\s*↑1/);
  await expect(line(card, 'PRs')).toHaveText(/PRs\s*1/);
  await expect(card.getByRole('button')).toHaveCount(0); // nothing to fold or hide
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/3-stats.png` });
});

test('the Sunday recap opens Today at the week it ends; folded or hidden, a recap tap opens it again', async ({ page }) => {
  await seed(page, '2026-10-18T18:30:00'); // Sunday, the recap's evening
  await goto(page, 'Stats');
  await page.goto('/#open=recap');
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  const week = page.getByRole('region', { name: 'This week' });
  await expect(week.getByRole('heading', { level: 2 })).toHaveText(/This week\s*· Oct 12–18/);
  await expect(week.getByRole('button', { name: /^This week/ })).toHaveAttribute('aria-expanded', 'true');
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/4-recap.png` });

  // Folded, then the next recap tap opens it again.
  await week.getByRole('button', { name: /^This week/ }).click();
  await expect(week.getByRole('button', { name: /^This week/ })).toHaveAttribute('aria-expanded', 'false');
  await goto(page, 'Stats');
  await page.goto('/#open=recap');
  await expect(week.getByRole('button', { name: /^This week/ })).toHaveAttribute('aria-expanded', 'true');

  // Monday: hidden, then a recap tap brings back the week just gone.
  await page.clock.setSystemTime(new Date('2026-10-19T08:00:00'));
  await page.goto('/');
  const last = page.getByRole('region', { name: 'Last week' });
  // The same week the recap opened last night: still open.
  await expect(last.getByRole('button', { name: /^Last week/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(last.getByRole('heading', { level: 2 })).toHaveText(/Last week\s*· Oct 12–18/);
  await last.getByRole('button', { name: 'Hide until next week' }).click();
  await expect(last).toHaveCount(0);
  await page.goto('/#open=recap');
  await expect(last.getByRole('button', { name: /^Last week/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(last.getByRole('heading', { level: 2 })).toBeInViewport();
});
