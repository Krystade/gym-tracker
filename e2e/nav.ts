import type { Page } from '@playwright/test';

/** Where a spec can go from anywhere in the app: a tab, or a screen one step off a tab. */
export type Place = 'Today' | 'History' | 'Lifts' | 'Stats' | 'Gym' | 'More' | 'Friends' | 'Priorities';

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });

/** Goes to a place the way a person would, so a spec says where it's going rather than which buttons get there. */
export async function goto(page: Page, to: Place) {
  // A Stats sheet covers the tab bar, as a sheet does: Done first, as a person would.
  const sheet = page.locator('.st-sheet');
  if (await sheet.count()) { await sheet.getByRole('button', { name: 'Done' }).click(); await sheet.waitFor({ state: 'detached' }); }
  if (to === 'Gym' || to === 'Priorities') {
    await tab(page, 'More').click();
    return page.getByRole('list', { name: 'More screens' }).getByRole('button', { name: to === 'Gym' ? /^Gym/ : /^Priorities and goal/ }).click();
  }
  return tab(page, to).click();
}

/** Stats v2: a tile's sheet, opened (closing any sheet already open). */
export async function statsSheet(page: import('@playwright/test').Page, tile: string) {
  const open = page.getByRole('dialog');
  if (await open.count()) { await open.getByRole('button', { name: 'Done' }).click(); await open.waitFor({ state: 'detached' }); }
  await page.locator(tile === 'week' ? '.st-week' : `[data-tile="${tile}"]`).click();
  await page.getByRole('dialog').waitFor();
  return page.getByRole('dialog');
}
