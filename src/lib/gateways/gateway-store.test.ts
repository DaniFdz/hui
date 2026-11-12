/** The gateway store: one key, the current gateway left alone, and a corrupt save that reads as an empty list. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { GATEWAY_LIST_KEY, type GatewayEntry } from "./gateway-list.ts";
import { GatewayStore, type GatewayStorage } from "./gateway-store.ts";

function memoryStorage(initial: Record<string, string> = {}): GatewayStorage & { saved: Record<string, string> } {
  const saved = { ...initial };
  return {
    saved,
    getItem: (key) => saved[key] ?? null,
    setItem: (key, value) => { saved[key] = value; },
  };
}

const CURRENT = "http://127.0.0.1:8787";

test("the store reads and writes the one key, keeping the current gateway out of it", () => {
  const storage = memoryStorage();
  const store = new GatewayStore({ storage, current: CURRENT, now: () => 500 });
  assert.deepEqual(store.list(), []);
  store.add("http://studio.local:8787/", "Studio");
  store.add(CURRENT, "Here");
  assert.deepEqual(Object.keys(storage.saved), [GATEWAY_LIST_KEY]);
  assert.deepEqual(store.list(), [{ url: "http://studio.local:8787", name: "Studio", lastSeen: 500 }]);

  store.markSeen("http://studio.local:8787", "Studio renamed");
  assert.deepEqual(store.list(), [{ url: "http://studio.local:8787", name: "Studio renamed", lastSeen: 500 }]);

  // Renaming keeps the sighting; moving records a new one, under the moved address only.
  store.edit("http://studio.local:8787", { url: "http://studio.local:8787", name: "Studio" });
  assert.deepEqual(store.list(), [{ url: "http://studio.local:8787", name: "Studio", lastSeen: 500 }]);
  store.edit("http://studio.local:8787", { url: "attic.local:8787", name: "Attic" });
  assert.deepEqual(store.list(), [{ url: "http://attic.local:8787", name: "Attic", lastSeen: 500 }]);
  store.edit("http://attic.local:8787", { url: CURRENT, name: "Here" });
  assert.deepEqual(store.list(), [{ url: "http://attic.local:8787", name: "Attic", lastSeen: 500 }], "the current gateway is never stored");

  store.remove(CURRENT);
  store.remove("http://attic.local:8787");
  assert.deepEqual(store.list(), []);
  assert.deepEqual(new GatewayStore({ storage, current: CURRENT }).list(), [], "the change was saved");
});

test("a saved list is read back, and corrupt saved storage reads as empty", () => {
  const storage = memoryStorage({ [GATEWAY_LIST_KEY]: JSON.stringify({ version: 1, gateways: [{ url: "http://loft.local:8787", name: "Loft", lastSeen: 9 }] }) });
  assert.deepEqual(new GatewayStore({ storage, current: CURRENT }).list(), [{ url: "http://loft.local:8787", name: "Loft", lastSeen: 9 }]);
  for (const raw of ["{", "null", '{"gateways":42}']) {
    assert.deepEqual(new GatewayStore({ storage: memoryStorage({ [GATEWAY_LIST_KEY]: raw }), current: CURRENT }).list(), []);
  }
});

test("storage that refuses to be read or written never throws through the store", () => {
  const refusing: GatewayStorage = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
  };
  const store = new GatewayStore({ storage: refusing, current: CURRENT, now: () => 1 });
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.add("http://studio.local:8787", "Studio").map((entry: GatewayEntry) => entry.url), ["http://studio.local:8787"]);
  assert.deepEqual(new GatewayStore({ storage: null, current: CURRENT }).list(), []);
});

test("every change tells the page once", () => {
  const store = new GatewayStore({ storage: memoryStorage(), current: CURRENT, now: () => 1 });
  let changes = 0;
  const stop = store.subscribe(() => { changes += 1; });
  store.add("http://studio.local:8787", "Studio");
  store.markSeen("http://studio.local:8787");
  store.remove("http://studio.local:8787");
  assert.equal(changes, 3);
  stop();
  store.add("http://loft.local:8787", "Loft");
  assert.equal(changes, 3);
});
