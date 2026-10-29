/**
 * HUI's production offline shell. The build writes `/offline-inventory.json`
 * with the build id and a SHA-384 integrity hash for every static file this
 * worker installs. Installation fills one build-versioned cache and marks it
 * complete last, so a failed update leaves the previous shell untouched. The
 * worker answers valid SPA navigations network-first (and only falls back to
 * the cached shell on connection failure or a temporary gateway status), serves
 * inventory files cache-first, and never touches API, non-GET or cross-origin
 * traffic.
 */
"use strict";

const CACHE_PREFIX = "hui-offline-";
const INVENTORY_URL = "/offline-inventory.json";
const INDEX_URL = "/index.html";
const META_URL = new URL("/__hui/offline-meta", self.location.origin).href;
const PARALLEL_DOWNLOADS = 3;
const NAVIGATION_TIMEOUT_MS = 4_000;
const TEMPORARY_STATUS = new Set([502, 503, 504]);
const MANIFESTS = new Set(["/offline-build.json", "/offline-inventory.json"]);
const STATIC_FILE = /\.[a-z0-9]+$/iu;
const PAGES = new Set(["/", "/about", "/activity", "/config", "/contributions", "/connection", "/cron", "/dashboard", "/debug", "/labs", "/logs", "/memory-import", "/model-providers", "/model-setup", "/new-session", "/plugin", "/plugins", "/profile", "/sessions", "/skill-workshop", "/skills", "/tasks", "/usage", "/kanban", "/worktrees", "/settings", "/bots"]);
const DEEP_LINK = /^\/(?:sessions|bots)\/[^/.]+$/u;
const SETTINGS = /^\/settings\/(?:appearance|notifications|connection|integrations|workers|worktrees|models|tools|skills|automation|plugins|memory|security|diagnostics|sessions)$/u;

const build = new URL(self.location.href).searchParams.get("build") ?? "";
const cacheName = CACHE_PREFIX + build;

let cacheOpened;

function openCache() {
  cacheOpened ??= caches.open(cacheName);
  return cacheOpened;
}

function isInventory(value) {
  return value !== null && typeof value === "object"
    && typeof value.build === "string"
    && Array.isArray(value.files)
    && value.files.every((file) => file !== null && typeof file === "object"
      && typeof file.url === "string" && file.url.startsWith("/")
      && new URL(file.url, self.location.origin).origin === self.location.origin
      && !file.url.startsWith("/__hui/") && !/[?#\\\\]/u.test(file.url)
      && typeof file.integrity === "string" && file.integrity.startsWith("sha384-"))
    && value.files.some((file) => file.url === INDEX_URL);
}

async function readJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HUI offline files: ${url} answered ${response.status}`);
  return response.json();
}

async function addFile(cache, file) {
  const url = new URL(file.url, self.location.origin).href;
  const response = await fetch(url, { cache: "no-cache", integrity: file.integrity, redirect: "error" });
  if (!response.ok) throw new Error(`HUI offline files: ${file.url} answered ${response.status}`);
  await cache.put(url, response);
}

async function addAll(cache, files) {
  let next = 0;
  let failure;
  const workers = Array.from({ length: Math.min(PARALLEL_DOWNLOADS, files.length) }, async () => {
    while (failure === undefined && next < files.length) {
      const file = files[next++];
      try {
        await addFile(cache, file);
      } catch (error) {
        failure = error;
      }
    }
  });
  await Promise.all(workers);
  if (failure !== undefined) throw failure;
}

async function install() {
  if (!build) throw new Error("HUI offline files: the worker was registered without a build");
  const cache = await openCache();
  if (await cache.match(META_URL)) return;
  try {
    const manifest = await readJson(INVENTORY_URL);
    if (!isInventory(manifest) || manifest.build !== build) {
      throw new Error("HUI offline files: the inventory belongs to another build");
    }
    await addAll(cache, manifest.files);
    await cache.put(META_URL, new Response(JSON.stringify({ build }), {
      headers: { "content-type": "application/json" },
    }));
  } catch (error) {
    await caches.delete(cacheName);
    cacheOpened = undefined;
    throw error;
  }
}

function isAppRoute(pathname) {
  return PAGES.has(pathname) || DEEP_LINK.test(pathname) || SETTINGS.test(pathname);
}

async function cachedShell() {
  return (await openCache()).match(new URL(INDEX_URL, self.location.origin).href) ?? null;
}

async function navigate(request) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: deadline.signal });
    if (!TEMPORARY_STATUS.has(response.status)) return response;
    return await cachedShell() ?? response;
  } catch {
    return await cachedShell() ?? Response.error();
  } finally {
    clearTimeout(timer);
  }
}

async function staticFile(request, pathname) {
  const cached = await (await openCache()).match(new URL(pathname, self.location.origin).href, { ignoreSearch: true });
  return cached ?? fetch(request);
}

self.addEventListener("install", (event) => {
  event.waitUntil(install());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith("/__hui/")) return;
  if (request.mode === "navigate") {
    if (isAppRoute(url.pathname)) event.respondWith(navigate(request));
    return;
  }
  if (MANIFESTS.has(url.pathname) || !STATIC_FILE.test(url.pathname)) return;
  event.respondWith(staticFile(request, url.pathname));
});
