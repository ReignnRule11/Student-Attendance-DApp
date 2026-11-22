const CACHE_PREFIX = "student-attendance-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const APP_SHELL_URL = new URL("./", self.registration.scope).href;
const SCOPE_PATH = new URL(self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const shellResponse = await fetch(APP_SHELL_URL, { cache: "reload" });
        if (shellResponse.ok) {
          await cache.put(APP_SHELL_URL, shellResponse.clone());
          const html = await shellResponse.text();
          const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
            .map((match) => new URL(match[1], APP_SHELL_URL))
            .filter(
              (url) =>
                url.origin === self.location.origin &&
                url.pathname.startsWith(SCOPE_PATH) &&
                url.pathname.includes("/_next/static/"),
            );
          await Promise.all(
            assets.map((url) => cache.add(url.href).catch(() => undefined)),
          );
        }
      } catch {
        // The app remains usable online if the first offline-shell request fails.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  // Never cache wallet RPC, blockchain, or other cross-origin requests.
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;
          const appShell = await caches.match(APP_SHELL_URL);
          return appShell || Response.error();
        }),
    );
    return;
  }

  const isAppAsset =
    requestUrl.pathname.startsWith(SCOPE_PATH) &&
    (requestUrl.pathname.includes("/_next/static/") ||
      /\.(css|js|svg|png|webp|woff2?)$/i.test(requestUrl.pathname));

  if (!isAppAsset) return;

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
