import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { test } from "vitest";

import { buildCore } from "../../scripts/ios-build.ts";

const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("the core bundle runs with no DOM, network or timers, and every export answers there", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hui-ios-core-"));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await buildCore(directory);
  const context = createContext({});
  runInContext(await readFile(join(directory, "hui-core.js"), "utf8"), context);
  const core = context["HUICore"] as typeof import("./entry.ts");

  const calls: Record<keyof typeof core, () => void> = {
    resolveNavigation: () => assert.deepEqual(json(core.resolveNavigation("/settings/appearance")), { target: { kind: "settings", page: "appearance" }, path: "/settings/appearance" }),
    navigationPath: () => assert.equal(core.navigationPath({ kind: "session", id: "a b" }), "/sessions/a%20b"),
    decodeSseFrame: () => assert.deepEqual(json(core.decodeSseFrame('event: status\ndata: {"id":"a"}')), { name: "status", payload: { id: "a" } }),
    reconnectDelay: () => assert.equal(core.reconnectDelay(1, () => 0), 250),
  };
  assert.deepEqual(Object.keys(core).sort(), Object.keys(calls).sort());
  for (const call of Object.values(calls)) call();
});
