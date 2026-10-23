/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

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
    // The third-party notices (the body map's MIT geometry) ship with the app: the file at the site root, and the licence comment
    // heading src/ui/body/paths.ts on the chunk that holds it (the minifier drops comments; keeping every legal comment instead
    // would add Firebase's to the bundle, about 140 kB).
    {
      name: 'third-party-notices',
      generateBundle(_, bundle) {
        this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: readFileSync('THIRD_PARTY_NOTICES.md', 'utf8') });
        const notice = /\/\*! @license[\s\S]*?\*\//.exec(readFileSync('src/ui/body/paths.ts', 'utf8'))?.[0];
        if (!notice) this.error('src/ui/body/paths.ts lost its licence comment');
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk' && c.moduleIds.some((id) => id.replaceAll('\\', '/').endsWith('src/ui/body/paths.ts')));
        if (!chunks.length) this.error('no chunk holds the body map paths');
        for (const c of chunks) if (c.type === 'chunk') c.code = `${notice}\n${c.code}`;
      },
    },
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
