/** Guards offline diagnostics against changing readiness, mutating browser state or logging every poll. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi } from "vitest";
import { observeOfflineLifecycle, offlineReadinessProbe, type OfflineReadinessState } from "../e2e/fixtures/offline-readiness.ts";

const absent: OfflineReadinessState = { url: "http://127.0.0.1/sessions/one", documentReadyState: "complete", supported: true, registration: null, controller: null, ready: false };

test("each test logs changed worker state and cache names once, keeping the original readiness result", async () => {
  let state = absent;
  let cacheReads = 0;
  const lines: string[] = [];
  const read = offlineReadinessProbe(async () => state, async () => { cacheReads++; return ["hui-offline-build"]; }, (line) => lines.push(line));
  assert.equal(await read(), false);
  assert.equal(await read(), false);
  assert.equal(cacheReads, 1);
  state = { ...absent, ready: true, registration: { scope: "http://127.0.0.1/", installing: null, waiting: null, active: { state: "activated", scriptURL: "http://127.0.0.1/offline-worker.js?build=one" } } };
  assert.equal(await read(), true);
  assert.equal(await read(), true);
  assert.equal(cacheReads, 2);
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]!.slice("[hui.offlineFilesReady] ".length)), { ...state, cacheNames: ["hui-offline-build"] });
  const nextTest = offlineReadinessProbe(async () => state, async () => [], (line) => lines.push(line));
  assert.equal(await nextTest(), true);
  assert.equal(lines.length, 3);
});

test("an evaluator error is reported once per distinct error and rethrown unchanged", async () => {
  const error = new Error("registration read failed");
  const lines: string[] = [];
  const read = offlineReadinessProbe(async () => { throw error; }, async () => { assert.fail("a failed read never examines caches"); }, (line) => lines.push(line));
  await assert.rejects(read, (caught) => caught === error);
  await assert.rejects(read, (caught) => caught === error);
  assert.deepEqual(lines, ["[hui.offlineFilesReady] evaluation failed: Error: registration read failed"]);
});

test("the lifecycle observer preserves register arguments, receiver and exact Promise while bounding state-only logs", async () => {
  const worker = Object.assign(new EventTarget(), { state: "installing", scriptURL: "http://127.0.0.1/offline-worker.js?build=one" });
  const registration = Object.assign(new EventTarget(), { scope: "http://127.0.0.1/", installing: worker, waiting: null, active: null });
  const promise = Promise.resolve(registration as unknown as ServiceWorkerRegistration);
  const calls: unknown[][] = [];
  let receiver: unknown;
  const container = Object.assign(new EventTarget(), { controller: null, register: function (this: unknown, ...args: unknown[]) { receiver = this; calls.push(args); return promise; } });
  vi.stubGlobal("navigator", { serviceWorker: container });
  vi.stubGlobal("location", { href: "http://127.0.0.1/" });
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    observeOfflineLifecycle();
    const args = ["/offline-worker.js?build=one", { scope: "/" }];
    assert.equal(container.register(...args), promise);
    assert.equal(receiver, container);
    assert.deepEqual(calls, [args]);
    await promise;
    const initial = log.mock.calls.length;
    worker.dispatchEvent(new Event("statechange"));
    assert.equal(log.mock.calls.length, initial, "an unchanged state adds no log");
    for (let index = 0; index < 100; index++) { worker.state = `state-${index}`; worker.dispatchEvent(new Event("statechange")); }
    assert.equal(log.mock.calls.length, 64);
    assert(!log.mock.calls.some(([line]) => String(line).includes("?build=")), "lifecycle script names omit query strings");
    assert.equal(calls.length, 1, "observing never registers or retries itself");
  } finally { log.mockRestore(); vi.unstubAllGlobals(); }
});

test("registration rejection is observed without replacing the rejected Promise or its reason", async () => {
  const error = new TypeError("actual registration rejection");
  const promise = Promise.reject(error);
  const container = Object.assign(new EventTarget(), { register: () => promise });
  vi.stubGlobal("navigator", { serviceWorker: container });
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    observeOfflineLifecycle();
    const returned = container.register();
    assert.equal(returned, promise);
    await assert.rejects(returned, (caught) => caught === error);
    assert.deepEqual(JSON.parse(String(log.mock.calls[0]![0]).slice("[hui.offlineLifecycle] ".length)), { event: "register-rejected", name: "TypeError", message: error.message });
  } finally { log.mockRestore(); vi.unstubAllGlobals(); }
});

test("browser diagnostics leave workers, caches, context policy and the offline assertion untouched", () => {
  const source = readFileSync(new URL("../e2e/fixtures/offline-readiness.ts", import.meta.url), "utf8");
  assert.match(source, /ready: registration\?\.active\?\.state === "activated"/u);
  assert.doesNotMatch(source, /\.register\(|\.unregister\(|caches\.(?:open|delete)\(|\.reload\(|webkitServiceWorkers/u);
  const journey = readFileSync(new URL("../e2e/tests/shell/offline.e2e.ts", import.meta.url), "utf8");
  assert(journey.includes('await expect.poll(() => hui.offlineFilesReady(), { timeout: 120_000 }).toBe(true);'));
  const fixture = readFileSync(new URL("../e2e/fixtures/hui.ts", import.meta.url), "utf8");
  const observer = 'if (offline && fixtures.platform === "web" && !onPhone(fixtures.app.baseUrl)) await browser().addInitScript(observeOfflineLifecycle);';
  assert(fixture.includes(observer), "ordinary contexts and native attempts never install the observer");
  assert(fixture.indexOf(observer) < fixture.indexOf("await steps.clearState();"), "the offline observer is installed before boot");
});
