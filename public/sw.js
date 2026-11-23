// Service worker de Cordial : appli disponible hors ligne (coquille) et notifications push.
// Les API, les fichiers, le temps réel et l'administration ne sont jamais mis en cache.
const CACHE = "cordial-shell-v11";
const SHELL = ["/", "/app", "/app.css", "/app.js", "/theme.css", "/icons.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (/^\/(api|socket\.io|admin|files)/.test(url.pathname) || req.headers.has("range")) return;
  // Réseau d'abord (toujours la dernière version), cache en secours hors ligne
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match(url.pathname === "/" ? "/" : "/app")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Cordial", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Cordial", {
    body: d.body || "", tag: d.tag || "cordial", renotify: true, icon: "/icons/icon-192.png", badge: "/icons/favicon-64.png", data: { url: d.url || "/app" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/app";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (new URL(c.url).origin === location.origin && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
