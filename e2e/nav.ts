import type { Page } from '@playwright/test';

/** Where a spec can go from anywhere in the app: a tab, or a screen one row off More. */
export type Place = 'Today' | 'History' | 'Lifts' | 'Stats' | 'Friends' | 'More' | MoreRow;
/** More's rows (IA plan A3): Training setup, You, Account and data. */
export type MoreRow = 'Program' | 'Weekly goal' | 'Priorities' | 'Gym' | 'Photos' | 'Characters' | 'Cycle' | 'People' | 'Account' | 'Notifications' | 'Backup';
const ROW: Record<MoreRow, RegExp> = {
  Program: /^Program/, 'Weekly goal': /^Weekly goal/, Priorities: /^Priorities and goal/, Gym: /^Gym/,
  Photos: /^Progress photos/, Characters: /^Characters/, Cycle: /^Cycle tracking/, People: /^People on this phone/,
  Account: /^Account and sync/, Notifications: /^Notifications/, Backup: /^Backup, import and export/,
};

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });

/** More's row for a screen, as it shows on More. */
export const moreRow = (page: Page, to: MoreRow) => page.getByRole('main').getByRole('button', { name: ROW[to] });

/** Goes to a place the way a person would, so a spec says where it's going rather than which buttons get there. */
export async function goto(page: Page, to: Place) {
  // A sheet covers the tab bar, as a sheet does: Done first, as a person would.
  const sheet = page.locator('.st-sheet');
  if (await sheet.count()) { await sheet.getByRole('button', { name: 'Done' }).click(); await sheet.waitFor({ state: 'detached' }); }
  if (to in ROW) {
    // The tab, tapped from anywhere (a screen of More's too), shows More itself.
    await tab(page, 'More').click();
    return moreRow(page, to as MoreRow).click();
  }
  return tab(page, to).click();
}

/** Friends' Add a friend sheet, opened from the person+ icon (or as it is, when it's open). */
export async function addFriend(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Add a friend' });
  if (!(await sheet.count())) await page.getByRole('button', { name: 'Add a friend', exact: true }).click();
  await sheet.waitFor();
  return sheet;
}

/** Stats v2: a tile's sheet, opened (closing any sheet already open). */
export async function statsSheet(page: import('@playwright/test').Page, tile: string) {
  const open = page.getByRole('dialog');
  if (await open.count()) { await open.getByRole('button', { name: 'Done' }).click(); await open.waitFor({ state: 'detached' }); }
  await page.locator(tile === 'week' ? '.st-week' : `[data-tile="${tile}"]`).click();
  await page.getByRole('dialog').waitFor();
  return page.getByRole('dialog');
}

/**
 * Program, opened from Today the way a person would: the plan's Edit › (IA A1, owner 2026-10-21: it replaced the header's
 * Program button), or with no program yet the Program › line where the plan goes. Only one of the two is ever on Today.
 */
export const openProgram = (page: Page) => page.getByRole('button', { name: /^(Program|Edit plan)$/ }).click();

/** A friend request from the Add a friend sheet, by username: sent, and its answer shown (in the sheet, which stays open). */
export async function sendRequest(page: Page, to: string) {
  const sheet = await addFriend(page);
  await sheet.getByRole('textbox', { name: 'Their username' }).fill(to);
  await sheet.getByRole('button', { name: 'Send request' }).click();
  await sheet.getByRole('status').or(sheet.getByRole('alert')).waitFor();
  return sheet;
}
