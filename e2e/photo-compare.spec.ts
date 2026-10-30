import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';
import { notched } from './layout';
import { writeFileSync } from 'node:fs';

// Progress photos S5 and S6 (plan .superpowers/progress-photos): the wipe compare, Save as image, the progress video (recorded in
// Chromium; WebKit on this machine has no MediaRecorder, so the flipbook), and the photo-day line on Today with its Not now.
// Generated pictures only: no photo file is ever committed to this public repo.

async function png(page: Page, colour: string, size = 0): Promise<Buffer> {
  const url = await page.evaluate(([c, k]) => {
    const cv = document.createElement('canvas'); cv.width = 600; cv.height = 800;
    const g = cv.getContext('2d')!; g.fillStyle = c; g.fillRect(0, 0, 600, 800);
    g.fillStyle = '#d8d2c8'; g.beginPath(); g.arc(300, 110, 44, 0, 7); g.fill(); // a figure in the outline's frame: chin near 19 %
    g.fillRect(300 - 80 - k, 170, 160 + 2 * k, 300); g.fillRect(230, 470, 55, 300); g.fillRect(315, 470, 55, 300);
    return cv.toDataURL('image/png');
  }, [colour, size] as const);
  return Buffer.from(url.split(',')[1], 'base64');
}
async function addPhoto(page: Page, date: string, colour: string, size = 0) {
  await page.getByLabel('Photo date').fill(date);
  await page.getByLabel('From library').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await png(page, colour, size) });
  await expect(page.getByRole('region', { name: 'Timeline' }).getByRole('img', { name: `Front, ${date}` })).toBeVisible();
}
async function stubShare(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { shared: { name: string; type: string; size: number }[] };
    w.shared = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    const files: File[] = [];
    Object.assign(window, { sharedFiles: files });
    Object.defineProperty(navigator, 'share', { value: async (d: { files: File[] }) => { for (const f of d.files) { w.shared.push({ name: f.name, type: f.type, size: f.size }); files.push(f); } } });
  });
}
const shared = (page: Page) => page.evaluate(() => (window as unknown as { shared: { name: string; type: string; size: number }[] }).shared);

test('wipe compare, Save as image cut below the chin, and the progress video', async ({ page, browserName }) => {
  test.setTimeout(60_000);
  await notched(page);
  await stubShare(page);
  await page.clock.setFixedTime(new Date('2026-10-30T09:00:00'));
  await page.goto('/');
  await goto(page, 'Photos');
  await addPhoto(page, '2026-08-01', '#446');
  await addPhoto(page, '2026-09-05', '#465', 10);
  await addPhoto(page, '2026-10-24', '#664', 20);

  const cmp = page.getByRole('region', { name: 'Compare' });
  await expect(cmp.getByRole('img', { name: 'Front, 2026-08-01' })).toBeVisible();
  await expect(cmp.getByRole('img', { name: 'Front, 2026-10-24' })).toBeVisible();
  await expect(cmp).toContainText('12 weeks apart · no PRs between');
  // The divider: after is cut at it, from the slider as from a drag.
  const after = cmp.locator('.wipe-after');
  await expect(after).toHaveAttribute('style', /inset\(0px 0px 0px 50%\)|inset\(0 0 0 50%\)/);
  await cmp.getByRole('slider', { name: 'Divider between before and after' }).fill('30');
  await expect(after).toHaveAttribute('style', /30%/);
  const box = (await cmp.locator('.wipe').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await expect(after).toHaveAttribute('style', /7[45]%/);

  await cmp.getByLabel('Crop below the chin').check();
  await expect(cmp.locator('.wipe-crop')).toBeVisible();
  await cmp.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/50-photo-wipe.png' });
  await expect(cmp.getByRole('button', { name: 'Save as image' })).toBeEnabled();
  // Made ahead: wait for the cropped one (it's smaller than the whole photo), then the tap shares it.
  await page.waitForTimeout(500);
  await cmp.getByRole('button', { name: 'Save as image' }).click();
  await expect.poll(() => shared(page)).toEqual([expect.objectContaining({ name: 'progress-front-2026-08-01-2026-10-24.jpg', type: 'image/jpeg' })]);

  // The composite as saved, kept to look at.
  const jpg = await page.evaluate(async () => {
    const f = (window as unknown as { sharedFiles: File[] }).sharedFiles[0];
    return Array.from(new Uint8Array(await f.arrayBuffer()));
  });
  writeFileSync('screenshots/50b-photo-composite.jpg', Buffer.from(jpg));
  await cmp.getByRole('button', { name: 'Progress video' }).click();
  const pv = cmp.getByRole('group', { name: 'Progress video' });
  await expect(pv).toBeVisible({ timeout: 20_000 });
  if (browserName === 'chromium') {
    await expect(pv.getByLabel('Progress video preview')).toBeVisible();
    await pv.getByRole('button', { name: 'Save video' }).click();
    await expect.poll(async () => (await shared(page)).at(-1)).toEqual(expect.objectContaining({ name: expect.stringMatching(/^progress-front-2026-08-01-2026-10-24\.(mp4|webm)$/) }));
    expect((await shared(page)).at(-1)!.size).toBeGreaterThan(1000);
  } else {
    await expect(pv).toContainText('as a flipbook');
    await expect(pv.getByRole('img', { name: /Progress video, frame \d of 3/ })).toBeVisible();
    await pv.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'screenshots/51-photo-flipbook.png' });
    await pv.getByRole('button', { name: 'Save frames' }).click();
    await expect.poll(async () => (await shared(page)).length).toBe(4);
  }
  await pv.getByRole('button', { name: 'Done' }).click();
  await expect(cmp.getByRole('button', { name: 'Progress video' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('photo day: a line on Today once the last photos are 2 weeks old, Not now puts it away, and the backup nudge waits', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'WebKit is the phone');
  await notched(page);
  await page.clock.setFixedTime(new Date('2026-10-30T09:00:00'));
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Photo day' })).toHaveCount(0); // no photos: no habit to keep
  await goto(page, 'Photos');
  await expect(page.getByRole('group', { name: 'Backup' })).toHaveCount(0);
  for (const [d, c] of [['2026-10-10', '#446'], ['2026-10-12', '#465'], ['2026-10-14', '#664']]) await addPhoto(page, d, c);
  await expect(page.getByRole('group', { name: 'Backup' })).toContainText('3 photos not backed up');
  await expect(page.getByRole('group', { name: 'Photo day reminder' }).getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'true');

  await goto(page, 'Today');
  const line = page.getByRole('group', { name: 'Photo day' });
  await expect(line).toContainText('16 days since your last photos');
  await line.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/52-photo-day.png' });
  // Taken from the line: Photos without the backup nudge on top of the reminder.
  await line.getByRole('button', { name: 'Take them' }).click();
  await expect(page.getByRole('heading', { name: 'Progress photos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record the 6 poses' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Backup' })).toHaveCount(0);
  await page.getByRole('button', { name: '‹ Back' }).click();

  await line.getByRole('button', { name: 'Not now' }).click();
  await expect(line).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Photo day' })).toHaveCount(0);
  // Off: never, Not now or not.
  await goto(page, 'Photos');
  await page.getByRole('group', { name: 'Photo day reminder' }).getByRole('button', { name: 'Off' }).click();
  await page.clock.setFixedTime(new Date('2026-11-20T09:00:00'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Photo day' })).toHaveCount(0);
  await goto(page, 'Photos');
  await page.getByRole('group', { name: 'Photo day reminder' }).getByRole('button', { name: 'Weekly' }).click();
  await goto(page, 'Today');
  await expect(page.getByRole('group', { name: 'Photo day' })).toContainText('37 days since your last photos');
});
