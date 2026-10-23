import { expect, test, type Locator, type Page } from '@playwright/test';
import { friendLog, publish, summaryOf } from './fixtures/compare';
import { goto } from './nav';
import { account, befriend, log, signedIn } from './seed';

// Round 30: a long-press on a label (Compare's line names, "You") selected it and raised iOS's Copy / Look Up bar. The app
// isn't selectable; fields and what people wrote are. A double-click is the desktop WebKit stand-in for the long-press.
const T = new Date(new Date().setHours(18, 0, 0, 0));
test.use({ serviceWorkers: 'block' });

const selected = (page: Page) => page.evaluate(() => getSelection()?.toString() ?? '');
async function pick(page: Page, el: Locator) {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  // At the middle of the text's own glyphs: WebKit's box for SVG text is off, and a press there lands on the axis label.
  const at = await el.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); getSelection()?.removeAllRanges(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.dblclick(at.x, at.y);
  return selected(page);
}

test('a chart’s line label doesn’t select on a press; a message’s text does, and the message box still types and selects', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const [me, ana] = await Promise.all(['me', 'ana'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const mine = friendLog(0, T, { rate: 2 }), hers = friendLog(1, T);
  await Promise.all([log(request, me, mine), log(request, ana, hers, { goal: 3 }), publish(request, ana, summaryOf(hers, T, 3))]);
  await befriend(request, me, ana);
  const page = await signedIn(browser, me, T);
  const feed = page.getByRole('region', { name: 'Crew' });
  await expect(feed.getByTestId(`crew-${ana.name}`)).toBeVisible({ timeout: 20_000 });

  await feed.getByRole('button', { name: /^Compare/ }).click();
  const c = page.getByRole('region', { name: 'Compare' });
  await c.getByRole('tab', { name: 'Chart' }).click();
  const you = c.locator('svg text.cmp-lab.me');
  await expect(you).toHaveText('You');
  expect(await pick(page, you), 'the chart’s "You"').toBe('');

  await goto(page, 'Friends');
  await feed.getByTestId(`crew-${ana.name}`).getByRole('button', { name: `Message @${ana.name}` }).click();
  const sheet = page.getByRole('dialog', { name: `Messages with @${ana.name}` });
  const field = sheet.getByRole('textbox', { name: `Message @${ana.name}` });
  await field.click();
  await expect(field).toBeFocused();
  await field.pressSequentially('Deadlifts tonight');
  await expect(field).toHaveValue('Deadlifts tonight');
  // A word in the box selects, as it always has.
  await field.dblclick();
  expect(await field.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart), 'a word selected in the box').toBeGreaterThan(0);
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  const bubble = sheet.locator('.bubble.mine .bubble-text');
  await expect(bubble).toHaveText('Deadlifts tonight');
  expect(await pick(page, bubble), 'the message’s text').toMatch(/Deadlifts|tonight/);
});
