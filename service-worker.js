// ══════════════════════════════════════════════════════════════════
//  SERVICE-WORKER.JS
//  Chunk 7: cache-first app shell (installability + offline loading).
//  Chunk 8: network-first live data (Google Sheet CSV + CR API proxy).
//
//  CACHE_NAME must be bumped (e.g. uc-cache-v2) on any deploy that
//  changes one of the SHELL_FILES below -- this SW is cache-first for
//  the shell by design, so an unbumped cache name means returning
//  users keep loading old JS/HTML indefinitely until the cache expires
//  on its own, which it never does automatically.
// ══════════════════════════════════════════════════════════════════
const CACHE_NAME = 'uc-cache-v41';

// Only the core shell is precached at install -- NOT every file in
// assets/ (many war-background .webp images that a given visit may
// never actually use, since applyRandomBanner() picks just one per
// load). Precaching all of them would slow down the very first install
// for no benefit. Everything else (backgrounds, fonts, etc.) still ends
// up cached for offline use via the plain cache-first runtime handler
// below the first time it's actually requested -- lazy rather than
// up-front, same end result for anything a user's session actually
// touches.
//
// './index.html' is deliberately NOT in this list -- confirmed via curl
// against the live site that Cloudflare Pages 308-redirects /index.html
// to / (the opposite direction previously assumed here). Precaching
// './index.html' fetches through that redirect, so the cached Response
// gets stored with `redirected: true`; Safari then refuses to render
// that Response for a page navigation and throws "response served by
// service worker has redirections" on relaunch. './' returns 200 with no
// redirect (also curl-verified), so it's the only one of the two safe to
// precache and serve for navigations -- see the navigate-mode handler
// below.
const SHELL_FILES = [
  './',
  './manifest.json',
  './js/config.js',
  './js/state.js',
  './js/parse.js',
  './js/calculations.js',
  './js/tab-data.js',
  './js/tab-live.js',
  './js/tab-graphic.js',
  './js/tab-analysis.js',
  './js/main.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// War data (Google Sheet CSV export + the CR API proxy) can change every
// few minutes during an active war -- serving a cached response here as
// if it were current would show stale numbers with nothing indicating
// they're stale. These hosts always try the network first; only fall
// back to whatever was last cached when the network is genuinely
// unreachable (offline), which at least shows last-seen data instead of
// a blank fetch error.
const LIVE_DATA_HOSTS = ['docs.google.com', 'unitedclash-proxy.dncanzano.workers.dev'];

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Page navigations (fresh load, relaunch from home screen) always get the
  // precached shell directly, regardless of which URL the navigation was
  // actually for (root, /index.html, the manifest's start_url, etc.) --
  // see the SHELL_FILES comment above for why it must be './' specifically.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./').then(cached => cached || fetch(req))
    );
    return;
  }

  const url = new URL(req.url);
  event.respondWith(
    LIVE_DATA_HOSTS.includes(url.hostname) ? networkFirst(req) : cacheFirst(req)
  );
});

function cacheFirst(req) {
  return caches.match(req).then(cached => {
    if (cached) return cached;
    return fetch(req).then(resp => {
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      }
      return resp;
    });
  });
}

function networkFirst(req) {
  return fetch(req)
    .then(resp => {
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      }
      return resp;
    })
    .catch(() => caches.match(req));
}
