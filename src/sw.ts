/// <reference lib="webworker" />
// The service worker. The first half is what vite-plugin-pwa's generateSW wrote before, kept exactly: precache everything
// the build emits, serve index.html for every navigation, take over at once (main.tsx reloads on controllerchange).
// The second half is push (src/push/sw-push.ts).
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import { onNotificationClick, onPush, type PushEventLike, type SwDeps } from './push/sw-push';
import { read, record } from './push/store';

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST, {});
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

const deps = (): SwDeps => ({
  registration: self.registration,
  clients: self.clients,
  setBadge: async (n) => { await (self.navigator as WorkerNavigator & { setAppBadge?: (n?: number) => Promise<void> }).setAppBadge?.(n); },
  record,
  scope: self.registration.scope,
  tags: () => read('tags'),
});
self.addEventListener('push', (e) => onPush(e as unknown as PushEventLike, deps()));
self.addEventListener('notificationclick', (e) => onNotificationClick(e, deps()));
