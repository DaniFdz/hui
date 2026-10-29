import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "vitest";

const source = await readFile(new URL("../public/offline-worker.js", import.meta.url), "utf8");
const ORIGIN = "https://hui.test";

type Handler = (event: Record<string, unknown>) => void;
type Route = { status?: number; body?: string; delayMs?: number };

class MemoryCache {
  readonly entries = new Map<string, Response>();

  async match(request: string | { url: string }): Promise<Response | undefined> {
    return this.entries.get(keyOf(request))?.clone();
  }

  async put(request: string | { url: string }, response: Response): Promise<void> {
    this.entries.set(keyOf(request), response.clone());
  }
}

function keyOf(request: string | { url: string }): string {
  const url = new URL(typeof request === "string" ? request : request.url, ORIGIN);
  return url.origin + url.pathname;
}

function integrity(body: string): string {
  return `sha384-${createHash("sha384").update(body).digest("base64")}`;
}

function worker(build: string, routes: (url: URL) => Route | undefined) {
  const handlers = new Map<string, Handler[]>();
  const stores = new Map<string, MemoryCache>();
  const requests: string[] = [];
  let openDownloads = 0;
  let mostDownloads = 0;
  const fetch = async (input: string | { url: string }, init?: { signal?: AbortSignal; integrity?: string }) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    requests.push(url.pathname);
    init?.signal?.throwIfAborted();
    const route = routes(url);
    if (!route) throw new TypeError("Failed to fetch");
    if (route.delayMs) {
      openDownloads += 1;
      mostDownloads = Math.max(mostDownloads, openDownloads);
      await new Promise((resolve) => setTimeout(resolve, route.delayMs));
      openDownloads -= 1;
    }
    if (init?.integrity && (route.status ?? 200) === 200) {
      return globalThis.fetch(`data:text/plain;base64,${Buffer.from(route.body ?? "").toString("base64")}`, { integrity: init.integrity });
    }
    return new Response(route.body ?? "", { status: route.status ?? 200 });
  };
  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/offline-worker.js?build=${build}` },
    addEventListener(type: string, handler: Handler) {
      handlers.set(type, [...handlers.get(type) ?? [], handler]);
    },
    clients: { claim: async () => undefined },
  };
  runInNewContext(source, {
    self, fetch, Response, Request, Headers, URL, AbortController, setTimeout, clearTimeout, btoa, crypto,
    console,
    caches: {
      async open(name: string) {
        if (!stores.has(name)) stores.set(name, new MemoryCache());
        return stores.get(name);
      },
      async keys() { return [...stores.keys()]; },
      async delete(name: string) { return stores.delete(name); },
    },
  });
  const dispatch = async (type: string) => {
    let waited: Promise<unknown> = Promise.resolve();
    for (const handler of handlers.get(type) ?? []) handler({ waitUntil: (promise: Promise<unknown>) => { waited = promise; } });
    await waited;
  };
  const request = (path: string, mode = "same-origin", method = "GET") => ({ url: ORIGIN + path, mode, method });
  const fetchEvent = async (input: ReturnType<typeof request>) => {
    let responded: Promise<Response> | undefined;
    for (const handler of handlers.get("fetch") ?? []) handler({ request: input, respondWith: (promise: Promise<Response>) => { responded = promise; } });
    return responded;
  };
  return {
    stores,
    requests,
    mostDownloads: () => mostDownloads,
    install: () => dispatch("install"),
    activate: () => dispatch("activate"),
    fetchEvent,
    request,
  };
}

function inventoryFor(build: string, files: Record<string, string>, broken?: Record<string, string>): Route {
  return {
    body: JSON.stringify({
      build,
      files: Object.entries(files).map(([url, body]) => ({ url, integrity: broken?.[url] ?? integrity(body) })),
    }),
  };
}

function served(build: string, files: Record<string, string>, extra?: (url: URL) => Route | undefined) {
  return (url: URL): Route | undefined => url.pathname === "/offline-inventory.json"
    ? inventoryFor(build, files)
    : extra?.(url) ?? (url.pathname in files ? { body: files[url.pathname] } : undefined);
}

test("install fills one build cache with integrity and bounded downloads, and a failure keeps an older complete build", async () => {
  const files: Record<string, string> = { "/index.html": "<hui-app></hui-app>", "/assets/a.js": "a", "/assets/b.js": "b", "/fonts/c.woff2": "c" };
  const good = worker("b1", (url) => url.pathname === "/offline-inventory.json"
    ? inventoryFor("b1", files)
    : url.pathname in files ? { body: files[url.pathname], delayMs: 5 } : undefined);
  await good.install();
  const cache = good.stores.get("hui-offline-b1");
  assert(cache);
  assert.equal(await (await cache.match("/index.html"))?.text(), files["/index.html"]);
  assert.equal(await (await cache.match("/assets/a.js"))?.text(), "a");
  assert.equal(await (await cache.match("/__hui/offline-meta"))?.json().then((meta: { build: string }) => meta.build), "b1");
  assert.equal(good.mostDownloads(), 3, "downloads are bounded and spend the whole budget");
  const requested = good.requests.filter((path) => path !== "/offline-inventory.json").length;
  await good.install();
  assert.equal(good.requests.filter((path) => path !== "/offline-inventory.json").length, requested, "a complete install is not repeated");

  const previous = new MemoryCache();
  await previous.put("/index.html", new Response("old shell"));
  const failing = worker("b2", (url) => url.pathname === "/offline-inventory.json"
    ? inventoryFor("b2", files, { "/assets/b.js": integrity("tampered") })
    : url.pathname in files ? { body: files[url.pathname] } : undefined);
  failing.stores.set("hui-offline-b1", previous);
  await assert.rejects(failing.install(), /fetch failed/u);
  assert.equal(failing.stores.has("hui-offline-b2"), false);
  assert.equal(failing.stores.get("hui-offline-b1"), previous);
  assert.equal(await (await previous.match("/index.html"))?.text(), "old shell");
});

test("only inventory static files are served cache-first; API, mutations, cross-origin and unknown paths stay untouched", async () => {
  const files = { "/index.html": "shell", "/assets/a.js": "a" };
  const subject = worker("b1", served("b1", files, (url) => url.pathname === "/unrelated.js" ? { body: "network" } : undefined));
  await subject.install();
  const downloads = subject.requests.filter((path) => path === "/assets/a.js").length;
  const cached = await subject.fetchEvent(subject.request("/assets/a.js"));
  assert.equal(await cached?.text(), "a");
  assert.equal(subject.requests.filter((path) => path === "/assets/a.js").length, downloads, "the cached asset never reached the network");
  const unknown = await subject.fetchEvent(subject.request("/offline-build.json"));
  assert.equal(unknown, undefined, "a manifest path is never intercepted");
  const unrelated = await subject.fetchEvent(subject.request("/unrelated.js"));
  assert.equal(await unrelated?.text(), "network", "an unknown file is not cached");
  assert.equal(await subject.fetchEvent(subject.request("/__hui/sessions")), undefined);
  assert.equal(await subject.fetchEvent(subject.request("/assets/a.js", "same-origin", "POST")), undefined);
  assert.equal(await subject.fetchEvent({ url: "https://elsewhere.test/assets/a.js", mode: "same-origin", method: "GET" }), undefined);
  for (const path of ["/unknown", "/unknown/child", "/sessions/a/b", "/settings/unknown"]) {
    assert.equal(await subject.fetchEvent(subject.request(path, "navigate")), undefined, "an unknown route is not a cached navigation");
  }
  const offline = await subject.fetchEvent(subject.request("/sessions/example", "navigate"));
  assert.equal(await offline?.text(), "shell", "a valid navigation falls back to the complete cached shell");
});

test("navigation falls back only on a connection failure or a temporary status", async () => {
  const files = { "/index.html": "shell" };
  let answer: Route | undefined;
  const subject = worker("b1", served("b1", files, () => answer));
  await subject.install();
  for (const status of [403, 404]) {
    answer = { status, body: String(status) };
    assert.equal((await subject.fetchEvent(subject.request("/settings", "navigate")))?.status, status);
  }
  for (const status of [502, 503, 504]) {
    answer = { status, body: String(status) };
    assert.equal(await (await subject.fetchEvent(subject.request("/settings", "navigate")))?.text(), "shell");
  }
  answer = undefined;
  assert.equal(await (await subject.fetchEvent(subject.request("/settings", "navigate")))?.text(), "shell");
  assert.equal(await subject.fetchEvent(subject.request("/settings.html", "navigate")), undefined, "a dotted deep link is a file, not a route");
  const cache = subject.stores.get("hui-offline-b1");
  cache?.entries.delete(ORIGIN + "/index.html");
  assert.equal((await subject.fetchEvent(subject.request("/settings", "navigate")))?.status, 0, "an evicted shell means the browser's network error");
});

test("activation deletes older builds and keeps unrelated caches", async () => {
  const files = { "/index.html": "shell" };
  const subject = worker("b1", served("b1", files));
  subject.stores.set("hui-offline-old", new MemoryCache());
  subject.stores.set("unrelated", new MemoryCache());
  await subject.install();
  await subject.activate();
  assert.deepEqual([...subject.stores.keys()].sort(), ["hui-offline-b1", "unrelated"]);
});
