import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { storagePersistence } from './db/db';
import { anyDirty } from './state/drafts';
import { reloadWhenSafe } from './state/appUpdate';
import { tapShowing } from './push/usePush';
import './ui/styles.css';
import './ui/social.css';
import { pinChromeToVisualViewport } from './ui/viewportPin';

void storagePersistence();
pinChromeToVisualViewport();

// A phone keeps the app open for days, so look for a new deploy whenever it comes back, and switch to it once it's in:
// typed sets and added cards are drafts that outlive the reload, and while a form is half-typed it waits for the background.
// So does a screen a notification tap just opened (a friend's thread): a reload would put the app back on Today.
if ('serviceWorker' in navigator) {
  let controlled = !!navigator.serviceWorker.controller; // the first install taking control isn't an update
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const update = controlled;
    controlled = true;
    if (!update || reloading) return;
    reloading = true;
    reloadWhenSafe(() => anyDirty() || tapShowing(), () => location.reload());
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void navigator.serviceWorker.getRegistration().then((r) => r?.update());
  });
}

// Gym Buddies' head-anchor check grid (ui/buddies/AnchorGrid): a page of its own, read by eye, never linked from the app.
const AnchorGrid = lazy(() => import('./ui/buddies/AnchorGrid'));
const checking = new URLSearchParams(location.search).get('check') === 'anchors';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {checking ? <Suspense fallback={null}><AnchorGrid /></Suspense> : <App />}
  </StrictMode>,
);
