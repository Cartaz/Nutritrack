// Service Worker (Workbox injectManifest).
// Pattern 10 dello standard: precache + cleanup + clientsClaim + route differenziati.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute, NavigationRoute, setCatchHandler } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope;

// Precache asset generati da Vite (manifest iniettato da vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST || []);

// Cleanup vecchie cache
cleanupOutdatedCaches();

// Claim clients immediatamente
clientsClaim();

// ============ Runtime caching ============

// Navigazioni (HTML): serve index.html cached (offline-first per shell)
const navigationRoute = new NavigationRoute(
  async (params) => {
    try {
      // Prova network prima (per aggiornamenti app)
      const networkFirst = new NetworkFirst({
        cacheName: 'nutritrack-nav',
        networkTimeoutSeconds: 3,
        plugins: [new CacheableResponsePlugin({ statuses: [200] })],
      });
      return await networkFirst.handle(params);
    } catch {
      // Fallback a index.html precached
      const cached = await caches.match('/index.html') || await caches.match('./index.html');
      return cached ?? Response.error();
    }
  },
  {
    // non intercettare richieste API o asset statici
    denylist: [/^\/api\//, /\.(?:js|css|png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/],
  }
);
registerRoute(navigationRoute);

// Fix B17: register image route BEFORE API route (Workbox uses first-match-wins).
// Immagini OFF (thumbnail): CacheFirst 30 giorni max 300 entries
registerRoute(
  ({ url }) => url.hostname.endsWith('openfoodfacts.org') && /\.(?:jpg|jpeg|png|webp|gif)$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'nutritrack-off-img',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 300 }),
    ],
  }),
  'GET'
);

// Open Food Facts API (NON immagine): NetworkFirst con timeout 10s, cache 1 ora max 100 entries
registerRoute(
  ({ url }) => url.hostname.endsWith('openfoodfacts.org') && !/\.(?:jpg|jpeg|png|webp|gif)$/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'nutritrack-off-api',
    networkTimeoutSeconds: 10,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxAgeSeconds: 60 * 60, maxEntries: 100 }),
    ],
  }),
  'GET'
);

// Immagini generiche remote: CacheFirst 7 giorni
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'nutritrack-img',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 7, maxEntries: 200 }),
    ],
  }),
  'GET'
);

// Catch handler: offline fallback
setCatchHandler(async () => {
  const cached = await caches.match('/index.html') || await caches.match('./index.html');
  if (cached) return cached;
  return new Response('Offline', { status: 503, statusText: 'Offline' });
});

// Skip waiting su message
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
