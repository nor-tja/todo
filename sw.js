/* sw.js — app-shell caching so the PWA opens offline.
 *
 * Bump CACHE_VERSION whenever the precached file list changes; a stale
 * cache is dropped on activate. Data (tasks/rhythms/lists) never goes
 * through this cache — that's IndexedDB via local-db.js and the sync
 * queue in sync.js. This service worker only makes the app's own code
 * and fonts available offline.
 *
 * Strategy: cache-first for the precached shell (it changes only on
 * deploy), network-first-falling-back-to-cache for everything else, so a
 * genuinely new deploy is picked up promptly while offline still works.
 */
'use strict';

const CACHE_VERSION = 'todo-app-v1';

const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'assets/css/site.css',
  'assets/css/app.css',
  'assets/js/app.js',
  'assets/js/config.js',
  'assets/js/day-math.js',
  'assets/js/task-store.js',
  'assets/js/rhythms.js',
  'assets/js/review.js',
  'assets/js/lists.js',
  'assets/js/sync.js',
  'assets/js/auth.js',
  'assets/js/store.js',
  'assets/js/local-db.js',
  'assets/js/ui/views.js',
  'assets/js/ui/rituals.js',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept the Supabase API — that always needs a real network
  // round-trip (or to fail so sync.js's queue can catch it), never a
  // stale cached response.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('index.html'))),
  );
});
