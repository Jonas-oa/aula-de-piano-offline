const CACHE_NAME = "partitura-viva-v2-study-102";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/core/library-store.js",
  "./src/core/music.js",
  "./src/core/musicxml.js",
  "./src/core/onset-engine.js",
  "./src/core/screen-wake-lock.js",
  "./src/core/study-display.js",
  "./src/core/timing-evaluator.js",
  "./src/data/public-domain-scores.js",
  "./src/data/rhythm-exercises.js",
  "./src/ui/document-viewer.js",
  "./src/ui/piano-keyboard.js",
  "./src/ui/score-renderer.js",
  "./vendor/osmd/opensheetmusicdisplay.min.js",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.min.mjs",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached || new Response("Recurso indisponível offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }));
      return cached || network;
    }),
  );
});
