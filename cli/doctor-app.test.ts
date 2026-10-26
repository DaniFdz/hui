import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

const root = await mkdtemp(join(tmpdir(), "hui-doctor-app-"));
afterAll(() => rm(root, { recursive: true, force: true }));
const { appCheck } = await import("./doctor-app.ts");

/** A built release, as `packageVersion` verifies one. */
async function release(version: string): Promise<string> {
  const directory = join(root, `release-${version}`);
  await mkdir(join(directory, "dist"), { recursive: true });
  await mkdir(join(directory, "build/cli"), { recursive: true });
  await mkdir(join(directory, "build/server/runtimes"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "hui", version }));
  await writeFile(join(directory, "build/release.json"), JSON.stringify({ format: 1, version }));
  for (const file of ["dist/index.html", "build/cli/main.js", "build/cli/gateway-run.js", "build/server/runtimes/pi-sdk-worker.js"]) {
    await writeFile(join(directory, file), "");
  }
  return directory;
}

const installed = join(root, "installed");
const desktop = (version: string | null, calls: string[], failure?: string) => Promise.resolve({
  installedAppVersion: async (installationRoot: string) => {
    assert.equal(installationRoot, installed);
    return version;
  },
  refreshInstalledApp: async (installationRoot: string) => {
    calls.push(installationRoot);
    if (failure) throw new Error(failure);
    return version;
  },
});

test("an app on another version is reported, then reinstalled from the release HUI runs", async () => {
  const installation = { installationRoot: installed, packageRoot: await release("0.2.0") };
  const calls: string[] = [];
  const check = appCheck(installation, desktop("0.1.0", calls));
  const found = await check.inspect();
  assert.equal(found.status, "issue");
  assert.match(found.summary, /0\.1\.0.*0\.2\.0/u);
  assert.deepEqual(found.items.map((item) => [item.id, item.status, item.detail]), [["app", "issue", "installed 0.1.0, HUI is 0.2.0"]]);
  assert.match(found.notes.join(" "), /hui doctor --fix.*quit and reopen HUI/u);
  const fixed = await check.fix!();
  assert.equal(fixed.status, "fixed");
  assert.deepEqual(fixed.items.map((item) => [item.status, item.detail]), [["fixed", "was 0.1.0"]]);
  assert.match(fixed.notes.join(" "), /Quit and reopen HUI/u);
  assert.deepEqual(calls, [installed]);
});

test("an app without a recorded version counts as older than the release", async () => {
  const check = appCheck({ installationRoot: installed, packageRoot: await release("0.2.0") }, desktop("", []));
  assert.equal((await check.inspect()).status, "issue");
});

test("nothing to change when HUI installed no app, or the app is current", async () => {
  const installation = { installationRoot: installed, packageRoot: await release("0.2.0") };
  const calls: string[] = [];
  assert.deepEqual(await appCheck(installation, desktop(null, calls)).inspect(),
    { id: "desktop-app", title: "HUI desktop app", status: "ok", summary: "no HUI desktop app is installed", items: [], notes: [] });
  const current = await appCheck(installation, desktop("0.2.0", calls)).inspect();
  assert.equal(current.status, "ok");
  assert.equal(current.summary, "the desktop app and HUI are both 0.2.0");
  assert.deepEqual(calls, []);
});

test("a reinstall that fails says what to do instead", async () => {
  const check = appCheck({ installationRoot: installed, packageRoot: await release("0.2.0") }, desktop("0.1.0", [], "Electron failed to install correctly"));
  const fixed = await check.fix!();
  assert.equal(fixed.status, "issue");
  assert.deepEqual(fixed.items.map((item) => [item.status, item.detail]), [["failed", "Electron failed to install correctly"]]);
  assert.match(fixed.notes.join(" "), /hui install-app.*quit and reopen HUI/u);
});