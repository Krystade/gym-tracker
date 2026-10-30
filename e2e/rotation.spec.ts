import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto, openProgram } from './nav';

// A plateaued lift is offered the next variation of its movement pattern, on its card and on its screen. Nothing changes by
// itself: one tap switches the program over (with an undo), Dismiss hides it for this plateau. Synthetic history only.
// At the 13 mini's 375×812 with its notch (insets faked as in e2e/target-suggest).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/rotation';
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

/** Nothing off the side, and every button in the suggestion a 44 px target. */
async function fits(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>('.rotate-suggest button')) if (el.offsetHeight < 44) out.push(`${el.textContent} is ${el.offsetHeight}px tall`);
    for (const el of document.querySelectorAll('.rotate-suggest *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.textContent}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
const rows = (date: string, lift: string, sets: string[]) => sets.map((s, i) => { const [w, r] = s.split('x'); return `${date},${lift},,${i + 1},${w},${r},,,,sample`; });
// Machine chest press in the spring; bench level from late August, a rep more on 15 September, then three sessions with nothing
// better: its fatigue-adjusted level reads flat over 6 weeks (item 12), after twelve weeks of steady progress.
const HISTORY = [
  // Twelve weeks of steady progress up to it (2026-10-28: a stall needs P(plateau) > 0.6; this reads about 0.69).
  ...Array.from({ length: 12 }, (_, i) => rows(new Date(Date.UTC(2026, 5, 2 + 7 * i)).toISOString().slice(0, 10), 'Bench Press', [`${130 + 5 * i}x8`, `${130 + 5 * i}x8`, `${130 + 5 * i}x7`])).flat(),
  ...rows('2026-03-02', 'Machine Chest Press', ['150x10', '150x10', '150x9']),
  ...rows('2026-03-09', 'Machine Chest Press', ['150x11', '150x10', '150x10']),
  ...rows('2026-08-25', 'Bench Press', ['185x8', '185x8', '185x7']),
  ...rows('2026-09-01', 'Bench Press', ['185x8', '185x8', '185x8']),
  ...rows('2026-09-08', 'Bench Press', ['185x8', '185x8', '185x8']),
  ...rows('2026-09-15', 'Bench Press', ['185x9', '185x8', '185x8']),
  ...rows('2026-09-22', 'Bench Press', ['185x9', '185x8', '185x8']),
  ...rows('2026-09-29', 'Bench Press', ['185x9', '185x8', '185x7']),
  ...rows('2026-10-06', 'Bench Press', ['185x8', '185x8', '185x8']),
];

/** The history in, and a one-day program built from it, back on Today with Bench Press's card open. */
async function setUp(page: Page, history = HISTORY) {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-14T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'plateau.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...history].join('\n')) });
  await expect(page.getByText(`✓ Imported ${history.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('1');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('list', { name: 'Day A exercises' }).getByText('Bench Press', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.locator('.plan-name[data-exercise="Bench Press"]').click();
}
const card = (page: Page, lift: string) => page.locator(`[data-card="${lift.toLowerCase()}"]`);
const programLifts = async (page: Page) => {
  await openProgram(page);
  const names = await page.getByRole('list', { name: 'Day A exercises' }).locator('b').allInnerTexts();
  await page.getByRole('button', { name: '‹ Back' }).click();
  return names;
};

test('a stalled lift offers the next variation on its card; one tap switches the program, with a carried-over estimate', async ({ page }) => {
  await setUp(page);
  const sug = card(page, 'Bench Press').getByRole('group', { name: 'Suggested variation' });
  // Machine chest press was done in the spring; incline is the variation not yet done, so it's next.
  await expect(sug).toContainText('Bench Press flat for 6 weeks — switch to Incline Bench Press?');
  await expect(sug).toContainText(/Fatigue-adjusted strength level, no new best since .*Sep 15 · same pattern and main muscle \(chest\)/);
  await expect(sug).toContainText('Start ≈ 130 lb × 8: an estimate from your Bench Press, on the light side.');
  await card(page, 'Bench Press').scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1-card.png` });

  await sug.getByRole('button', { name: 'Switch to Incline Bench Press' }).click();
  const inc = card(page, 'Incline Bench Press');
  await expect(inc.getByRole('status')).toHaveText(/Switched from Bench Press\.\s*Undo/);
  await expect(inc.getByLabel('Target')).toHaveText(/Estimate: \d × 8\+ @ 130 lb/);
  await expect(card(page, 'Bench Press')).toHaveCount(0);
  const plan = page.getByRole('list', { name: 'Planned exercises' });
  await expect(plan.locator('.plan-name[data-exercise="Incline Bench Press"]')).toContainText('@ 130 lb');
  await expect(plan.locator('.plan-name[data-exercise="Bench Press"]')).toHaveCount(0);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/2-switched.png` });

  // For good: the program has it after a reload; the form starts from the estimate.
  await page.reload();
  expect(await programLifts(page)).toContain('Incline Bench Press');
  expect(await programLifts(page)).not.toContain('Bench Press');
  await page.locator('.plan-name[data-exercise="Incline Bench Press"]').click();
  await expect(card(page, 'Incline Bench Press').getByLabel('Target')).toHaveText(/Estimate: \d × 8\+ @ 130 lb/);
  await expect(card(page, 'Incline Bench Press').getByRole('group', { name: 'Suggested variation' })).toHaveCount(0);
});

test('Undo puts the program, the card and the suggestion back', async ({ page }) => {
  await setUp(page);
  await card(page, 'Bench Press').getByRole('button', { name: 'Switch to Incline Bench Press' }).click();
  await card(page, 'Incline Bench Press').getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Incline Bench Press')).toHaveCount(0);
  await expect(card(page, 'Bench Press').getByRole('group', { name: 'Suggested variation' })).toContainText('switch to Incline Bench Press?');
  await page.reload();
  const lifts = await programLifts(page);
  expect(lifts).toContain('Bench Press');
  expect(lifts).not.toContain('Incline Bench Press');
});

test('Dismiss hides it for this plateau, on the card and the lift screen, through a reload', async ({ page }) => {
  await setUp(page);
  const sug = card(page, 'Bench Press').getByRole('group', { name: 'Suggested variation' });
  // Its own screen offers it too, under Next time.
  await card(page, 'Bench Press').getByRole('button', { name: 'Bench Press', exact: true }).click();
  const onScreen = page.getByRole('group', { name: 'Suggested variation' });
  await expect(onScreen).toContainText('Bench Press flat for 6 weeks — switch to Incline Bench Press?');
  await onScreen.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/3-lift-screen.png` });
  await page.getByRole('button', { name: '‹ Back' }).click();

  await sug.getByRole('button', { name: 'Dismiss' }).click();
  await expect(sug).toHaveCount(0);
  expect(await programLifts(page)).toContain('Bench Press'); // nothing changed by itself
  await page.reload();
  await page.locator('.plan-name[data-exercise="Bench Press"]').click();
  await expect(card(page, 'Bench Press').getByLabel('Target')).toBeVisible();
  await expect(sug).toHaveCount(0);
  await card(page, 'Bench Press').getByRole('button', { name: 'Bench Press', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bench Press' })).toBeVisible();
  await expect(onScreen).toHaveCount(0);
});

test('switching from the lift screen changes the program, with an undo', async ({ page }) => {
  await setUp(page);
  await card(page, 'Bench Press').getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to Incline Bench Press' }).click();
  const note = page.getByRole('status').filter({ hasText: 'Incline Bench Press replaces Bench Press in your program.' });
  await expect(note).toBeVisible();
  await expect(page.getByRole('group', { name: 'Suggested variation' })).toHaveCount(0);
  await note.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('group', { name: 'Suggested variation' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Incline Bench Press' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  expect(await programLifts(page)).toContain('Incline Bench Press');
});

// Owner, 2026-10-29: 3 weeks at most. Once a week, a best on 22 September, then three sessions with nothing better: the trend
// doesn't call it a plateau (no swap), but the card says it has gone 3 weeks without a new best.
const WEEKLY = [
  ...Array.from({ length: 13 }, (_, i) => rows(new Date(Date.UTC(2026, 5, 30 + 7 * i)).toISOString().slice(0, 10), 'Bench Press', [`${125 + 5 * i}x8`, `${125 + 5 * i}x8`])).flat(),
  ...['2026-09-29', '2026-10-06', '2026-10-13'].flatMap((d) => rows(d, 'Bench Press', ['185x8', '185x8'])),
];

test('a lift flat for 3 weeks gets a softer note on its card, no swap; Got it hides it through a reload', async ({ page }) => {
  await setUp(page, WEEKLY);
  const c = card(page, 'Bench Press');
  const note = c.getByRole('group', { name: 'No new best lately' });
  await expect(note).toContainText('Bench Press: no new best in 3 weeks');
  await expect(note).toContainText(/Your best has held since .*Sep 22, over 3 sessions\. Not a plateau call, just a heads-up\./);
  await expect(c.getByRole('group', { name: 'Suggested variation' })).toHaveCount(0);
  await note.scrollIntoViewIfNeeded();
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push('scrolls sideways');
    for (const el of document.querySelectorAll<HTMLElement>('.flat-note button')) if (el.offsetHeight < 44) out.push(`${el.textContent} is ${el.offsetHeight}px tall`);
    for (const el of document.querySelectorAll('.flat-note *')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.textContent}`); }
    return out;
  });
  expect(bad).toEqual([]);
  await page.screenshot({ path: process.env.FLAT_PNG ?? `${SHOTS}/5-flat-note.png` });
  await note.getByRole('button', { name: 'Got it' }).click();
  await expect(note).toHaveCount(0);
  await page.reload();
  await page.locator('.plan-name[data-exercise="Bench Press"]').click();
  await expect(c.getByLabel('Target')).toBeVisible();
  await expect(note).toHaveCount(0);
});
