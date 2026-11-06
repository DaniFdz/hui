import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { workerPaths } from "./paths.ts";
import { applySync, planSync, putSyncFiles } from "./sync-apply.ts";
import { contentFile } from "./sync.ts";

type File = { path: string; mode: number; hash: string; content?: Buffer };
const entry = (file: File, mutable = file.path.includes("integrations")) => ({ path: file.path, mode: file.mode, hash: file.hash, size: 1, mutable });

async function remote(t: { onTestFinished(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "hui-sync-apply-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = workerPaths({ HOME: root, XDG_DATA_HOME: join(root, "data") }, root);
  const upload = async (files: readonly File[]) => {
    await putSyncFiles(paths, files.map((file) => ({ path: file.path, mode: file.mode, data: (file.content ?? Buffer.from("x")).toString("base64") })));
    return applySync(paths, { entries: files.map((file) => entry(file)) });
  };
  return { paths, upload };
}

test("a login file a CLI on the worker rewrote is sent again on every sync", async (t) => {
  const { paths, upload } = await remote(t);
  const login = contentFile("hui/integrations/gh/hosts.yml", Buffer.from("active: me\n"));
  const ordinary = contentFile("agent/AGENTS.md", Buffer.from("context\n"));
  await upload([login, ordinary]);

  // `gh auth switch` on the worker: the manifest still records the gateway's hash.
  const mirrored = join(paths.mirrorDir, login.path);
  assert.equal(await readFile(mirrored, "utf8"), "active: me\n");
  await writeFile(mirrored, "active: other\n");

  assert.deepEqual(await planSync(paths, [entry(login), entry(ordinary)]), { need: [login.path] }, "only the rewritten login file is sent again");

  await upload([login, ordinary]);
  assert.equal(await readFile(mirrored, "utf8"), "active: me\n", "the gateway's copy wins again");

  // A file the gateway no longer shares is removed, with its entry.
  assert.equal((await upload([ordinary])).deleted, 1);
});
