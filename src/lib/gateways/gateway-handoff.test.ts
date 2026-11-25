/** The switch handoff: the page a switch opens saves the rows its address carried, then leaves the address without them. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { GATEWAY_HANDOFF_PARAM, type GatewayEntry } from "./gateway-list.ts";
import { adoptGatewayHandoff, type HandoffHistory, type HandoffPage } from "./gateway-handoff.ts";
import { GatewayStore, type GatewayStorage } from "./gateway-store.ts";

function memoryStorage(): GatewayStorage & { saved: Record<string, string> } {
  const saved: Record<string, string> = {};
  return { saved, getItem: (key) => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } };
}

function page(hash: string, pathname = "/", search = ""): HandoffPage {
  return { hash, pathname, search };
}

function history(): HandoffHistory & { replaced: string[] } {
  const replaced: string[] = [];
  return {
    replaced,
    state: { huiSessionLayout: null },
    replaceState(_state, _title, url) { if (typeof url === "string") replaced.push(url); },
  };
}

const carried: GatewayEntry[] = [
  { url: "http://127.0.0.1:4173", name: "macbook", lastSeen: 1_000 },
  { url: "http://loft.local:8787", name: "Loft", lastSeen: 500 },
];

test("the page a switch opens saves the rows its fragment carried and drops the fragment from its address", () => {
  const storage = memoryStorage();
  const store = new GatewayStore({ storage, current: "https://geekom.tail.test:10447", now: () => 2_000 });
  const trailing = `#${GATEWAY_HANDOFF_PARAM}=${encodeURIComponent(JSON.stringify(carried.map((entry) => [entry.url, entry.name, entry.lastSeen])))}`;
  const browserHistory = history();
  assert.equal(adoptGatewayHandoff(store, page(trailing, "/settings/connection", "?x=1"), browserHistory), true);
  assert.deepEqual(store.list(), carried);
  assert.deepEqual(browserHistory.replaced, ["/settings/connection?x=1"]);
  // The rows are this page's for later too: its own storage now holds them.
  assert.deepEqual(new GatewayStore({ storage, current: "https://geekom.tail.test:10447" }).list(), carried);
});

test("a page with no carried rows leaves its address and its list alone", () => {
  const storage = memoryStorage();
  const store = new GatewayStore({ storage, current: "https://geekom.tail.test:10447", now: () => 1_000 });
  store.add("http://loft.local:8787", "Loft");
  const browserHistory = history();
  for (const hash of ["", "#top", `#${GATEWAY_HANDOFF_PARAM}=nope`]) {
    assert.equal(adoptGatewayHandoff(store, page(hash), browserHistory), false);
  }
  assert.deepEqual(browserHistory.replaced, []);
  assert.deepEqual(store.list(), [{ url: "http://loft.local:8787", name: "Loft", lastSeen: 1_000 }]);
});

test("a page whose history refuses the write still keeps the rows it carried", () => {
  const store = new GatewayStore({ storage: memoryStorage(), current: "https://geekom.tail.test:10447" });
  const hash = `#${GATEWAY_HANDOFF_PARAM}=${encodeURIComponent(JSON.stringify([["http://127.0.0.1:4173", "macbook", 1_000]]))}`;
  const refusing: HandoffHistory = { state: null, replaceState() { throw new Error("SecurityError"); } };
  assert.equal(adoptGatewayHandoff(store, page(hash), refusing), true);
  assert.deepEqual(store.list(), [{ url: "http://127.0.0.1:4173", name: "macbook", lastSeen: 1_000 }]);
});

test("a page with no window at all is left exactly as it was", () => {
  const store = new GatewayStore({ storage: memoryStorage(), current: "https://geekom.tail.test:10447" });
  assert.equal(adoptGatewayHandoff(store, undefined, undefined), false);
  assert.deepEqual(store.list(), []);
});
