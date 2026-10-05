const CACHE = "sanket-shell-v4";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("sanket-shell-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const r = event.request,
    u = new URL(r.url);
  if (
    r.method !== "GET" ||
    u.origin !== location.origin ||
    u.pathname.startsWith("/api/") ||
    r.headers.get("accept")?.includes("text/x-component") ||
    u.pathname.includes("@") ||
    u.pathname.includes("node_modules")
  )
    return;
  if (r.mode === "navigate") {
    event.respondWith(
      fetch(r)
        .then(async (response) => {
          if (response.ok && response.type === "basic") {
            const c = await caches.open(CACHE);
            await c.put("/", response.clone());
          }
          return response;
        })
        .catch(
          async () =>
            (await caches.match("/")) ||
            new Response("Reconnect once to open your workspace offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            }),
        ),
    );
    return;
  }
  if (/\.(js|css|svg|png|woff2)$/.test(u.pathname))
    event.respondWith(
      (async () => {
        const cached = await caches.match(r);
        if (cached) return cached;
        const response = await fetch(r);
        if (response.ok) {
          const c = await caches.open(CACHE);
          await c.put(r, response.clone());
        }
        return response;
      })(),
    );
});
