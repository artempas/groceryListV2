const CACHE_NAME = 'grocery-v2'
const STATIC_ASSETS = ['/login', '/register']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  // Navigations and API calls go straight to the network. These routes are
  // auth-gated and the root ('/') always redirects, so a cached redirected
  // response would break navigation requests (ERR_FAILED).
  if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request))
    return
  }
  // Cache-first for static assets
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  )
})
