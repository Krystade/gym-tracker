import { expect, test } from '@playwright/test';

// WebKit under Playwright fails any reload while offline with "internal error", service worker or not; Chromium doesn't.
test.use({ browserName: 'chromium', isMobile: false });

// The service worker built from src/sw.ts keeps what generateSW did: it takes over the first load, and the app opens offline.
test('the service worker controls the app and serves it offline, whatever the query', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  // A navigation the precache has no entry for still gets index.html (the navigation route, not the precache match).
  await page.goto('/?from=elsewhere');
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await context.setOffline(false);
});
