import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readToolsCatalog } from "./tools.ts";
import { huiToolDefinitions } from "./runtimes/hui-tools.ts";

test("global tools expose real HUI definitions without loading configured packages or creating sessions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-tools-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "danger.mjs"), 'throw new Error("must not load");');
  await writeFile(join(dir, "settings.json"), JSON.stringify({
    packages: ["npm:nonexistent-test-package", "https://user:secret@example.org/repo.git?token=secret"],
    extensions: [join(dir, "danger.mjs")],
  }));
  const before = await readdir(dir);
  const result = await readToolsCatalog(dir);
  assert.equal(result.tools.length, 21);
  assert.equal(result.tools.find((tool) => tool.name === "browser")?.source, "HUI");
  assert.deepEqual(result.tools.filter((tool) => tool.source === "HUI").map((tool) => tool.name), huiToolDefinitions().map((tool) => tool.name));
  assert.deepEqual(result.sources, ["danger.mjs", "nonexistent-test-package", "example.org/repo"]);
  assert.deepEqual(await readdir(dir), before);
  assert(!JSON.stringify(result).includes("secret"));
  assert.equal(result.prompt.revision, "hui-v4");
});

test("missing and malformed settings keep the shipped catalog usable with explicit diagnostics", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-tools-invalid-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual((await readToolsCatalog(dir)).diagnostics, []);
  await writeFile(join(dir, "settings.json"), "not json");
  const result = await readToolsCatalog(dir);
  assert.equal(result.tools.length, 21);
  assert.equal(result.diagnostics.length, 1);
});
