import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";

import { extensionsCheck } from "./doctor-extensions.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "hui-doctor-extensions-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "pkg");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
  return { dir: join(root, "extensions"), file: join(root, "extensions.json"), packageRoot };
}

const manifest = (extra: Record<string, unknown> = {}) => ({ apiVersion: 1, name: "Hello", description: "", main: "index.mjs", ...extra });

test("doctor reports enabled extensions that cannot load and has no fix", async (t) => {
  const f = await fixture(t);
  const check = extensionsCheck(f.packageRoot, { dir: f.dir, file: f.file });
  assert.equal(check.fix, undefined, "HUI cannot repair or delete the operator's code");
  assert.equal((await check.inspect()).status, "ok", "no enabled extensions");

  await writeFile(f.file, JSON.stringify({ version: 1, enabled: ["missing", "broken", "old", "fine"] }));
  await mkdir(join(f.dir, "broken"), { recursive: true });
  await writeFile(join(f.dir, "broken", "extension.json"), "{}");
  await mkdir(join(f.dir, "old"), { recursive: true });
  await writeFile(join(f.dir, "old", "extension.json"), JSON.stringify(manifest({ engines: { hui: { min: "9.0.0" } } })));
  await mkdir(join(f.dir, "fine"), { recursive: true });
  await writeFile(join(f.dir, "fine", "extension.json"), JSON.stringify(manifest({ engines: { hui: { min: "1.0.0", max: "2.0.0" } } })));

  const report = await check.inspect();
  assert.equal(report.status, "issue");
  assert.deepEqual(report.items.map((item) => item.id), ["broken", "missing", "old"]);
  assert.match(report.items[1]?.detail ?? "", /no extension directory/u);
  assert.match(report.items[0]?.detail ?? "", /apiVersion/u);
  assert.match(report.items[2]?.detail ?? "", /requires HUI >=9\.0\.0; this gateway is 1\.2\.3/u);
  assert.match(report.summary, /3 enabled extensions need attention/u);
});

test("doctor reports a corrupt enable store", async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, "{");
  const report = await extensionsCheck(f.packageRoot, { dir: f.dir, file: f.file }).inspect();
  assert.equal(report.status, "issue");
  assert.equal(report.items[0]?.id, f.file);
  assert.match(report.items[0]?.detail ?? "", /not valid JSON/u);
});

test("doctor checks packaged defaults, a config override and a stale ejected copy", async (t) => {
  const f = await fixture(t);
  const bundled = join(f.dir, "..", "bundled");
  const defaults = join(f.dir, "..", "defaults.json");
  await mkdir(join(bundled, "page"), { recursive: true });
  await writeFile(join(bundled, "page", "extension.json"), JSON.stringify(manifest({ name: "Packaged", version: "1.0.0", ui: { title: "Panel", page: { title: "Page", entry: "page.html" } } })));
  await writeFile(defaults, JSON.stringify({ version: 1, enabled: ["page"] }));
  const check = extensionsCheck(f.packageRoot, { dir: f.dir, file: f.file, bundledDir: bundled, defaultsFile: defaults });

  assert.equal((await check.inspect()).status, "ok", "a packaged default loads without extensions.json");
  await mkdir(join(f.dir, "page"), { recursive: true });
  await writeFile(join(f.dir, "page", "extension.json"), "{}");
  let report = await check.inspect();
  assert.equal(report.status, "issue");
  assert.match(report.items[0]?.detail ?? "", /config override cannot load/u);

  await writeFile(join(f.dir, "page", "extension.json"), JSON.stringify(manifest({ name: "Edited", version: "0.9.0" })));
  report = await check.inspect();
  assert.equal(report.status, "issue");
  assert.match(report.items[0]?.detail ?? "", /older than the packaged 1\.0\.0/u);

  await writeFile(join(f.dir, "page", "extension.json"), JSON.stringify(manifest({ name: "Edited", version: "1.1.0" })));
  assert.equal((await check.inspect()).status, "ok");
});
