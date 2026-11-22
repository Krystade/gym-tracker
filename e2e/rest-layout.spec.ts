import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// The rest bar's time, its label and the line under it never overlap or cut off, in every state it has, at the 13 mini's
// 375×812 (owner, 2026-11-21: at 0:40 the time ran into "Rest", and "No lock-screen alert" was cut to "No lock-scr…").
const SHOTS = 'screenshots/rest-layout';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

/** A phone with rest alerts on whose Worker can't be reached: the bar's line says "No lock-screen alert", its longest. */
const alertFails = (page: Page) => page.addInitScript(() => {
  localStorage.setItem('gym-tracker:push', JSON.stringify({ device: 'synthetic-device', prefs: { kinds: { rest: true } } }));
});

async function addCard(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  return page.locator(`[data-card="${name.toLowerCase()}"]`);
}
async function logSet(page: Page, card: Locator, at: string, weight?: string) {
  if (weight) {
    await card.getByRole('textbox', { name: 'Weight' }).fill(weight);
    await card.getByRole('textbox', { name: 'Reps' }).fill('12');
  }
  await page.clock.pauseAt(new Date(`2026-10-16T${at}`));
  await card.getByRole('button', { name: /^Add set/ }).click();
}

/** Nothing in the bar overlaps anything else in it, sits off the screen, or is cut short with an ellipsis. */
async function clean(page: Page, shot: string) {
  const bad = await page.locator('.rest-timer').evaluate((bar) => {
    const out: string[] = [];
    const box = (el: Element) => el.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    // The time against each of its words, and the bar's pieces against each other.
    const time = bar.querySelector('.rest-main > b');
    const words = [...bar.querySelectorAll('.rest-words > span')];
    const pieces = [...bar.querySelectorAll(':scope > button, .rest-main > b, .rest-main > .rest-why-btn, .rest-words, .rest-next')];
    if (time) for (const w of words) if (hit(box(time), box(w))) out.push(`time over “${w.textContent}”`);
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      if (hit(box(pieces[i]), box(pieces[j]))) out.push(`“${pieces[i].textContent}” over “${pieces[j].textContent}”`);
    }
    for (const el of [...words, ...pieces]) {
      const r = box(el);
      if (r.right > innerWidth + 0.5 || r.left < -0.5) out.push(`off the side: “${el.textContent}”`);
      if (r.bottom > box(bar).bottom + 0.5 || r.top < box(bar).top - 0.5) out.push(`out of the bar: “${el.textContent}”`);
    }
    for (const w of [...words, ...bar.querySelectorAll('.rest-next')] as HTMLElement[]) {
      if (w.scrollWidth > w.clientWidth + 1 || w.scrollHeight > w.clientHeight + 1) out.push(`cut: “${w.textContent}”`);
    }
    // The text inside the time itself isn't squeezed: it's as wide as it needs.
    if (time && (time as HTMLElement).scrollWidth > (time as HTMLElement).clientWidth + 1) out.push('time squeezed');
    return out;
  });
  await page.screenshot({ path: `${SHOTS}/${shot}.png` });
  expect(bad, shot).toEqual([]);
}

test('rest: running at 0:40 with “No lock-screen alert”, at 12:34, and done', async ({ page }) => {
  await alertFails(page);
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const curl = await addCard(page, 'Cable Curl');
  await logSet(page, curl, '18:30:00', '40');
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toContainText('2:00');
  await expect(timer.locator('.rest-no-alert')).toHaveText(/^No lock-screen alert/);
  await page.clock.fastForward(80_000);
  await expect(timer).toContainText('0:40');
  await clean(page, '1-rest-0-40-no-alert');
  // Long: 2:00 and 22 × 30 s is 13:00 from the set; 26 s on, 12:34.
  for (let i = 0; i < 22; i++) await timer.getByRole('button', { name: '+30 s' }).click();
  await expect(timer).toContainText('11:40');
  await timer.getByRole('button', { name: '+30 s' }).click();
  await timer.getByRole('button', { name: '+30 s' }).click();
  await expect(timer).toContainText('12:40');
  await page.clock.fastForward(6_000);
  await expect(timer).toContainText('12:34');
  await clean(page, '2-rest-12-34-no-alert');
  await page.clock.fastForward(12 * 60_000 + 35_000);
  await expect(timer).toContainText('Rest done');
  await clean(page, '3-rest-done');
});

test('rest: “Set 2 next” under the time, with the alert set', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const curl = await addCard(page, 'Cable Curl');
  await logSet(page, curl, '18:30:00', '40');
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toContainText('2:00');
  await page.clock.fastForward(80_000);
  await expect(timer).toContainText('0:40');
  await expect(timer).toContainText('Set 2 next');
  await clean(page, '4-rest-plain');
});

test('switch: a superset’s “Next X · set N” row, with the alert failing, and done', async ({ page }) => {
  await alertFails(page);
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const curl = await addCard(page, 'Cable Curl'), push = await addCard(page, 'Cable Pushdown');
  await logSet(page, curl, '18:30:00', '40');
  await logSet(page, push, '18:31:00', '50');
  await logSet(page, curl, '18:33:30');
  const sw = page.getByRole('timer', { name: 'Switch' });
  await expect(sw).toBeVisible();
  await expect(sw.locator('.rest-next:not(.rest-no-alert)')).toContainText('Cable Pushdown');
  await clean(page, '5-switch-next');
  for (let i = 0; i < 20; i++) await sw.getByRole('button', { name: '+30 s' }).click();
  await expect(sw).toContainText(/1\d:\d\d/);
  await clean(page, '6-switch-long');
  // 0:15 and 20 × 30 s is 10:15; a few seconds past it, "Switch done" (it stays up 30 s).
  await page.clock.fastForward(10 * 60_000 + 20_000);
  await expect(sw).toContainText('Switch done');
  await clean(page, '7-switch-done');
});
