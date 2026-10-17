import { generateKeyPairSync } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// A throwaway VAPID key, made fresh for each run and held only in memory. The real one is a Wrangler secret (SETUP.md).
const vapid = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { VAPID_PRIVATE_JWK: JSON.stringify(vapid) } },
  })],
  test: { include: ['test/**/*.test.ts'] },
});
