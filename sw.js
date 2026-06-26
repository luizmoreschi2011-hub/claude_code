// sw.js — Service Worker para uso offline (app shell + OpenCV em cache).

const CACHE = 'nr33-corretor-v7';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/config.js',
  './js/layout.js',
  './js/omr.js',
  './js/camera.js',
  './js/card.js',
  './js/storage.js',
  './js/opencv-loader.js',
  './icons/icon.svg',
];

const OPENCV_HOST = 'docs.opencv.org';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // OpenCV (CDN): cache-first, guardando após o primeiro download (offline depois).
  if (url.hostname === OPENCV_HOST) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // ignora outros terceiros

  // App shell (mesma origem): cache-first com atualização em segundo plano.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const network = fetch(req).then((resp) => {
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
