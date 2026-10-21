import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto, openProgram } from './nav';

// Item 11: a plan's length is the timer's rests (what it should take); his recent pace is what it will take him. Both show when
// they're over 10 min apart. Synthetic history: five timed sessions with 6–8 min between sets, about twice the timer's rests.
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
// (IA A1: the pace on its own line under the length.)
const BOTH = /^≈ (\d+) min at your recent pace ≈ (\d+) min \((\d+)–(\d+)\)/;

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

test('a plan shows its length and, over 10 min away, his recent pace; once started it ends at his pace', async ({ page }) => {
  await seed(page);
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  // Each day: its length, and his pace for it under that.
  const head = page.getByRole('heading', { name: /^Day A · \d+ sets · ≈ \d+ min/ });
  await expect(head).toContainText(/at your recent pace ≈ \d+ min/);
  const [, planA, paceA] = /≈ (\d+) min\s*at your recent pace ≈ (\d+) min/.exec(await head.innerText())!.map(Number);
  expect(paceA - planA).toBeGreaterThan(10);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1-program.png` });
  await page.getByRole('button', { name: '‹ Back' }).click();

  const plan = page.getByRole('region', { name: 'Today’s plan' });
  const length = plan.getByLabel('Plan length');
  await expect(length).toHaveText(BOTH);
  const [, p, f, lo, hi] = BOTH.exec((await length.textContent())!)!.map(Number);
  expect(f - p).toBeGreaterThan(10);
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
  expect((h - 18) * 60 + m).toBeGreaterThan(p + 10);
  await fits(page);
  await plan.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${SHOTS}/3-started.png` });
});

// Owner, 2026-10-20: a minutes plan is sized at his own pace; the timer's rests are beside it when over 10 min away.
const SIZED = /^≈ (\d+) min at your pace \((\d+)–(\d+)\) · (\d+) at the timer’s rests$/;
test('no program: the suggested day is sized at his pace, the timer’s rests beside it', async ({ page }) => {
  await seed(page);
  const card = page.getByRole('region', { name: 'Suggested today' });
  const usual = Number(await card.getByRole('textbox', { name: 'Minutes' }).inputValue());
  expect(usual).toBeGreaterThan(50); // his sessions measured: 8 gaps of about 7 min
  const line = card.getByLabel('Plan length');
  await expect(line).toHaveText(SIZED);
  const [, f, , , p] = SIZED.exec(await line.innerText())!.map(Number);
  expect(f).toBeLessThanOrEqual(usual); // what it takes him fits the minutes he has
  expect(f).toBeGreaterThan(usual - 20); // and fills them
  expect(f - p).toBeGreaterThan(10); // at the timer's rests it would look far shorter
  await fits(page);
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${SHOTS}/4-suggested.png` });
});
