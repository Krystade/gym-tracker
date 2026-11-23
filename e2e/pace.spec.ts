import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto, openProgram } from './nav';

// Item 11, then owner 2026-11-22 (the timer's rests ran about 24 min short): wherever a plan shows its minutes, they are his
// recent pace's forecast with its middle 80 %, once 2 days are timed. Synthetic history: five timed sessions with 6–8 min between
// sets, about twice the timer's rests.
const SHOTS = 'screenshots/pace';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,logged_at';
const GAPS = [420, 380, 460, 400, 440, 390, 470, 410];
const LIFTS = [['Bench Press', 135, 8], ['Lat Pulldown', 120, 10], ['Cable Curl', 40, 12]] as const;
const ROWS = ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14'].flatMap((d) => {
  let t = new Date(`${d}T17:00:00`).getTime();
  return LIFTS.flatMap(([name, w, r]) => [1, 2, 3].map((set) => [name, w, r, set] as const)).map(([name, w, r, set], i) => {
    if (i) t += GAPS[(i - 1) % GAPS.length] * 1000;
    const at = new Date(t);
    const local = `${d}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}:${String(at.getSeconds()).padStart(2, '0')}`;
    return `${d},${name},,${set},${w},${r},,,,sample,${local}`;
  });
});
// (IA A1: which number it is on its own line under the length.)
const AT_PACE = /^≈ (\d+) min at your pace \((\d+)–(\d+)\)/;
/** Minutes a set at that length: the synthetic gaps are 6–8 min, the timer's rests about 2–3. */
const perSet = (min: number, sets: number) => min / sets;

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
}

/** Nothing wider than the screen. */
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

test('a plan’s length is his pace with its middle 80 %, on the Program and on Today; once started it ends at his pace', async ({ page }) => {
  await seed(page);
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  // Each day: its length at his pace, and the pace's middle 80 % under it; no timer's-rests number.
  const head = page.getByRole('heading', { name: /^Day A · \d+ sets · ≈ \d+ min/ });
  await expect(head).toContainText(/at your pace \(\d+–\d+\)/);
  await expect(head).not.toContainText('timer');
  const [, setsA, minA, loA, hiA] = /· (\d+) sets · ≈ (\d+) min\s*at your pace \((\d+)–(\d+)\)/.exec(await head.innerText())!.map(Number);
  expect(loA).toBeLessThanOrEqual(minA);
  expect(hiA).toBeGreaterThanOrEqual(minA);
  expect(perSet(minA, setsA)).toBeGreaterThan(5);
  expect(perSet(minA, setsA)).toBeLessThan(9);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1-program.png` });
  await page.getByRole('button', { name: '‹ Back' }).click();

  const plan = page.getByRole('region', { name: 'Today’s plan' });
  const length = plan.getByLabel('Plan length');
  await expect(length).toHaveText(AT_PACE);
  const [, f, lo, hi] = AT_PACE.exec((await length.textContent())!)!.map(Number);
  expect(f).toBe(minA); // the same day, the same number on both screens
  expect(lo).toBeLessThanOrEqual(f);
  expect(hi).toBeGreaterThanOrEqual(f);
  await fits(page);
  await plan.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${SHOTS}/2-plan.png` });

  // Started at 18:00: it ends at his pace, not the plan's.
  const first = plan.locator('.plan-name').first();
  const name = (await first.getAttribute('data-exercise'))!;
  await first.click();
  const card = page.locator(`[data-card="${name.toLowerCase()}"]`);
  await card.getByRole('textbox', { name: 'Weight' }).fill('100');
  await card.getByRole('textbox', { name: 'Reps' }).fill('10');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(length).toContainText('started 18:00 · ends ≈ ');
  const [, h, m] = /ends ≈ (\d\d):(\d\d)/.exec(await length.innerText())!.map(Number);
  expect((h - 18) * 60 + m).toBeGreaterThan(lo - 10);
  expect((h - 18) * 60 + m).toBeLessThan(hi + 10);
  await fits(page);
  await plan.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${SHOTS}/3-started.png` });
});

// Owner, 2026-10-20: a minutes plan is sized at his own pace; 2026-11-22: the length shown is that pace, with its middle 80 %.
const SIZED = /^≈ (\d+) min at your pace \((\d+)–(\d+)\)$/;
test('no program: the suggested day is sized at his pace and shows it with its middle 80 %', async ({ page }) => {
  await seed(page);
  const card = page.getByRole('region', { name: 'Suggested today' });
  const usual = Number(await card.getByRole('textbox', { name: 'Minutes' }).inputValue());
  expect(usual).toBeGreaterThan(50); // his sessions measured: 8 gaps of about 7 min
  const line = card.getByLabel('Plan length');
  await expect(line).toHaveText(SIZED);
  const [, f, lo, hi] = SIZED.exec(await line.innerText())!.map(Number);
  expect(f).toBeLessThanOrEqual(usual); // what it takes him fits the minutes he has
  expect(f).toBeGreaterThan(usual - 20); // and fills them
  expect(lo).toBeLessThanOrEqual(f);
  expect(hi).toBeGreaterThanOrEqual(f);
  await fits(page);
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${SHOTS}/4-suggested.png` });
});
