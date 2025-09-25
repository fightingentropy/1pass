const CACHE_VERSION = "1pass-v1"
const APP_SHELL = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_VERSION) {
              return caches.delete(key)
            }
            return undefined
          })
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event

  if (request.method !== "GET") {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (url.pathname.startsWith("/api/")) {
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseClone))
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          if (cached) {
            return cached
          }

          return caches.match("/offline.html")
        })
    )
    return
  }

  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icon-") || url.pathname.endsWith(".svg")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached
        }

        return fetch(request)
          .then((response) => {
            const responseClone = response.clone()
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseClone))
            return response
          })
          .catch(() => cached)
      })
    )
  }
})
