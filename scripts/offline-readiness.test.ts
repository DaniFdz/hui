/** Guards offline diagnostics against changing readiness, mutating browser state or logging every poll. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { offlineReadinessProbe, type OfflineReadinessState } from "../e2e/fixtures/offline-readiness.ts";

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

test("browser diagnostics leave workers, caches, context policy and the offline assertion untouched", () => {
  const source = readFileSync(new URL("../e2e/fixtures/offline-readiness.ts", import.meta.url), "utf8");
  assert.match(source, /ready: registration\?\.active\?\.state === "activated"/u);
  assert.doesNotMatch(source, /\.register\(|\.unregister\(|caches\.(?:open|delete)\(|\.reload\(|webkitServiceWorkers/u);
  const journey = readFileSync(new URL("../e2e/tests/shell/offline.e2e.ts", import.meta.url), "utf8");
  assert(journey.includes('await expect.poll(() => hui.offlineFilesReady(), { timeout: 120_000 }).toBe(true);'));
});
