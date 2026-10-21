import type { Page } from '@playwright/test';

/** Where a spec can go from anywhere in the app: a tab, or a screen one step off a tab. */
export type Place = 'Today' | 'History' | 'Lifts' | 'Stats' | 'Gym' | 'More' | 'Friends' | 'Priorities';

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });

/** Goes to a place the way a person would, so a spec says where it's going rather than which buttons get there. */
export async function goto(page: Page, to: Place) {
  if (to === 'Gym' || to === 'Priorities') {
    await tab(page, 'More').click();
    return page.getByRole('list', { name: 'More screens' }).getByRole('button', { name: to === 'Gym' ? /^Gym/ : /^Priorities and goal/ }).click();
  }
  return tab(page, to).click();
}
