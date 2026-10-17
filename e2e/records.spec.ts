import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';

// A lift's Records, at the 13 mini's 375×812 with its notch: headless browsers report insets of 0, so the shipped CSS
// and HTML are served with each env(safe-area-inset-*) replaced by 47px top and 34px bottom.
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/records';
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

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
// Synthetic. Best e1RM 170 × 3 = 187; heaviest the partial 185; the warm-up would be the only 10- and 12-rep set;
// Sep 22 ties Sep 8's 5-rep max, which Sep 8 keeps; July's two 135 × 8 are the best set and session volume.
const ROWS = [
  '2026-07-07,Bench Press,,1,95,12,,warmup,,sample',
  '2026-07-07,Bench Press,,2,135,8,,,,sample',
  '2026-07-07,Bench Press,,3,135,8,,,,sample',
  '2026-09-08,Bench Press,,1,155,5,,,,sample',
  '2026-09-08,Bench Press,,2,155,5,,,,sample',
  '2026-09-15,Bench Press,,1,185,,,partial,,sample',
  '2026-09-15,Bench Press,,2,170,3,,,,sample',
  '2026-09-22,Bench Press,,1,155,5,,,,sample',
];

/** Nothing scrolls sideways, and every field you type in is 16px or more (iOS zooms into a smaller one). */
async function fits(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll('input:not([type=hidden], [type=checkbox], [type=radio], [type=range]), select, textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width && parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`${el.getAttribute('aria-label')} under 16px`);
    }
    for (const el of document.querySelectorAll('.records *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.className}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

async function openBench(page: Page) {
  await goto(page, 'Lifts');
  await page.getByRole('button', { name: /^Bench Press/ }).click();
  await expect(page.getByRole('heading', { name: 'Bench Press', level: 1 })).toBeVisible();
  return page.getByRole('region', { name: 'Records' });
}

test('Records: worked out from the log, a tap opens the day, and a new best shows, badges and goes again on delete', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim())).toBe(`${TOP}px`);
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText('✓ Imported 8 new sets')).toBeVisible();

  let rec = await openBench(page);
  const row = (name: RegExp) => rec.getByRole('button', { name });
  await expect(row(/^Best e1RM/)).toHaveText(/^Best e1RM\s*187 lb\s*170 × 3 · .*Sep 15/);
  await expect(row(/^Heaviest/)).toHaveText(/^Heaviest\s*185 lb\s*185 × \? · .*Sep 15/); // the partial set counts
  await expect(row(/^Best set volume/)).toHaveText(/1,080 lb\s*135 × 8 · .*Jul 7/);
  await expect(row(/^Best session volume/)).toHaveText(/2,160 lb\s*2 sets · .*Jul 7/); // the warm-up isn't counted
  const maxes = rec.getByRole('list', { name: 'Rep maxes' }).getByRole('listitem');
  await expect(maxes).toHaveText([/^1 rep\s*170 lb\s*× 3\s*Sep 15$/, /^3 reps\s*170 lb/, /^5 reps\s*155 lb\s*× 5\s*Sep 8$/, /^8 reps\s*135 lb\s*× 8\s*Jul 7$/, /^10 reps\s*—$/, /^12 reps\s*—$/]);
  await expect(maxes.nth(4).getByRole('button')).toHaveCount(0); // nothing to open
  await rec.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1-records.png` });

  // A record opens its day in History, in a month that starts folded, scrolled clear of the status bar.
  await row(/^Best session volume/).click();
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
  const july = page.locator('details.day[data-date="2026-07-07"]');
  await expect(july).toHaveAttribute('open', '');
  await expect(july.locator('summary')).toBeInViewport();
  expect((await july.boundingBox())!.y).toBeGreaterThanOrEqual(TOP);
  await expect(page.locator('details.month').filter({ hasText: 'July 2026' })).toHaveAttribute('open', '');
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/2-history-day.png` });
  // Opening History from the bar afterwards doesn't jump there again.
  await goto(page, 'Lifts');
  await goto(page, 'History');
  await expect(page.locator('details.month').filter({ hasText: 'July 2026' })).not.toHaveAttribute('open');

  // A heavier set: the banner names the best record it broke, and the set keeps its PR mark.
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press · / }).click();
  const card = page.locator('[data-card="bench press"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('190');
  await card.getByRole('textbox', { name: 'Reps' }).fill('3');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('status').filter({ hasText: 'PR!' })).toHaveText('PR! Best e1RM: 209 lb'); // one banner, not one per record
  const sets = card.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  await expect(sets.nth(0)).toContainText('PR');
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/3-today-pr.png` });
  await goto(page, 'History');
  const today = page.locator('details.day[data-date="2026-10-02"]');
  await expect(today.locator('summary')).toContainText('PR');
  await expect(today.getByRole('button', { name: /^Bench Press/ })).toContainText('190 × 3 PR');

  rec = await openBench(page);
  await expect(row(/^Best e1RM/)).toHaveText(/209 lb\s*190 × 3 · .*Oct 2/);
  await expect(row(/^Heaviest/)).toHaveText(/190 lb\s*190 × 3 · .*Oct 2/);
  await expect(maxes.nth(0)).toHaveText(/^1 rep\s*190 lb\s*× 3\s*Oct 2$/);
  await expect(maxes.nth(2)).toHaveText(/^5 reps\s*155 lb/);
  await rec.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/4-records-new.png` });

  // Deleted: every record it held goes back to the one before.
  await goto(page, 'Today');
  page.on('dialog', (d) => void d.accept());
  await sets.nth(0).getByRole('button').click();
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(sets).toHaveCount(0);
  rec = await openBench(page);
  await expect(row(/^Best e1RM/)).toHaveText(/187 lb\s*170 × 3 · .*Sep 15/);
  await expect(row(/^Heaviest/)).toHaveText(/185 lb\s*185 × \? · .*Sep 15/);
  await expect(maxes.nth(0)).toHaveText(/^1 rep\s*170 lb\s*× 3\s*Sep 15$/);

  // Left open while the log changes elsewhere (another tab here; a sync does the same): the records follow it.
  const other = await page.context().newPage();
  await notched(other);
  await other.clock.install({ time: new Date('2026-10-02T18:05:00') });
  await other.goto('/');
  await other.getByRole('button', { name: 'Add exercise' }).click();
  await other.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await other.getByRole('button', { name: /^Bench Press · / }).click();
  const card2 = other.locator('[data-card="bench press"]');
  await card2.getByRole('textbox', { name: 'Weight' }).fill('200');
  await card2.getByRole('textbox', { name: 'Reps' }).fill('1');
  await card2.getByRole('button', { name: /^Add set/ }).click();
  await expect(card2.getByRole('status').filter({ hasText: 'PR!' })).toHaveText('PR! Best e1RM: 200 lb'); // 200 × 1 beats 187: e1RM leads
  await expect(row(/^Heaviest/)).toHaveText(/200 lb\s*200 × 1 · .*Oct 2/);
  other.on('dialog', (d) => void d.accept());
  await card2.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('button').first().click();
  await card2.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row(/^Heaviest/)).toHaveText(/185 lb\s*185 × \? · .*Sep 15/);
});

test('Records for a hold, a bodyweight lift and cardio; a farther bout gets the banner and the mark', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await goto(page, 'More');
  const rows = ['2026-09-01,Plank,,1,0,45,,hold;bodyweight,,sample,,', '2026-09-08,Plank,,1,0,60,,hold;bodyweight,,sample,,',
    '2026-09-01,Pull-up,,1,0,10,,bodyweight,,sample,,', '2026-09-01,Pull-up,,2,0,8,,bodyweight,,sample,,', '2026-09-08,Pull-up,,1,0,12,,bodyweight,,sample,,',
    '2026-09-01,Treadmill,,1,0,,,cardio,,sample,1200,1.5', '2026-09-08,Treadmill,,1,0,,,cardio,,sample,1500,1.6', '2026-09-15,Treadmill,,1,0,,,cardio,,sample,900,1.25'];
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([`${HEADER},duration_s,distance_mi`, ...rows].join('\n')) });
  await expect(page.getByText('✓ Imported 8 new sets')).toBeVisible();
  const rec = page.getByRole('region', { name: 'Records' });
  const open = async (name: string) => {
    await goto(page, 'Lifts');
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await rec.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  };
  await open('Plank');
  await expect(rec.getByRole('listitem')).toHaveText([/^Longest hold\s*60 s\s*.*Sep 8$/]);
  await open('Pull-up');
  await expect(rec.getByRole('listitem')).toHaveText([/^Most reps\s*12\s*.*Sep 8$/, /^Most reps in a session\s*18\s*2 sets · .*Sep 1$/]);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/5-bodyweight.png` });
  await open('Treadmill');
  await expect(rec.getByRole('listitem')).toHaveText([/^Farthest\s*1.6 mi\s*25:00 · 1.6 mi · .*Sep 8$/, /^Best pace\s*12:00 \/mi\s*15:00 · 1.25 mi · .*Sep 15$/, /^Longest\s*25:00\s*25:00 · 1.6 mi · .*Sep 8$/]);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/6-cardio.png` });

  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Treadmill');
  await page.getByRole('button', { name: /^Treadmill · / }).click();
  const card = page.locator('[data-card="treadmill"]');
  await card.getByRole('textbox', { name: 'Minutes' }).fill('20');
  await card.getByRole('textbox', { name: 'Seconds' }).fill('0');
  await card.getByRole('textbox', { name: 'Distance (mi)' }).fill('2');
  await card.getByRole('button', { name: 'Log cardio' }).click();
  await expect(card.getByRole('status').filter({ hasText: 'PR!' })).toHaveText('PR! Farthest: 2 mi'); // and best pace: one banner
  await expect(card.getByRole('list', { name: 'Sessions for Treadmill' }).getByRole('listitem').first()).toContainText('PR');
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/7-cardio-pr.png` });
});
