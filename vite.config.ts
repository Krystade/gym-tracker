/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 7) ?? `dev-${Date.now().toString(36)}`;
const BUILT_AT = new Date().toISOString();

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILT_AT__: JSON.stringify(BUILT_AT),
    // The local push e2e points a build at wrangler dev with a throwaway key; every other build leaves these empty.
    __PUSH_TEST_WORKER_URL__: JSON.stringify(process.env.PUSH_TEST_WORKER_URL ?? ''),
    __PUSH_TEST_VAPID_KEY__: JSON.stringify(process.env.PUSH_TEST_VAPID_KEY ?? ''),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Gym Tracker',
        short_name: 'Gym',
        description: 'Personal lifting log',
        theme_color: '#090a0c',
        background_color: '#090a0c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // src/sw.ts reproduces what generateSW did (precache, index.html for navigations, skipWaiting + clientsClaim) and adds push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png}'] },
    }),
  ],
  server: { host: true, port: 5190 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
