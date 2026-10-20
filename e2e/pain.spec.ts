import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';

// Item 08, pain response: last time's moderate pain holds the lift; a lift that keeps hurting is offered a swap; sharp pain in
// the session says stop; pain on and off for weeks points to a physio. Synthetic history only. At the 13 mini's 375×812 with its
// notch (insets faked as in e2e/rotation).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/pain';
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

/** Nothing off the side, and every button in the pain boxes a 44 px target. */
async function fits(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>('.pain-suggest button, .pain-stop button')) if (el.offsetHeight < 44) out.push(`${el.textContent} is ${el.offsetHeight}px tall`);
    for (const el of document.querySelectorAll('.pain-suggest *, .pain-stop *, .care-physio')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.textContent}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity';
const rows = (date: string, lift: string, sets: string[], pain?: 2 | 3) => sets.map((s, i) => {
  const [w, r] = s.split('x');
  const hurt = pain && i === sets.length - 1;
  return `${date},${lift},,${i + 1},${w},${r},,${hurt ? 'pain' : ''},,sample,${hurt ? 'elbow' : ''},${hurt ? pain : ''}`;
});
// Ten weeks of bench, leg press and pushdowns; the pushdowns hurt the elbow (moderate) on each of the last five.
const WEEKS = ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26', '2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07'];
const HISTORY = WEEKS.flatMap((d, k) => [
  ...rows(d, 'Bench Press', ['185x8', '185x8', '185x8']),
  ...rows(d, 'Leg Press', ['300x10', '300x10', '300x10']),
  ...rows(d, 'Cable Pushdown', ['110x15', '110x15', '110x15'], k >= 5 ? 2 : undefined),
]);

async function setUp(page: Page) {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-14T18:00:00') });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'pain.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...HISTORY].join('\n')) });
  await expect(page.getByText(`✓ Imported ${HISTORY.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
}
const card = (page: Page, lift: string) => page.locator(`[data-card="${lift.toLowerCase()}"]`);

test('moderate pain last time holds the lift; one that keeps hurting is offered a swap, dismissible', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Pushdown/ }).first().click();
  const c = card(page, 'Cable Pushdown');
  const prompt = c.getByRole('group', { name: 'Pain keeps coming back' });
  await expect(prompt).toContainText('Cable Pushdown hurt in 5 of your last 5 sessions');
  await expect(c.getByLabel('Target')).toContainText('Hold: 15 · 15 · 15 @ 110 lb');
  await expect(c.getByLabel('Target')).toContainText('Moderate pain last time: hold until it’s mild or gone');
  await c.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/today-hold-and-prompt.png` });
  await prompt.getByRole('button', { name: 'Dismiss' }).click();
  await expect(prompt).toHaveCount(0);
  // Kept: back on Today later, still dismissed.
  await goto(page, 'Stats');
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Pushdown/ }).first().click();
  await expect(card(page, 'Cable Pushdown').getByLabel('Target')).toBeVisible();
  await expect(card(page, 'Cable Pushdown').getByRole('group', { name: 'Pain keeps coming back' })).toHaveCount(0);
});

test('sharp pain in the session says stop that lift for today', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Pushdown/ }).first().click();
  const c = card(page, 'Cable Pushdown');
  await c.getByRole('button', { name: 'Details' }).click();
  await c.getByRole('button', { name: 'Pain', exact: true }).click();
  await c.getByRole('group', { name: 'Pain region' }).getByRole('button', { name: 'Elbow' }).click();
  await c.getByRole('group', { name: 'Pain severity' }).getByRole('button', { name: 'Sharp' }).click();
  await c.getByRole('button', { name: 'Add set' }).click();
  await expect(c.locator('.pain-stop')).toContainText('Sharp pain: stop Cable Pushdown for today. Next time starts a step lighter.');
  // Logged: the swap prompt is gone (it only shows before the lift's first working set).
  await expect(c.getByRole('group', { name: 'Pain keeps coming back' })).toHaveCount(0);
  await c.locator('.pain-stop').scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/sharp-stop.png` });
});

test('pain on and off for weeks: the care card suggests getting it looked at', async ({ page }) => {
  await setUp(page);
  await goto(page, 'Stats');
  const care = page.getByRole('region', { name: 'Joint & back care' });
  await expect(care).toContainText('Pain in your elbow has come and gone for 5 weeks. Worth getting it looked at by a physio or GP.');
  await care.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/care-physio.png` });
});
