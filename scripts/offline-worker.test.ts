import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test, vi } from "vitest";

const source = await readFile(new URL("../public/offline-worker.js", import.meta.url), "utf8");
const ORIGIN = "https://hui.test";

type Handler = (event: Record<string, unknown>) => void;
type Route = { status?: number; body?: string; delayMs?: number };
/** One window this worker can bring forward: `focus` and `navigate` are recorded, and both may refuse. */
type FakeWindow = { url: string; focus: () => Promise<unknown>; navigate: (url: string) => Promise<unknown> };
type ShownNotification = { title: string; options: Record<string, unknown> };

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
  const shown: ShownNotification[] = [];
  const opened: string[] = [];
  const closed: boolean[] = [];
  let windows: FakeWindow[] = [];
  let openDownloads = 0;
  let mostDownloads = 0;
  let releaseDownloads = () => {};
  let downloadGate: Promise<void> | undefined;
  const fetch = async (input: string | { url: string }, init?: { signal?: AbortSignal; integrity?: string }) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    requests.push(url.pathname);
    init?.signal?.throwIfAborted();
    const route = routes(url);
    if (!route) throw new TypeError("Failed to fetch");
    if (route.delayMs) {
      openDownloads += 1;
      mostDownloads = Math.max(mostDownloads, openDownloads);
      // A held download is the test's gate, never a duration: it stays open until the test has seen the peak it
      // wants to assert, and the install waits inside it.
      downloadGate ??= new Promise<void>((resolve) => { releaseDownloads = resolve; });
      await downloadGate;
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
    registration: {
      async showNotification(title: string, options: Record<string, unknown>) {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => windows,
      openWindow: async (url: string) => { opened.push(url); return undefined; },
    },
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
  const dispatch = async (type: string, event: Record<string, unknown> = {}) => {
    let waited: Promise<unknown> = Promise.resolve();
    for (const handler of handlers.get(type) ?? []) handler({ ...event, waitUntil: (promise: Promise<unknown>) => { waited = promise; } });
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
    shown,
    opened,
    closed,
    windows(next: FakeWindow[]) { windows = next; return this; },
    mostDownloads: () => mostDownloads,
    openDownloads: () => openDownloads,
    releaseDownloads: () => releaseDownloads(),
    install: () => dispatch("install"),
    activate: () => dispatch("activate"),
    /** A push event whose body is the text a push service delivered: a fake parses it as the browser does. */
    push: (body: string) => dispatch("push", { data: { json: () => JSON.parse(body) as unknown } }),
    /** A push event with no body at all, which is what a push service may send instead. */
    pushWithoutData: () => dispatch("push", {}),
    /** A tap on one banner the push handler showed, carrying the `data` it stored. */
    notificationClick: (data?: unknown) => dispatch("notificationclick", {
      notification: { data, close: () => { closed.push(true); } },
    }),
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
  const installing = good.install();
  // Every download the worker is allowed to spend is in flight before the test lets them finish.
  await vi.waitFor(() => assert.ok(good.openDownloads() >= 3, "the worker's whole download budget is in flight"), { timeout: 5_000 });
  good.releaseDownloads();
  await installing;
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

/** A window this worker can bring forward; `navigate` and `focus` may refuse, as a browser's may. */
function windowAt(path: string, refusals: { focus?: boolean; navigate?: boolean } = {}): FakeWindow & { focused: boolean; navigatedTo: string } {
  const opened: FakeWindow & { focused: boolean; navigatedTo: string } = {
    url: ORIGIN + path,
    focused: false,
    navigatedTo: "",
    async focus() {
      if (refusals.focus) throw new Error("focus refused");
      opened.focused = true;
      return opened;
    },
    async navigate(url: string) {
      if (refusals.navigate) throw new Error("navigate refused");
      opened.navigatedTo = url;
      return opened;
    },
  };
  return opened;
}

/** An object the worker built lives in its own realm, so compare the values a browser would see. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("a push shows one notification with the title, body, tag, icon and in-app path it carries", async () => {
  const subject = worker("b1", served("b1", { "/index.html": "shell" }));
  await subject.push(JSON.stringify({ title: "Build finished", body: "Done · 2 files", tag: "hui-s1", path: "/sessions/s1", extra: "ignored" }));
  assert.equal(subject.shown.length, 1);
  const [shown] = subject.shown;
  assert.equal(shown?.title, "Build finished");
  assert.deepEqual(plain(shown?.options), {
    body: "Done · 2 files", tag: "hui-s1", icon: "/icon-192.png", badge: "/icon-192.png", data: { path: "/sessions/s1" },
  });
  assert.deepEqual([...subject.stores.keys()], [], "showing a notification opens no cache and writes nothing to one");
});

test("a malformed payload or an off-origin path still shows HUI and opens /", async () => {
  const subject = worker("b1", served("b1", { "/index.html": "shell" }));
  const payloads = [
    "{ not json",
    "[]",
    '"a string"',
    JSON.stringify({ body: "no title" }),
    JSON.stringify({ title: "HUI", path: "https://elsewhere.test/sessions/s1" }),
    JSON.stringify({ title: "HUI", path: "//elsewhere.test/sessions/s1" }),
    JSON.stringify({ title: "HUI", path: "sessions/s1" }),
    JSON.stringify({ title: "HUI", path: 7 }),
  ];
  await subject.pushWithoutData();
  for (const payload of payloads) await subject.push(payload);
  assert.equal(subject.shown.length, payloads.length + 1, "every push still shows one banner");
  for (const notification of subject.shown) {
    assert.equal(notification.title, "HUI", "a payload with no usable title still says HUI");
    assert.equal(JSON.stringify(notification.options["data"]), '{"path":"/"}', "the only data key is a path, and it is /");
  }
});

test("a tap focuses the window this origin already has, navigates it, and closes the banner", async () => {
  const subject = worker("b1", served("b1", { "/index.html": "shell" }));
  const existing = windowAt("/settings/notifications");
  const elsewhere = windowAt("/", { focus: true });
  elsewhere.url = "https://elsewhere.test/";
  subject.windows([elsewhere, existing]);
  await subject.notificationClick({ path: "/sessions/s1" });
  assert.deepEqual(subject.closed, [true], "the banner is closed on the tap");
  assert.equal(existing.focused, true);
  assert.equal(existing.navigatedTo, `${ORIGIN}/sessions/s1`);
  assert.deepEqual(subject.opened, [], "an existing window means no second one");
  assert.equal(elsewhere.focused, false, "a window of another origin is never used");
});

test("a tap with no window opens exactly one, and a refused navigate still leaves the window it had", async () => {
  const alone = worker("b1", served("b1", { "/index.html": "shell" }));
  await alone.notificationClick({});
  assert.deepEqual(alone.opened, [`${ORIGIN}/`], "no path is the app's own home");
  await alone.notificationClick({ path: "/bots/support" });
  assert.deepEqual(alone.opened, [`${ORIGIN}/`, `${ORIGIN}/bots/support`]);

  const subject = worker("b1", served("b1", { "/index.html": "shell" }));
  const existing = windowAt("/", { navigate: true });
  subject.windows([existing]);
  await subject.notificationClick({ path: "/sessions/s2" });
  assert.equal(existing.focused, true, "a refused navigate does not undo the focus");
  assert.deepEqual(subject.opened, [], "and never opens a second window in its place");
});
