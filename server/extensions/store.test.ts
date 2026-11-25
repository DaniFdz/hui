import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { normalizeEnabled, readExtensions, writeExtensions } from "./store.ts";

async function temp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "hui-ext-store-"));
}

test("a missing store enables nothing", async (t) => {
  const root = await temp();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await readExtensions(join(root, "extensions.json")), { enabled: [] });
});

test("a corrupt, malformed or unsupported store reads empty and says why", async (t) => {
  const root = await temp();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "extensions.json");
  const cases: [string, RegExp][] = [
    ["{", /not valid JSON/],
    ["[]", /JSON object/],
    [JSON.stringify({ version: 2, enabled: [] }), /unsupported extensions.json version/],
    [JSON.stringify({ version: 1, enabled: "hello" }), /enabled array/],
  ];
  for (const [body, pattern] of cases) {
    await writeFile(file, body);
    const store = await readExtensions(file);
    assert.deepEqual(store.enabled, []);
    assert.ok(store.error);
    assert.match(store.error, pattern);
  }
});

test("enabled ids are kept only when they fit the grammar, sorted and deduped", async (t) => {
  const root = await temp();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "extensions.json");
  await writeFile(file, JSON.stringify({
    version: 1,
    enabled: ["zeta", "alpha", "alpha", "Bad", "../escape", 7, "x".repeat(33), "beta-2"],
  }));
  assert.deepEqual((await readExtensions(file)).enabled, ["alpha", "beta-2", "zeta"]);
  assert.deepEqual(normalizeEnabled(Array.from({ length: 80 }, (_, index) => `ext-${String(index).padStart(2, "0")}`)), Array.from({ length: 64 }, (_, index) => `ext-${String(index).padStart(2, "0")}`));
  assert.deepEqual(normalizeEnabled(undefined), []);
});

test("writing the store is atomic, private and replaces a corrupt file", async (t) => {
  const root = await temp();
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "nested", "extensions.json");
  await writeExtensions(["hello"], file);
  assert.equal(await readFile(file, "utf8"), `${JSON.stringify({ version: 1, enabled: ["hello"] }, null, 2)}\n`);
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  await writeFile(file, "{");
  assert.ok((await readExtensions(file)).error);
  await writeExtensions(["world"], file);
  assert.deepEqual(await readExtensions(file), { enabled: ["world"] });
});
