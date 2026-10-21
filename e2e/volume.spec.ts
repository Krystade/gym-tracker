import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto, statsSheet } from './nav';
import { deloadLog, SIM_LIFTS, simDay } from '../src/domain/learn/deloadSim.sample';

// Item 07 on Stats: eight weeks of synthetic training, chest 6 sets a week (bench 3 × 2). Chest set to priority 1 with a range of
// 12–16 by hand: below it and recovering, so "Next 3 weeks" says 6 → 7 (+20 %, down to the half set). The same log with his
// energy below his usual: held, and why. Bench and incline about 8 % down in the last week, the other lifts steady: chest alone is
// held, with its own reason. Nothing is applied. Synthetic only. At the 13 mini's 375×812 with its notch (insets faked as in
// e2e/rotation).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/volume';
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

/** Nothing off the side of the page or the card. */
async function fits(page: Page, sel: string) {
  const bad = await page.evaluate((sel) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    const box = document.querySelector(sel)!.getBoundingClientRect();
    for (const el of document.querySelectorAll(`${sel} *`)) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > box.right + 0.5 || r.left < box.left - 0.5)) out.push(`off the card: ${el.textContent}`);
    }
    return out;
  }, sel);
  expect(bad).toEqual([]);
}

const WEEKS = 8, TODAY = simDay(WEEKS * 7);
const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
const csv = (es: ReturnType<typeof deloadLog>) => es.map((e) => `${e.date},${e.exercise},,${e.setNo},${e.weight},${e.reps},,,,sample`);
const SETS = csv(deloadLog(1, SIM_LIFTS, { weeks: WEEKS }));

async function setUp(page: Page, body?: string, sets = SETS, range = ['12', '16']) {
  await notched(page);
  await page.clock.install({ time: new Date(`${TODAY}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles([
    { name: 'sets.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...sets].join('\n')) },
    ...(body ? [{ name: 'body.csv', mimeType: 'text/csv', buffer: Buffer.from(body) }] : []),
  ]);
  await expect(page.getByText(`✓ Imported ${sets.length} new sets`)).toBeVisible();
  // Priorities live under More (owner, 2026-10-20).
  await goto(page, 'Priorities');
  // Chest to priority 1, and priority 1's range set by hand to 12–16.
  await page.getByRole('combobox', { name: 'Chest' }).selectOption({ index: 0 });
  const one = page.getByRole('group', { name: 'Weekly sets' }).getByRole('listitem').filter({ hasText: /^1 ·/ });
  await one.getByRole('button', { name: 'Edit' }).click();
  await one.getByRole('textbox', { name: 'Min' }).fill(range[0]);
  await one.getByRole('textbox', { name: 'Max' }).fill(range[1]);
  await one.getByRole('button', { name: 'Save' }).click();
  await expect(one).toContainText(`1 · ${range[0]}–${range[1]} sets · yours`);
  await goto(page, 'Stats');
  await statsSheet(page, 'muscles');
}
const steps = (page: Page) => page.getByRole('group', { name: 'Next 3 weeks' });

test('below its range and recovering: the next step is 20 % more than the last 3 weeks', async ({ page }) => {
  await setUp(page);
  await expect(steps(page)).toContainText('20 % more than your last 3, toward each target');
  const chest = steps(page).getByRole('listitem').filter({ hasText: 'Chest' });
  await expect(chest).toHaveAccessibleName('Chest: 6 sets a week, aim at 7');
  await expect(chest).toContainText('6/wk→ 7');
  await expect(steps(page)).toContainText('A stall changes the lift, not the sets.');
  await steps(page).scrollIntoViewIfNeeded();
  await fits(page, '.volume-steps');
  await page.screenshot({ path: `${SHOTS}/raise.png` });
});

test('energy below his usual: every step is held, and it says why', async ({ page }) => {
  const body = ['date,weight_lb,calories,protein_g,energy,edited_at', `${simDay(10)},,,,4,`, `${simDay(20)},,,,4,`, `${simDay(WEEKS * 7 - 3)},,,,2,`].join('\n');
  await setUp(page, body);
  await expect(steps(page)).toContainText('held at your last 3: your energy is lower than usual (2 against 4)');
  const chest = steps(page).getByRole('listitem').filter({ hasText: 'Chest' });
  await expect(chest).toHaveAccessibleName('Chest: 6 sets a week, held');
  await expect(chest).toContainText('held');
  await steps(page).scrollIntoViewIfNeeded();
  await fits(page, '.volume-steps');
  await page.screenshot({ path: `${SHOTS}/held.png` });
});

test('the chest lifts down, the rest steady: chest alone is held, with its own reason', async ({ page }) => {
  const lifts = [...SIM_LIFTS, { name: 'Incline Bench Press', E0: 200, step: 5 }];
  const sets = csv(deloadLog(1, lifts, { weeks: WEEKS, shift: (w, l) => (w === WEEKS - 1 && (l === 0 || l === 5) ? -0.08 : 0) }));
  await setUp(page, undefined, sets, ['16', '20']);
  await expect(steps(page)).toContainText('20 % more than your last 3, toward each target');
  const chest = steps(page).getByRole('listitem').filter({ hasText: 'Chest' });
  await expect(chest).toHaveAccessibleName(/^Chest: 12 sets a week, held, its lifts are down \d+ % lately$/);
  await expect(chest.locator('small')).toHaveText(/its lifts are down \d+ % lately/);
  await steps(page).scrollIntoViewIfNeeded();
  await fits(page, '.volume-steps');
  await page.screenshot({ path: `${SHOTS}/held-chest.png` });
});
