/**
 * The browser state document: how captures merge, and — with a real browser —
 * that a login made in one profile is there in a fresh one seeded from it.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type { BrowserSettings } from "../hui-settings.ts";
import { resolveBrowserExecutable } from "./executable.ts";
import { ManagedBrowser } from "./manager.ts";
import { EMPTY_BROWSER_STATE, mergeBrowserState, sizeOf, trimBrowserState, type BrowserState, type StoredCookie } from "./state.ts";

const detected = await resolveBrowserExecutable("");
const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false };

const cookie = (name: string, value: string, at: number): StoredCookie => ({ name, value, domain: "example.test", path: "/", at });

test("a merge keeps the newest value per cookie and per storage key, and never deletes", () => {
  const base: BrowserState = {
    cookies: [cookie("session", "old", 10), cookie("keep", "1", 5)],
    origins: [{
      origin: "https://example.test", at: 10,
      localStorage: [{ key: "token", value: "old", at: 10 }, { key: "stale", value: "x", at: 1 }],
      indexedDB: [{ name: "app", version: 1, stores: [{ name: "kv", records: [{ key: "\"user\"", value: "\"old\"", at: 10 }] }] }],
      skipped: [],
    }],
  };
  const incoming: BrowserState = {
    cookies: [cookie("session", "new", 20), cookie("added", "2", 20)],
    origins: [{
      origin: "https://example.test", at: 20,
      localStorage: [{ key: "token", value: "new", at: 20 }],
      indexedDB: [{ name: "app", version: 2, stores: [{ name: "kv", records: [{ key: "\"user\"", value: "\"new\"", at: 20 }] }] }],
      skipped: ["a Blob"],
    }],
  };
  const merged = mergeBrowserState(base, incoming);
  assert.deepEqual(merged.cookies.map(({ name, value }) => `${name}=${value}`).sort(), ["added=2", "keep=1", "session=new"]);
  const origin = merged.origins[0]!;
  assert.deepEqual(origin.localStorage.map(({ key, value }) => `${key}=${value}`).sort(), ["stale=x", "token=new"], "nothing is deleted, and the newest write wins");
  assert.equal(origin.indexedDB[0]!.version, 2);
  assert.deepEqual(origin.indexedDB[0]!.stores[0]!.records, [{ key: "\"user\"", value: "\"new\"", at: 20 }]);
  assert.deepEqual(origin.skipped, ["a Blob"]);
  assert.deepEqual(mergeBrowserState(merged, EMPTY_BROWSER_STATE), merged, "an empty side changes nothing");
});

test("a mirror over its budget drops the oldest origins before any cookie", () => {
  const big = (at: number) => ({ origin: `https://site${at}.test`, at, localStorage: [{ key: "k", value: "x".repeat(1_000), at }], indexedDB: [], skipped: [] });
  const state: BrowserState = { cookies: [cookie("session", "keep", 1)], origins: [big(1), big(2), big(3)] };
  assert.ok(sizeOf(state) > 2_500);
  const trimmed = trimBrowserState(state, 2_500);
  assert.deepEqual(trimmed.cookies, state.cookies, "the login stays");
  assert.ok(sizeOf(trimmed) <= 2_500);
  assert.deepEqual(trimmed.origins.map((origin) => origin.at), [3, 2], "the oldest origin goes");
  assert.deepEqual(trimBrowserState(state, 1_500).origins.map((origin) => origin.at), [3], "and more when the budget is tighter");
});

const PAGE = `<!doctype html><title>Mirror</title>
<script>
  const show = (title) => { document.title = title; };
  try {
    if (location.pathname === "/sign-in") {
      document.cookie = "session=abc123; path=/";
      localStorage.setItem("token", "local-42");
      const request = indexedDB.open("app", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onerror = () => show("error " + (request.error && request.error.name));
      request.onsuccess = () => {
        const db = request.result;
        const write = db.transaction("kv", "readwrite");
        write.objectStore("kv").put({ id: 7, when: new Date(0) }, "user");
        write.oncomplete = () => { show("signed in"); db.close(); };
        write.onerror = () => show("error tx");
      };
    } else {
      const request = indexedDB.open("app", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) return show("cookie|" + (localStorage.getItem("token") ?? "no-token"));
        const read = db.transaction("kv", "readonly").objectStore("kv").get("user");
        read.onsuccess = () => {
          const value = read.result;
          db.close();
          show([document.cookie.includes("session=abc123") ? "cookie" : "no-cookie", localStorage.getItem("token") ?? "no-token", value && value.id === 7 ? "idb" : "no-idb"].join("|"));
        };
      };
    }
  } catch (error) { show("threw " + error.message); }
</script>`;

test("a fresh profile seeded by the mirror is signed in: cookie, localStorage and IndexedDB", {
  skip: !detected.executable,
  timeout: 120_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-state-"));
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/" || request.url === "/sign-in" ? 200 : 404, { "content-type": "text/html" });
    response.end(request.url === "/" || request.url === "/sign-in" ? PAGE : "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let captured: BrowserState | undefined;
  const first = new ManagedBrowser({
    profileDir: join(dir, "sign-in"), readSettings: async () => settings,
    mirror: { read: async () => EMPTY_BROWSER_STATE, write: (state) => { captured = state; } },
  });
  const second = new ManagedBrowser({
    profileDir: join(dir, "seeded"), readSettings: async () => settings,
    mirror: { read: async () => captured ?? EMPTY_BROWSER_STATE, write: () => undefined },
  });
  t.onTestFinished(async () => {
    await first.stop();
    await second.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  await first.tool("alpha", { action: "open", url: `${origin}/sign-in` }, { cwd: dir });
  for (let attempt = 0; ; attempt += 1) {
    const text = (await first.tool("alpha", { action: "snapshot" }, { cwd: dir })).text;
    if (/Tab t1 · signed in/u.test(text)) break;
    if (attempt > 100) throw new Error(`the sign-in page never finished:\n${text}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await first.tool("alpha", { action: "close", tabId: "t1" }, { cwd: dir });
  assert.ok(captured, "closing the tab captured its state");
  assert.deepEqual(captured!.cookies.map(({ name, value }) => `${name}=${value}`), ["session=abc123"]);
  const stored = captured!.origins.find((entry) => entry.origin === origin)!;
  assert.deepEqual(stored.localStorage.map(({ key, value }) => `${key}=${value}`), ["token=local-42"]);
  assert.equal(stored.indexedDB.length, 1);
  assert.deepEqual(stored.indexedDB[0]!.stores[0]!.records.map(({ key }) => key), ["\"user\""], "the record's key travels as the page encoded it");

  // One browser at a time: the second seeds a profile of its own, and CI runners have little to spare.
  await first.stop();
  await second.tool("alpha", { action: "open", url: `${origin}/` }, { cwd: dir });
  let page = "";
  for (let attempt = 0; ; attempt += 1) {
    page = (await second.tool("alpha", { action: "snapshot" }, { cwd: dir })).text;
    if (/Tab t1 · cookie\|local-42\|idb/u.test(page)) break;
    if (attempt > 100) throw new Error(`the seeded profile is not signed in:\n${page}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});
