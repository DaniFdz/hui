/** Proves that persisted-byte checks survive SQLite checkpoints without hiding lost bytes or other files. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";
import { storedContent } from "../e2e/fixtures/stored-content.ts";

test("a WAL checkpoint changes where bytes sit, not which database holds them", async () => {
  const root = await mkdtemp(join(tmpdir(), "hui-stored-content-"));
  try {
    await mkdir(join(root, "config"));
    const database = join(root, "config", "harness.sqlite");
    await writeFile(`${database}-wal`, "a transcript marker");
    await writeFile(join(root, "provider.jsonl"), "a transcript marker");
    const before = await storedContent(root, "transcript marker");
    assert.deepEqual(before, ["config/harness.sqlite", "provider.jsonl"]);
    await writeFile(database, "a transcript marker");
    assert.deepEqual(await storedContent(root, "transcript marker"), before);
    await rm(`${database}-wal`);
    assert.deepEqual(await storedContent(root, "transcript marker"), before);
    await writeFile(database, "no retained content");
    assert.deepEqual(await storedContent(root, "transcript marker"), ["provider.jsonl"]);
    assert.deepEqual(await storedContent(root, "a secret never stored"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
