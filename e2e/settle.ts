import { expect, type Page } from '@playwright/test';

/**
 * Waits for a just-mounted Data screen's last start-up update, the storage check, before a test types into it.
 * React's root has a capture and a bubble input listener, and the browser runs microtasks between them. A state
 * update resolving there takes the input event's sync priority, re-renders the controlled field with its old value,
 * and the bubble listener then sees no change: the typed text is dropped.
 */
export async function dataSettled(page: Page) {
  await expect(page.getByText(/^Storage (is persistent|not marked persistent)/)).toBeVisible();
}
