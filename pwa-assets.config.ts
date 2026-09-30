import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// iOS rounds the apple-touch-icon itself and shows any padding as a border, so fill it edge to edge in the app background.
const bg = { resizeOptions: { background: '#0e1116', fit: 'contain' as const } };
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, ...bg },
    apple: { ...minimal2023Preset.apple, padding: 0, ...bg },
  },
  images: ['public/icon.svg'],
});
