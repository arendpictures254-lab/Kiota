/*
 * Kiota service worker: makes the app installable and shows a friendly offline page when a
 * page cannot load. Nothing else is cached: fees and notices are always fresh from the server,
 * so a parent never sees an old balance.
 */
const CACHE = "kiota-offline-v1";
const OFFLINE = "/offline";
const PRECACHE = [OFFLINE, "/brand/kiota-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())),
  );
});
