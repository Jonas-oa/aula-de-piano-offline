const CACHE_NAME = "partitura-viva-v1-126";
const PIANO_SAMPLE_SHELL = [
  "A0v10.mp3", "A1v10.mp3", "A2v10.mp3", "A3v10.mp3", "A4v10.mp3",
  "A5v10.mp3", "A6v10.mp3", "A7v10.mp3",
  "C1v10.mp3", "C2v10.mp3", "C3v10.mp3", "C4v10.mp3", "C5v10.mp3",
  "C6v10.mp3", "C7v10.mp3", "C8v10.mp3",
  "D%231v10.mp3", "D%232v10.mp3", "D%233v10.mp3", "D%234v10.mp3",
  "D%235v10.mp3", "D%236v10.mp3", "D%237v10.mp3",
  "F%231v10.mp3", "F%232v10.mp3", "F%233v10.mp3", "F%234v10.mp3",
  "F%235v10.mp3", "F%236v10.mp3", "F%237v10.mp3",
].map((filename) => `./assets/audio/piano/acoustic-grand/${filename}`);

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/core/library-store.js",
  "./src/core/music.js",
  "./src/core/musicxml.js",
  "./src/core/musicxml-file.js",
  "./src/core/musicxml-export.js",
  "./src/core/onset-engine.js",
  "./src/core/piano-playback-engine.js",
  "./src/core/piano-recognition-engine.js",
  "./src/core/screen-wake-lock.js",
  "./src/core/tempo-control.js",
  "./src/core/timing-evaluator.js",
  "./src/core/follow-evaluator.js",
  "./src/data/rhythm-exercises.js",
  "./src/ui/document-viewer.js",
  "./src/ui/piano-keyboard.js",
  "./src/ui/score-renderer.js",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.min.mjs",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  ...PIANO_SAMPLE_SHELL,
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

function offlineResponse() {
  return new Response("Recurso indisponível offline.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

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
        // `caches.match` resolve para `undefined` quando não encontra nada, e
        // devolver `undefined` ao `respondWith` vira um erro de rede cru em vez
        // da casca offline. A cadeia termina numa resposta de verdade.
        .catch(async () => await caches.match("./index.html")
          || await caches.match("./")
          || offlineResponse()),
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
        .catch(() => cached || offlineResponse());
      return cached || network;
    }),
  );
});
