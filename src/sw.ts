/// <reference lib="webworker" />
// The service worker: what vite-plugin-pwa's generateSW wrote before, kept exactly. Precache everything the build emits,
// serve index.html for every navigation, and take over at once (main.tsx reloads on controllerchange).
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST, {});
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
