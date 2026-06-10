// Minimal service worker: caches the app shell so the home-screen app launches
// instantly. Translation requests (/api/*) always go to the network.
const CACHE = "live-translate-v1";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API/translation traffic.
  if (url.pathname.startsWith("/api/")) return;
  if (request.method !== "GET") return;

  // Cache-first for the static shell, falling back to network.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
