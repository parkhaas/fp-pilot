/* FROMIS-FLIX service worker
   - 앱 셸(HTML/CSS/JS)은 stale-while-revalidate
   - data/*.json 은 network-first (최신 데이터 우선, 오프라인 시 캐시)
   - YouTube 등 외부 요청은 건드리지 않음 */

const VERSION = "ff-v13";
const SHELL = [
  "./",
  "./index.html",
  "./assets/css/style.css",
  "./assets/js/config.js",
  "./assets/js/app.js",
  "./image/logo.svg",
  "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 외부(YouTube 등)는 통과

  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
