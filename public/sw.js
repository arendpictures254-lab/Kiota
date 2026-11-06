/*
 * Kiota service worker.
 *  - Installable app, and a friendly offline page when a page cannot load.
 *  - The gate screen (/gate) keeps working with no connection: its page and the app's static
 *    files are kept, and its passes live in the phone's own storage (IndexedDB).
 * Nothing else is cached: fees and notices are always fresh from the server, so a parent never
 * sees an old balance.
 */
const CACHE = "kiota-v2";
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
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The app's own scripts and styles: their names change with each release, so keep them.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode !== "navigate") return;

  // The gate: the network first, the last copy when offline.
  if (url.pathname === "/gate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put("/gate", copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match("/gate")
            .then((r) => r || caches.match(OFFLINE).then((o) => o || Response.error())),
        ),
    );
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())),
  );
});
