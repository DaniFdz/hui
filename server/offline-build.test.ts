import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { build } from "vite";
import { test } from "vitest";
import { offlineBuild } from "./offline-build.ts";

test("the offline build inventories emitted assets and deferred modules with their actual hashes, excluding its manifests and worker", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hui-offline-build-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "public", "fonts"), { recursive: true });
  await mkdir(join(root, "public", "runtime"), { recursive: true });
  await writeFile(join(root, "index.html"), '<script type="module" src="/entry.js"></script>');
  await writeFile(join(root, "entry.js"), 'globalThis.huiBuild = __HUI_BUILD_ID__; globalThis.huiDeferred = () => import("./deferred.js");');
  await writeFile(join(root, "deferred.js"), 'export const message = "deferred proof";');
  await writeFile(join(root, "public", "fonts", "text.woff2"), "font bytes");
  await writeFile(join(root, "public", "runtime", "engine.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  await writeFile(join(root, "public", "offline-worker.js"), 'self.addEventListener("install", () => {});');
  await writeFile(join(root, "public", "offline-build.json"), JSON.stringify({ build: "stale" }));
  await writeFile(join(root, "public", "offline-inventory.json"), JSON.stringify({ build: "stale", files: [] }));

  await build({ root, configFile: false, logLevel: "silent", plugins: [offlineBuild()], build: { minify: false } });

  const outDir = join(root, "dist");
  const marker = JSON.parse(await readFile(join(outDir, "offline-build.json"), "utf8")) as { build: string };
  const inventory = JSON.parse(await readFile(join(outDir, "offline-inventory.json"), "utf8")) as {
    build: string;
    files: { url: string; integrity: string }[];
  };
  assert.equal(typeof marker.build, "string");
  assert.ok(marker.build.length > 0);
  assert.notEqual(marker.build, "stale");
  assert.equal(inventory.build, marker.build);

  const expected: string[] = [];
  const scripts: string[] = [];
  for (const path of await readdir(outDir, { recursive: true })) {
    if (!(await stat(join(outDir, path))).isFile()) continue;
    if (["offline-worker.js", "offline-build.json", "offline-inventory.json"].includes(path)) continue;
    expected.push(encodeURI(`/${path.split(sep).join("/")}`));
    if (path.endsWith(".js")) scripts.push(await readFile(join(outDir, path), "utf8"));
  }
  assert.deepEqual(inventory.files.map((file) => file.url), expected.sort());
  assert.ok(expected.includes("/index.html"));
  assert.ok(expected.includes("/fonts/text.woff2"));
  assert.ok(expected.includes("/runtime/engine.wasm"));
  assert.ok(scripts.length >= 2, "the deferred module is emitted separately");
  assert.ok(scripts.some((source) => source.includes("deferred proof")));
  assert.ok(scripts.some((source) => source.includes(marker.build)), "the page and marker share a build identity");
  assert.ok(scripts.every((source) => !source.includes("__HUI_BUILD_ID__")));
  for (const file of inventory.files) {
    const bytes = await readFile(join(outDir, decodeURI(file.url).slice(1)));
    assert.equal(file.integrity, `sha384-${createHash("sha384").update(bytes).digest("base64")}`, file.url);
  }
});
