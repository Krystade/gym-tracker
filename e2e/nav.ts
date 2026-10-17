import type { Page } from '@playwright/test';

/** Where a spec can go from anywhere in the app: a tab, or a screen one step off a tab. */
export type Place = 'Today' | 'History' | 'Lifts' | 'Stats' | 'More' | 'Friends' | 'Gym';

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });

/** Goes to a place the way a person would, so a spec says where it's going rather than which buttons get there. */
export async function goto(page: Page, to: Place) {
  if (to === 'More') return tab(page, 'Data').click();
  if (to === 'Gym') {
    await tab(page, 'Today').click();
    await page.getByRole('button', { name: 'Program', exact: true }).click();
    return page.getByRole('button', { name: /^(Set up your gym|Change)$/ }).click();
  }
  return tab(page, to).click();
}
