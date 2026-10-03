import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { requestPersistence } from './db/db';
import './ui/styles.css';

void requestPersistence();

// A phone keeps the app open for days, so look for a new deploy whenever it comes back, and
// switch to it once it's in: typed sets are drafts, so the reload loses nothing.
if ('serviceWorker' in navigator) {
  let controlled = !!navigator.serviceWorker.controller; // the first install taking control isn't an update
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const update = controlled;
    controlled = true;
    if (!update || reloading) return;
    reloading = true;
    location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void navigator.serviceWorker.getRegistration().then((r) => r?.update());
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
