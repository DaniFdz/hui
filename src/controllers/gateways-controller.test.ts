/** The gateway controller's report to HUI's desktop app: what this device lists, once per change, from the page. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { GatewayStorage } from "../lib/gateways/gateway-store.ts";
import { GatewayStore } from "../lib/gateways/gateway-store.ts";
import { GatewaysController } from "./gateways-controller.ts";

const host = {
  updates: 0, updateComplete: Promise.resolve(true), requestUpdate() { this.updates += 1; },
  addController() {}, removeController() {},
};

function memoryStorage(): GatewayStorage {
  const saved: Record<string, string> = {};
  return { getItem: (key) => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } };
}

test("the page tells the desktop shell which gateways this device lists, and again after every change", () => {
  const reports: (readonly string[])[] = [];
  (globalThis as { huiDesktop?: unknown }).huiDesktop = { reportGateways: (links: readonly string[]) => reports.push(links) };
  const store = new GatewayStore({ storage: memoryStorage(), current: "http://127.0.0.1:5174", now: () => 1 });
  const controller = new GatewaysController(host, store);

  controller.hostConnected();
  assert.deepEqual(reports, [["http://127.0.0.1:5174"]], "the gateway serving the page, so a switch back to it works");

  store.add("http://studio.local:8787/", "Studio");
  assert.deepEqual(reports.at(-1), ["http://127.0.0.1:5174", "http://studio.local:8787"]);
  store.remove("http://studio.local:8787");
  assert.deepEqual(reports.at(-1), ["http://127.0.0.1:5174"], "and one it no longer lists is not offered");
  assert.equal(reports.length, 3);
  controller.hostDisconnected();
});

test("a browser, which has no shell, keeps the list and reports nothing", () => {
  delete (globalThis as { huiDesktop?: unknown }).huiDesktop;
  const store = new GatewayStore({ storage: memoryStorage(), current: "http://127.0.0.1:5174", now: () => 1 });
  const controller = new GatewaysController(host, store);
  controller.hostConnected();
  store.add("http://studio.local:8787", "Studio");
  assert.deepEqual(store.list().map((entry) => entry.url), ["http://studio.local:8787"]);
  assert.equal(host.updates > 0, true, "the page still redraws its own list");
  controller.hostDisconnected();
});
