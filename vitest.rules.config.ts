// Security-rules tests: they need the Firestore emulator, so they run through `npm run test:rules`, not `npm test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', include: ['rules/**/*.test.ts'], testTimeout: 20_000, fileParallelism: false } });
