import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';
import { account, befriend, named, ownerAccount, signedIn, verify } from './seed';

// Display names (social S1) and the verified ✓ (social S2), against the local Auth and Firestore emulators and this worktree's
// firestore.rules. Synthetic users only; the owner is an emulator account under the uid the rules name.
const T = new Date(new Date().setHours(18, 0, 0, 0));
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });

test('a display name: set on Account, checked as typed, once a day, and shown to a friend beside the @username everywhere', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [a, b] = await Promise.all([account(request), account(request)]);
  await befriend(request, a, b);

  const pa = await signedIn(browser, a, T);
  await goto(pa, 'Account');
  const card = pa.getByRole('region', { name: 'Display name' });
  const field = card.getByRole('textbox', { name: 'Display name' });
  await expect(card).toContainText(`1–30 characters. Shows to friends, always with @${a.name} beside it. Once a day.`);
  await expect(field).toHaveValue('');
  // Nothing set: others see the @username alone.
  const seen = pa.getByRole('region', { name: 'How others see you' });
  await expect(seen.locator('.seen-name')).toHaveText(`@${a.name}`);

  // Refused as typed, saying why; it won't save.
  const save = card.getByRole('button', { name: 'Save name' });
  for (const [typed, why] of [
    ['Sam @sam', 'No @: your @username already shows beside it.'],
    ['Sam ✓', 'No ✓ or anything like it: the real one comes from the app’s owner.'],
    ['Sam ✔️', 'No ✓ or anything like it: the real one comes from the app’s owner.'],
    ['Official Sam', 'Not a word the app itself would use, like admin, official or support.'],
    ['www.sam.example', 'No links.'],
    ['S'.repeat(31), 'Too long: 30 characters at most, fewer with emoji.'],
  ] as const) {
    await field.fill(typed);
    await expect(card.getByRole('status'), typed).toHaveText(why);
    await expect(save, typed).toBeDisabled();
  }
  // Cleaned as kept: one space, trimmed.
  await field.fill('  Sam   K. ');
  await save.click();
  await expect(card.getByRole('status')).toHaveText(`Friends see “Sam K.” beside @${a.name} now.`);
  await expect(field).toHaveValue('Sam K.');
  await expect(seen.locator('.seen-name')).toHaveText(`Sam K. @${a.name}`);
  // Once a day: the form says when, and won't save another.
  await field.fill('Sam');
  await expect(card).toContainText('You changed it in the last day. You can change it again after');
  await expect(save).toBeDisabled();
  // Kept on the account: a reload shows it.
  await pa.reload();
  await goto(pa, 'Account');
  await expect(pa.getByRole('region', { name: 'Display name' }).getByRole('textbox', { name: 'Display name' })).toHaveValue('Sam K.');

  // b sees it beside a's @username: Crew, a's page, the thread, Compare.
  const pb = await signedIn(browser, b, T);
  const row = crew(pb).getByRole('button', { name: `Sam K. · @${a.name}`, exact: true });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(pb.getByRole('heading', { level: 1 })).toHaveText(`Sam K. @${a.name}`);
  await pb.getByRole('button', { name: `Message @${a.name}` }).click();
  const thread = pb.getByRole('dialog', { name: `Messages with Sam K. · @${a.name}` });
  await expect(thread.getByRole('heading', { level: 2 })).toHaveText(`Sam K. @${a.name}`);
  await thread.getByRole('button', { name: 'Close' }).click();
  await pb.locator('.fp-back').click();
  await pb.getByRole('button', { name: /^Compare/ }).click();
  const cmp = pb.getByRole('region', { name: 'Compare' });
  await expect(cmp.locator('.cmp-tg', { hasText: 'Sam K.' }).first()).toBeVisible();
  await expect(cmp.locator('.cmp-us', { hasText: `@${a.name}` }).first()).toBeVisible();
  // No ✓ for anyone the owner hasn't verified.
  await expect(pb.locator('.vcheck')).toHaveCount(0);

  // Cleared a day on (the server's clock: a's nameAt moved back a day, as an admin), a shows by the @username alone again.
  await named(request, a, 'Sam K.'); // drops nameAt: as if set over a day ago
  await pa.reload();
  await goto(pa, 'Account');
  const card2 = pa.getByRole('region', { name: 'Display name' });
  await card2.getByRole('textbox', { name: 'Display name' }).fill('');
  await card2.getByRole('button', { name: 'Remove name' }).click();
  await expect(card2.getByRole('status')).toHaveText(`Removed. Friends see @${a.name} alone.`);
  await expect(pa.getByRole('region', { name: 'How others see you' }).locator('.seen-name')).toHaveText(`@${a.name}`);
});

test('the ✓: after a verified person’s name, tapped it says what it means; only the owner gives or removes it', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const [a, b] = await Promise.all([account(request), account(request)]);
  await befriend(request, a, b);
  await named(request, a, 'Sam K.');
  await verify(request, a);

  // b, a friend: the ✓ after a's name on Crew (drawn in the name's button), and on a's page, where tapped, a sheet says what it means.
  const pb = await signedIn(browser, b, T);
  const name = crew(pb).getByTestId(`crew-${a.name}`).locator('.fd-name');
  await expect(name).toHaveText(`Sam K. · @${a.name}`, { timeout: 20_000 });
  await expect(name.getByRole('img', { name: 'verified' })).toBeVisible();
  await name.click();
  const h1 = pb.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText(`Sam K. @${a.name}`);
  await h1.getByRole('button', { name: 'Verified' }).click();
  const why = pb.getByRole('dialog', { name: 'Verified' });
  await expect(why).toContainText(`Verified by the app’s owner: this is the real @${a.name}.`);
  await why.getByRole('button', { name: 'Done' }).click();
  await expect(why).toHaveCount(0);
  // b isn't the owner: no switch, on a's page or on b's own Account.
  await expect(pb.getByRole('button', { name: /Give the ✓|Remove the ✓/ })).toHaveCount(0);
  await goto(pb, 'Account');
  await expect(pb.getByRole('region', { name: 'How others see you' })).toBeVisible();
  await expect(pb.getByRole('button', { name: /Give the ✓|Remove the ✓/ })).toHaveCount(0);

  // The owner, a friend of b's: gives b the ✓ from b's page, and it shows there at once; then takes it away again.
  const owner = await ownerAccount(request);
  await befriend(request, owner, b);
  const po = await signedIn(browser, owner, T);
  const bRow = crew(po).getByRole('button', { name: `@${b.name}`, exact: true });
  await expect(bRow).toBeVisible({ timeout: 20_000 });
  await bRow.click();
  const page = po.getByRole('region', { name: `@${b.name}`, exact: true });
  await expect(page.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Verified' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Give the ✓' }).click();
  await expect(page.getByRole('button', { name: 'Remove the ✓' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Verified' })).toBeVisible();
  // b sees their own ✓ on how others see them.
  await pb.reload();
  await goto(pb, 'Account');
  await expect(pb.getByRole('region', { name: 'How others see you' }).getByRole('button', { name: 'Verified' })).toBeVisible({ timeout: 20_000 });
  // Taken away: gone from b's page.
  await page.getByRole('button', { name: 'Remove the ✓' }).click();
  await expect(page.getByRole('button', { name: 'Give the ✓' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Verified' })).toHaveCount(0);
  // The owner's own Account has the switch for themselves.
  await goto(po, 'Account');
  await expect(po.getByRole('region', { name: 'How others see you' }).getByRole('button', { name: /Give the ✓|Remove the ✓/ })).toBeVisible();
});
