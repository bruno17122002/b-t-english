// Lingua Quest Online – hand-written service worker.
// - App shell (index.html, manifest, icons) is pre-cached on install.
// - Navigations: network first, cached index.html when offline (the SPA then reads its own IndexedDB cache).
// - Hashed build assets (./assets/*): cache first – their names change on every build.
// - Supabase REST GETs (/rest/v1/): network first with a cached copy as offline fallback. POSTs (auth, RPC,
//   functions) are never cached. The app deletes the API cache on sign-out (message 'clear-api').
const VERSION = 'lq-v1'
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`
const API = 'lq-api'
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
]
const MAX_ASSETS = 60
const MAX_API = 40

const OFFLINE_HTML = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lingua Quest – offline</title><body style="margin:0;background:#202020;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;height:100vh;text-align:center">
<div><h1 style="font-size:20px">Bạn đang offline</h1><p style="color:#c8c8c8">Kết nối Internet rồi mở lại Lingua Quest.</p></div></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS && k !== API).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'clear-api') event.waitUntil(caches.delete(API))
  if (event.data === 'skip-waiting') self.skipWaiting()
})

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i])
}

async function networkFirst(request, cacheName, max) {
  try {
    const res = await fetch(request)
    if (res.ok) {
      const copy = res.clone()
      caches
        .open(cacheName)
        .then((c) => c.put(request, copy))
        .then(() => trim(cacheName, max))
        .catch(() => undefined)
    }
    return res
  } catch (err) {
    const cached = await caches.match(request, { cacheName })
    if (cached) return cached
    throw err
  }
}

async function navigation(request) {
  try {
    const res = await fetch(request)
    if (res.ok) {
      const copy = res.clone()
      caches
        .open(SHELL)
        .then((c) => c.put('./index.html', copy))
        .catch(() => undefined)
    }
    return res
  } catch {
    const cached =
      (await caches.match('./index.html', { cacheName: SHELL })) || (await caches.match('./', { cacheName: SHELL }))
    return cached || new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const res = await fetch(request)
  if (res.ok) {
    const copy = res.clone()
    caches
      .open(ASSETS)
      .then((c) => c.put(request, copy))
      .then(() => trim(ASSETS, MAX_ASSETS))
      .catch(() => undefined)
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  if (sameOrigin && request.mode === 'navigate') {
    event.respondWith(navigation(request))
    return
  }
  if (sameOrigin) {
    if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(request))
    else event.respondWith(networkFirst(request, SHELL, 30))
    return
  }
  if (url.pathname.startsWith('/rest/v1/')) event.respondWith(networkFirst(request, API, MAX_API))
  // Everything else (auth, functions, other hosts) goes straight to the network.
})
