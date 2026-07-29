/* global self, caches, fetch */

const CACHE_NAME = "geosolver-v0.2.0";
const APP_ROOT = new URL("./", self.location.href);
const PRECACHE = [
  APP_ROOT.href,
  new URL("manifest.webmanifest", APP_ROOT).href,
  new URL("icon-192.png", APP_ROOT).href,
  new URL("icon-512.png", APP_ROOT).href,
  new URL("maskable-icon-512.png", APP_ROOT).href,
  new URL("icon.svg", APP_ROOT).href,
  new URL("maskable-icon.svg", APP_ROOT).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("geosolver-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return caches.match(APP_ROOT.href);
        }
        throw new Error("GeoSolver resource is unavailable offline");
      }),
  );
});
