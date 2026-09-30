import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  // The device profile's 375×629 is Safari-with-toolbars; the installed app gets the full 375×812.
  use: { ...devices['iPhone 13 Mini'], viewport: { width: 375, height: 812 }, baseURL: 'http://127.0.0.1:4173/' },
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173/', reuseExistingServer: false, timeout: 180_000 },
});
